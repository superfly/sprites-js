/**
 * Command execution implementation - mirrors Node.js child_process API
 */

import { EventEmitter } from 'node:events';
import { Readable, Writable, PassThrough } from 'node:stream';
import { authHeaders } from './client-signals.js';
import { WSCommand } from './websocket.js';
import type { Sprite } from './sprite.js';
import type { SpawnOptions, ExecOptions, ExecResult } from './types.js';
import type { HTTPExecOptions, SessionKillEvent } from './types.js';
import { ExecError } from './types.js';
import { parseAPIError } from './types.js';
import { NDJSONStream } from './ndjson.js';

export class SessionKillStream extends NDJSONStream<SessionKillEvent> {
  constructor(response: Response) {
    super(response, data => ({
      type: data.type,
      message: data.message,
      signal: data.signal,
      pid: data.pid,
      exitCode: data.exit_code,
    }));
  }
}

class ControlConnectionUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Control connection unavailable', { cause });
    this.name = 'ControlConnectionUnavailableError';
  }
}

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
      authHeaders(this.sprite.client.token),
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
      path = `/v1/sprites/${encodeURIComponent(this.sprite.name)}/exec/${encodeURIComponent(options.sessionId)}`;
    } else {
      path = `/v1/sprites/${encodeURIComponent(this.sprite.name)}/exec`;
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

    if (options.maxRunAfterDisconnect) {
      url.searchParams.set('max_run_after_disconnect', options.maxRunAfterDisconnect);
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
   * Close the command's WebSocket connection.
   */
  close(): void {
    this.wsCmd.close();
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
  validateExecCancellationOptions(options);
  if (options.signal?.aborted) {
    throw abortError();
  }

  // Use control mode if enabled and not attaching to a session
  if (!options.sessionId && sprite.useControlMode()) {
    try {
      return await execFileViaControl(sprite, file, args, options);
    } catch (error) {
      if (!(error instanceof ControlConnectionUnavailableError)) {
        throw error;
      }
      if (options.signal?.aborted) {
        throw abortError();
      }
      // The server may not support control mode. Fall back only when the
      // control connection itself could not be established.
    }
  }

  const encoding = options.encoding || 'utf8';
  const maxBuffer = options.maxBuffer || 10 * 1024 * 1024; // 10MB default

  return new Promise((resolve, reject) => {
    const cmd = new SpriteCommand(sprite, file, args, options);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let removeCancellation = () => {};

    const settler = createExecSettler(resolve, reject, () => {
      removeCancellation();
      cmd.close();
    });

    cmd.stdout.on('data', (chunk: Buffer) => {
      if (settler.isSettled()) return;
      stdoutChunks.push(chunk);
      stdoutLength += chunk.length;
      if (stdoutLength > maxBuffer) {
        cmd.kill();
        settler.reject(new Error(`stdout maxBuffer exceeded`));
      }
    });

    cmd.stderr.on('data', (chunk: Buffer) => {
      if (settler.isSettled()) return;
      stderrChunks.push(chunk);
      stderrLength += chunk.length;
      if (stderrLength > maxBuffer) {
        cmd.kill();
        settler.reject(new Error(`stderr maxBuffer exceeded`));
      }
    });

    cmd.on('exit', (code: number) => {
      if (settler.isSettled()) return;
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);

      const result: ExecResult = {
        stdout: encoding === ('buffer' as any) ? stdoutBuffer : stdoutBuffer.toString(encoding),
        stderr: encoding === ('buffer' as any) ? stderrBuffer : stderrBuffer.toString(encoding),
        exitCode: code,
      };

      if (code !== 0) {
        const error = new ExecError(`Command failed with exit code ${code}`, result);
        settler.reject(error);
      } else {
        settler.resolve(result);
      }
    });

    cmd.on('error', (error: Error) => {
      settler.reject(error);
    });

    const cancellation = createExecCancellation(options, () => {
      // signal() is a no-op while connecting; close() in the settler cleanup
      // still disconnects the socket so the server can reap the process.
      cmd.kill();
    }, settler.reject);
    removeCancellation = cancellation.cleanup;
    cancellation.start();
    if (!settler.isSettled()) {
      cmd.start().catch(settler.reject);
    }
  });
}

/**
 * Execute a non-TTY command over HTTP for environments without WebSockets.
 *
 * The current server protocol uses type-prefixed frames without lengths and
 * therefore relies on HTTP transport chunk boundaries being preserved. This
 * method rejects frame types that reveal re-chunking, but cannot detect every
 * coalesced frame. Prefer the WebSocket exec methods for large output.
 */
export async function execFileHTTP(
  sprite: Sprite,
  file: string,
  args: string[] = [],
  options: HTTPExecOptions = {}
): Promise<ExecResult> {
  const url = new URL(`${sprite.client.baseURL}/v1/sprites/${encodeURIComponent(sprite.name)}/exec`);
  for (const value of [file, ...args]) url.searchParams.append('cmd', value);
  url.searchParams.set('path', file);
  if (options.cwd) url.searchParams.set('dir', options.cwd);
  for (const [key, value] of Object.entries(options.env ?? {})) {
    url.searchParams.append('env', `${key}=${value}`);
  }
  if (options.input !== undefined) url.searchParams.set('stdin', 'true');

  if (options.timeout !== undefined &&
      (!Number.isFinite(options.timeout) || options.timeout < 0)) {
    throw new TypeError('timeout must be a non-negative finite number');
  }
  const signals = [
    options.signal,
    options.timeout === undefined ? undefined : AbortSignal.timeout(options.timeout),
  ].filter((signal): signal is AbortSignal => signal !== undefined);
  const requestSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(sprite.client.token, {
      'Content-Type': 'application/octet-stream',
    }),
    body: options.input === undefined ? undefined :
      typeof options.input === 'string' ? Buffer.from(options.input) : options.input,
    signal: requestSignal,
  });
  if (!response.ok) {
    const body = await response.text();
    const error = parseAPIError(response.status, body, Object.fromEntries(response.headers.entries()));
    if (error) throw error;
    throw new Error(`Failed to execute command over HTTP (status ${response.status}): ${body}`);
  }
  if (!response.body) throw new Error('HTTP exec response has no body');

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutLength = 0;
  let stderrLength = 0;
  let exitCode = -1;
  const maxBuffer = options.maxBuffer || 10 * 1024 * 1024;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      const frameType = value[0];
      const payload = Buffer.from(value.subarray(1));
      if (frameType === 1) {
        stdoutLength += payload.length;
        if (stdoutLength > maxBuffer) throw new Error('stdout maxBuffer exceeded');
        stdout.push(payload);
      } else if (frameType === 2) {
        stderrLength += payload.length;
        if (stderrLength > maxBuffer) throw new Error('stderr maxBuffer exceeded');
        stderr.push(payload);
      } else if (frameType === 3) {
        if (payload.length !== 1) {
          throw new Error(
            `Invalid HTTP exec exit frame length ${payload.length}; ` +
            'the server protocol requires preserved HTTP chunk boundaries'
          );
        }
        exitCode = payload[0] ?? 255;
      } else {
        throw new Error(
          `Unsupported HTTP exec frame type 0x${frameType.toString(16).padStart(2, '0')}; ` +
          'the server protocol requires preserved HTTP chunk boundaries'
        );
      }
    }
    if (exitCode < 0) throw new Error('HTTP exec response did not include an exit frame');
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const stdoutBuffer = Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat(stderr);
  const encoding = options.encoding || 'utf8';
  const result: ExecResult = {
    stdout: encoding === ('buffer' as any) ? stdoutBuffer : stdoutBuffer.toString(encoding),
    stderr: encoding === ('buffer' as any) ? stderrBuffer : stderrBuffer.toString(encoding),
    exitCode,
  };
  if (exitCode !== 0) throw new ExecError(`Command failed with exit code ${exitCode}`, result);
  return result;
}

/** Kill an active exec session and stream progress events. */
export async function killSession(
  sprite: Sprite,
  sessionId: string,
  signal?: string,
  timeout?: string
): Promise<SessionKillStream> {
  const url = new URL(`${sprite.client.baseURL}/v1/sprites/${encodeURIComponent(sprite.name)}/exec/${encodeURIComponent(sessionId)}/kill`);
  if (signal) url.searchParams.set('signal', signal);
  if (timeout) url.searchParams.set('timeout', timeout);
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(sprite.client.token),
  });
  if (!response.ok) {
    const body = await response.text();
    const error = parseAPIError(response.status, body, Object.fromEntries(response.headers.entries()));
    if (error) throw error;
    throw new Error(`Failed to kill session (status ${response.status}): ${body}`);
  }
  return new SessionKillStream(response);
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
  let cc;
  try {
    cc = await sprite.getControlConnection();
  } catch (error) {
    throw new ControlConnectionUnavailableError(error);
  }

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
      let removeCancellation = () => {};

      const settler = createExecSettler(resolve, reject, () => {
        removeCancellation();
        op.close();
      });

      const cancelControlOp = (signal: string) => {
        try {
          op.signal(signal);
        } catch {
          // Closing the control connection below is the cancellation fallback.
        } finally {
          // Do not return a connection to the pool while the server may still
          // be completing its canceled operation. A later exec will establish
          // a fresh control connection.
          cc.close();
        }
      };

      op.on('stdout', (data: Buffer) => {
        if (settler.isSettled()) return;
        stdoutChunks.push(data);
        stdoutLength += data.length;
        if (stdoutLength > maxBuffer) {
          cancelControlOp('KILL');
          settler.reject(new Error(`stdout maxBuffer exceeded`));
        }
      });

      op.on('stderr', (data: Buffer) => {
        if (settler.isSettled()) return;
        stderrChunks.push(data);
        stderrLength += data.length;
        if (stderrLength > maxBuffer) {
          cancelControlOp('KILL');
          settler.reject(new Error(`stderr maxBuffer exceeded`));
        }
      });

      op.on('error', (error: Error) => {
        settler.reject(error);
      });

      // Send stdin EOF since we're not providing input
      try {
        op.sendEOF();
      } catch (error) {
        cc.close();
        settler.reject(error as Error);
      }

      if (!settler.isSettled()) {
        const cancellation = createExecCancellation(
          options,
          () => cancelControlOp('TERM'),
          settler.reject
        );
        removeCancellation = cancellation.cleanup;
        cancellation.start();
      }

      // Wait for completion
      op.wait().then((code) => {
        if (settler.isSettled()) return;
        const stdoutBuffer = Buffer.concat(stdoutChunks);
        const stderrBuffer = Buffer.concat(stderrChunks);

        const result: ExecResult = {
          stdout: encoding === ('buffer' as any) ? stdoutBuffer : stdoutBuffer.toString(encoding),
          stderr: encoding === ('buffer' as any) ? stderrBuffer : stderrBuffer.toString(encoding),
          exitCode: code,
        };

        if (code !== 0) {
          const error = new ExecError(`Command failed with exit code ${code}`, result);
          settler.reject(error);
        } else {
          settler.resolve(result);
        }
      }).catch(settler.reject);
    });
  } finally {
    // Always release the connection back to the pool
    releaseControlConnection(sprite, cc);
  }
}

function validateExecCancellationOptions(options: ExecOptions): void {
  if (
    options.timeout !== undefined &&
    (!Number.isFinite(options.timeout) || options.timeout < 0)
  ) {
    throw new TypeError('timeout must be a non-negative finite number');
  }
}

function createExecSettler<T>(
  resolve: (value: T) => void,
  reject: (error: Error) => void,
  cleanup: () => void
): {
  isSettled: () => boolean;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let settled = false;

  const settle = (complete: () => void) => {
    if (settled) return;
    settled = true;
    try {
      cleanup();
    } finally {
      complete();
    }
  };

  return {
    isSettled: () => settled,
    resolve: (value) => settle(() => resolve(value)),
    reject: (error) => settle(() => reject(error)),
  };
}

function createExecCancellation(
  options: ExecOptions,
  cancel: () => void,
  reject: (error: Error) => void
): { start: () => void; cleanup: () => void } {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const cancelAndReject = (error: Error) => {
    try {
      cancel();
    } catch {
      // Preserve the requested abort/timeout error. Cleanup still runs when
      // reject() settles the operation.
    } finally {
      reject(error);
    }
  };
  const onAbort = () => cancelAndReject(abortError());

  return {
    start: () => {
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.timeout !== undefined && options.timeout > 0) {
        timeout = setTimeout(
          () => cancelAndReject(new Error(`Command timed out after ${options.timeout} ms`)),
          options.timeout
        );
      }

      if (options.signal?.aborted) {
        onAbort();
      }
    },
    cleanup: () => {
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    },
  };
}

function abortError(): Error {
  const error = new Error('Command execution was aborted');
  error.name = 'AbortError';
  return error;
}
