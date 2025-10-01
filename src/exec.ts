/**
 * Command execution implementation - mirrors Node.js child_process API
 */

import { EventEmitter } from 'node:events';
import { Readable, Writable, PassThrough } from 'node:stream';
import { WSCommand } from './websocket.js';
import type { Sprite } from './sprite.js';
import type { SpawnOptions, ExecOptions, ExecResult } from './types.js';
import { ExecError } from './types.js';

/**
 * Represents a command running on a sprite
 * Mirrors the Node.js ChildProcess API
 */
export class SpriteCommand extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;

  private wsCmd: WSCommand;
  private exitPromise: Promise<number>;
  private exitResolver!: (code: number) => void;
  private started: boolean = false;

  constructor(
    private sprite: Sprite,
    command: string,
    args: string[] = [],
    options: SpawnOptions = {}
  ) {
    super();

    // Create passthrough streams for stdin/stdout/stderr
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();

    // Build WebSocket URL
    const url = this.buildWebSocketURL(command, args, options);

    // Create WebSocket command
    this.wsCmd = new WSCommand(
      url,
      {
        'Authorization': `Bearer ${this.sprite.client.token}`,
      },
      options.tty || false
    );

    // Set up exit promise
    this.exitPromise = new Promise((resolve) => {
      this.exitResolver = resolve;
    });

    // Wire up the streams and events
    this.setupStreams();
  }

  /**
   * Start the command execution
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Command already started');
    }
    this.started = true;

    await this.wsCmd.start();
  }

  /**
   * Set up stream connections
   */
  private setupStreams(): void {
    // Stdin: user writes -> WebSocket
    this.stdin.on('data', (chunk: Buffer) => {
      try {
        this.wsCmd.writeStdin(chunk);
      } catch (error) {
        this.emit('error', error);
      }
    });

    this.stdin.on('end', () => {
      this.wsCmd.sendStdinEOF();
    });

    // Stdout: WebSocket -> user reads
    this.wsCmd.on('stdout', (data: Buffer) => {
      this.stdout.push(data);
    });

    // Stderr: WebSocket -> user reads
    this.wsCmd.on('stderr', (data: Buffer) => {
      this.stderr.push(data);
    });

    // Exit handling
    this.wsCmd.on('exit', (code: number) => {
      this.stdout.push(null); // Signal EOF
      this.stderr.push(null); // Signal EOF
      this.exitResolver(code);
      this.emit('exit', code);
    });

    // Error handling
    this.wsCmd.on('error', (error: Error) => {
      this.emit('error', error);
    });

    // Text messages (port notifications, etc.)
    this.wsCmd.on('message', (msg: any) => {
      this.emit('message', msg);
    });
  }

  /**
   * Build WebSocket URL with query parameters
   */
  private buildWebSocketURL(
    command: string,
    args: string[],
    options: SpawnOptions
  ): string {
    let baseURL = this.sprite.client.baseURL;

    // Convert HTTP(S) to WS(S)
    if (baseURL.startsWith('http')) {
      baseURL = 'ws' + baseURL.substring(4);
    }

    const url = new URL(`${baseURL}/v1/sprites/${this.sprite.name}/exec`);

    // Add command and arguments
    const allArgs = [command, ...args];
    allArgs.forEach((arg) => {
      url.searchParams.append('cmd', arg);
    });
    url.searchParams.set('path', command);

    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        url.searchParams.append('env', `${key}=${value}`);
      }
    }

    // Add working directory
    if (options.cwd) {
      url.searchParams.set('dir', options.cwd);
    }

    // Add TTY settings
    if (options.tty) {
      url.searchParams.set('tty', 'true');
      if (options.rows) {
        url.searchParams.set('rows', options.rows.toString());
      }
      if (options.cols) {
        url.searchParams.set('cols', options.cols.toString());
      }
    }

    // Add session ID if specified
    if (options.sessionId) {
      url.searchParams.set('id', options.sessionId);
    }

    // Add detachable flag
    if (options.detachable) {
      url.searchParams.set('detachable', 'true');
    }

    // Add control mode flag
    if (options.controlMode) {
      url.searchParams.set('cc', 'true');
    }

    return url.toString();
  }

  /**
   * Wait for the command to complete and return the exit code
   */
  async wait(): Promise<number> {
    return this.exitPromise;
  }

  /**
   * Kill the command
   */
  kill(_signal: string = 'SIGTERM'): void {
    this.wsCmd.close();
  }

  /**
   * Resize the terminal (TTY mode only)
   */
  resize(cols: number, rows: number): void {
    this.wsCmd.resize(cols, rows);
  }

  /**
   * Get the exit code (returns -1 if not exited)
   */
  exitCode(): number {
    return this.wsCmd.getExitCode();
  }
}

/**
 * Spawn a command - event-based API (most Node.js-like)
 */
export function spawn(
  sprite: Sprite,
  command: string,
  args: string[] = [],
  options: SpawnOptions = {}
): SpriteCommand {
  const cmd = new SpriteCommand(sprite, command, args, options);
  // Start asynchronously and emit 'spawn' when ready
  cmd.start().then(() => {
    cmd.emit('spawn');
  }).catch((error) => {
    cmd.emit('error', error);
  });
  return cmd;
}

/**
 * Execute a command and return a promise with the output
 */
export async function exec(
  sprite: Sprite,
  command: string,
  options: ExecOptions = {}
): Promise<ExecResult> {
  // Parse command into parts
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  return execFile(sprite, cmd, args, options);
}

/**
 * Execute a file with arguments and return a promise with the output
 */
export async function execFile(
  sprite: Sprite,
  file: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<ExecResult> {
  const encoding = options.encoding || 'utf8';
  const maxBuffer = options.maxBuffer || 10 * 1024 * 1024; // 10MB default

  return new Promise((resolve, reject) => {
    const cmd = new SpriteCommand(sprite, file, args, options);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;

    cmd.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      stdoutLength += chunk.length;
      if (stdoutLength > maxBuffer) {
        cmd.kill();
        reject(new Error(`stdout maxBuffer exceeded`));
      }
    });

    cmd.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrLength += chunk.length;
      if (stderrLength > maxBuffer) {
        cmd.kill();
        reject(new Error(`stderr maxBuffer exceeded`));
      }
    });

    cmd.on('exit', (code: number) => {
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);

      const result: ExecResult = {
        stdout: encoding === ('buffer' as any) ? stdoutBuffer : stdoutBuffer.toString(encoding),
        stderr: encoding === ('buffer' as any) ? stderrBuffer : stderrBuffer.toString(encoding),
        exitCode: code,
      };

      if (code !== 0) {
        const error = new ExecError(`Command failed with exit code ${code}`, result);
        reject(error);
      } else {
        resolve(result);
      }
    });

    cmd.on('error', (error: Error) => {
      reject(error);
    });

    cmd.start().catch(reject);
  });
}

