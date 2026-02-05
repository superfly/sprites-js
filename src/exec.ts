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

    // Mark if this is a session attach (TTY mode will be auto-detected)
    if (options.sessionId) {
      this.wsCmd.isAttach = true;
    }

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

    // Use /exec/{id} for attach, /exec for new commands
    let path: string;
    if (options.sessionId) {
      path = `/v1/sprites/${this.sprite.name}/exec/${options.sessionId}`;
    } else {
      path = `/v1/sprites/${this.sprite.name}/exec`;
    }

    const url = new URL(`${baseURL}${path}`);

    // Only add command/args for new commands (not attach)
    if (!options.sessionId) {
      const allArgs = [command, ...args];
      allArgs.forEach((arg) => {
        url.searchParams.append('cmd', arg);
      });
      url.searchParams.set('path', command);
    }

    // Enable stdin by default so the server will accept input frames
    url.searchParams.set('stdin', 'true');

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

    // Add TTY settings (only for new commands, attach auto-detects)
    if (options.tty && !options.sessionId) {
      url.searchParams.set('tty', 'true');
      if (options.rows) {
        url.searchParams.set('rows', options.rows.toString());
      }
      if (options.cols) {
        url.searchParams.set('cols', options.cols.toString());
      }
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
   * Kill the command with a signal
   */
  kill(signal: string = 'SIGTERM'): void {
    this.wsCmd.signal(signal);
  }

  /**
   * Send a signal to the remote process
   */
  signal(sig: string): void {
    this.wsCmd.signal(sig);
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
  // Use control mode if enabled and not attaching to a session
  if (!options.sessionId && sprite.useControlMode()) {
    return execFileViaControl(sprite, file, args, options);
  }

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

/**
 * Execute a file via control connection for multiplexed operations
 */
async function execFileViaControl(
  sprite: Sprite,
  file: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<ExecResult> {
  const { releaseControlConnection } = await import('./control.js');
  const encoding = options.encoding || 'utf8';
  const maxBuffer = options.maxBuffer || 10 * 1024 * 1024; // 10MB default

  // Get a control connection from the pool
  const cc = await sprite.getControlConnection();

  // Build operation options
  const opOptions = {
    cmd: [file, ...args],
    env: options.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : undefined,
    dir: options.cwd,
    tty: options.tty,
    rows: options.rows,
    cols: options.cols,
    stdin: true, // Enable stdin by default
  };

  try {
    // Start the operation
    const op = await cc.startOp('exec', opOptions);

    return await new Promise((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutLength = 0;
      let stderrLength = 0;

      op.on('stdout', (data: Buffer) => {
        stdoutChunks.push(data);
        stdoutLength += data.length;
        if (stdoutLength > maxBuffer) {
          op.signal('KILL');
          reject(new Error(`stdout maxBuffer exceeded`));
        }
      });

      op.on('stderr', (data: Buffer) => {
        stderrChunks.push(data);
        stderrLength += data.length;
        if (stderrLength > maxBuffer) {
          op.signal('KILL');
          reject(new Error(`stderr maxBuffer exceeded`));
        }
      });

      op.on('error', (error: Error) => {
        reject(error);
      });

      // Send stdin EOF since we're not providing input
      op.sendEOF();

      // Wait for completion
      op.wait().then((code) => {
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
      }).catch(reject);
    });
  } finally {
    // Always release the connection back to the pool
    releaseControlConnection(sprite, cc);
  }
}

