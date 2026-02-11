/**
 * Control connection for multiplexed operations over a single WebSocket.
 */

import { EventEmitter } from 'node:events';
import type { Sprite } from './sprite.js';
import { StreamID } from './types.js';

// Control envelope protocol constants (must match server's pkg/wss).
const CONTROL_PREFIX = 'control:';
const TYPE_OP_START = 'op.start';
const TYPE_OP_COMPLETE = 'op.complete';
const TYPE_OP_ERROR = 'op.error';

/**
 * Control message envelope
 */
interface ControlMessage {
  type: string;
  op?: string;
  args?: Record<string, unknown>;
}

/**
 * Options for starting an operation
 */
export interface StartOpOptions {
  /** Command arguments */
  cmd?: string[];
  /** Environment variables */
  env?: string[];
  /** Working directory */
  dir?: string;
  /** Enable TTY mode */
  tty?: boolean;
  /** TTY rows */
  rows?: number;
  /** TTY columns */
  cols?: number;
  /** Whether stdin is expected */
  stdin?: boolean;
}

/**
 * OpConn represents an active operation on a control connection.
 * It provides methods for reading/writing data frames during the operation.
 */
export class OpConn extends EventEmitter {
  private closed: boolean = false;
  private exitCode: number = -1;

  constructor(
    private cc: ControlConnection,
    private tty: boolean
  ) {
    super();
  }

  /**
   * Write data to the operation (stdin)
   */
  write(data: Buffer): void {
    if (this.closed) {
      throw new Error('Operation closed');
    }

    if (this.tty) {
      // PTY mode - send raw data
      this.cc.sendData(data);
    } else {
      // Non-PTY mode - prepend stream ID
      const message = Buffer.allocUnsafe(data.length + 1);
      message[0] = StreamID.Stdin;
      data.copy(message, 1);
      this.cc.sendData(message);
    }
  }

  /**
   * Send stdin EOF
   */
  sendEOF(): void {
    if (this.closed || this.tty) return;
    this.cc.sendData(Buffer.from([StreamID.StdinEOF]));
  }

  /**
   * Send resize control message (TTY only)
   */
  resize(cols: number, rows: number): void {
    if (!this.tty) return;
    const msg = JSON.stringify({ type: 'resize', cols, rows });
    this.cc.sendData(Buffer.from(msg));
  }

  /**
   * Send signal to remote process
   */
  signal(sig: string): void {
    const msg = JSON.stringify({ type: 'signal', signal: sig });
    this.cc.sendData(Buffer.from(msg));
  }

  /**
   * Handle incoming data frame
   */
  handleData(data: Buffer): void {
    if (this.tty) {
      // PTY mode - emit raw output
      this.emit('stdout', data);
    } else {
      // Non-PTY mode - parse stream prefix
      if (data.length === 0) return;

      const streamId = data[0] as StreamID;
      const payload = data.subarray(1);

      switch (streamId) {
        case StreamID.Stdout:
          this.emit('stdout', payload);
          break;
        case StreamID.Stderr:
          this.emit('stderr', payload);
          break;
        case StreamID.Exit:
          // Store exit code but DON'T close yet
          // Wait for op.complete message to ensure proper sequencing
          this.exitCode = payload.length > 0 ? payload[0] : 0;
          this.emit('exit', this.exitCode);
          break;
      }
    }
  }

  /**
   * Handle text message (session_info, notifications, etc.)
   */
  handleText(data: string): void {
    try {
      const msg = JSON.parse(data);
      this.emit('message', msg);
    } catch {
      // Not JSON, ignore
    }
  }

  /**
   * Mark operation as complete
   */
  complete(exitCode?: number): void {
    if (this.closed) return;
    this.closed = true;
    if (exitCode !== undefined) {
      this.exitCode = exitCode;
    }
    this.emit('close');
  }

  /**
   * Close the operation
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  /**
   * Whether the operation is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get exit code (-1 if not exited)
   */
  getExitCode(): number {
    return this.exitCode;
  }

  /**
   * Wait for operation to complete
   */
  async wait(): Promise<number> {
    if (this.closed) {
      return this.exitCode;
    }

    return new Promise((resolve) => {
      this.once('close', () => {
        resolve(this.exitCode);
      });
    });
  }
}

/**
 * ControlConnection manages a persistent WebSocket connection for multiplexed operations.
 */
export class ControlConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private opActive: boolean = false;
  private opConn: OpConn | null = null;
  private closed: boolean = false;
  private closeError: Error | null = null;
  private poolActive: boolean = false; // Tracks if connection is in use by pool

  constructor(
    private sprite: Sprite
  ) {
    super();
  }

  /**
   * Check if this connection is marked as active (in use) by the pool
   */
  isActive(): boolean {
    return this.poolActive;
  }

  /**
   * Set the pool active state
   */
  setActive(active: boolean): void {
    this.poolActive = active;
  }

  /**
   * Clear the operation connection (called by pool on release)
   */
  clearOpConn(): void {
    this.opConn = null;
  }

  /**
   * Connect to the control endpoint
   */
  async connect(): Promise<void> {
    if (this.ws) {
      throw new Error('Already connected');
    }

    // Build WebSocket URL
    let baseURL = this.sprite.client.baseURL;
    if (baseURL.startsWith('http')) {
      baseURL = 'ws' + baseURL.substring(4);
    }

    const url = `${baseURL}/v1/sprites/${this.sprite.name}/control`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, {
          headers: {
            'Authorization': `Bearer ${this.sprite.client.token}`,
          },
        });

        this.ws.binaryType = 'arraybuffer';

        let connected = false;

        this.ws.addEventListener('open', () => {
          connected = true;
          resolve();
        });

        this.ws.addEventListener('error', (event: any) => {
          const msg = event?.message || event?.error?.message || event?.error || 'unknown';
          const error = new Error(`WebSocket error: ${msg} (url: ${url})`);
          this.closeError = error;
          if (connected) {
            // Post-connection error: emit on EventEmitter for listeners
            this.emit('error', error);
          } else {
            // Pre-connection error: reject the connect() promise
            reject(error);
          }
        });

        this.ws.addEventListener('message', (event) => {
          this.handleMessage(event);
        });

        this.ws.addEventListener('close', () => {
          this.handleClose();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    // Check for control message
    if (typeof event.data === 'string' && event.data.startsWith(CONTROL_PREFIX)) {
      const payload = event.data.substring(CONTROL_PREFIX.length);
      try {
        const msg = JSON.parse(payload) as ControlMessage;
        this.handleControlMessage(msg);
      } catch {
        // Malformed control message, ignore
      }
      return;
    }

    // Data frame - deliver to active operation
    if (this.opConn) {
      if (typeof event.data === 'string') {
        this.opConn.handleText(event.data);
      } else {
        this.opConn.handleData(Buffer.from(event.data as ArrayBuffer));
      }
    }
  }

  /**
   * Handle control envelope message
   */
  private handleControlMessage(msg: ControlMessage): void {
    switch (msg.type) {
      case TYPE_OP_COMPLETE:
        if (this.opConn) {
          const exitCode = (msg.args?.exitCode as number) ?? 0;
          this.opConn.complete(exitCode);
        }
        this.opActive = false;
        this.opConn = null;
        break;

      case TYPE_OP_ERROR:
        if (this.opConn) {
          const error = (msg.args?.error as string) ?? 'unknown error';
          this.opConn.emit('error', new Error(error));
          this.opConn.complete();
        }
        this.opActive = false;
        this.opConn = null;
        break;
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(): void {
    this.closed = true;
    if (this.opConn) {
      this.opConn.close();
    }
    this.emit('close');
  }

  /**
   * Start a new operation
   */
  async startOp(op: string, options: StartOpOptions = {}): Promise<OpConn> {
    if (this.closed) {
      throw new Error(`Control connection closed: ${this.closeError?.message || 'unknown'}`);
    }

    if (this.opActive) {
      throw new Error('Operation already in progress');
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    this.opActive = true;
    const opConn = new OpConn(this, options.tty || false);
    this.opConn = opConn;

    // Build args for the control message
    const args: Record<string, unknown> = {};
    if (options.cmd) args.cmd = options.cmd;
    if (options.env) args.env = options.env;
    if (options.dir) args.dir = options.dir;
    if (options.tty) args.tty = 'true';
    if (options.rows) args.rows = options.rows.toString();
    if (options.cols) args.cols = options.cols.toString();
    if (options.stdin !== undefined) args.stdin = options.stdin ? 'true' : 'false';

    // Send op.start
    const ctrlMsg: ControlMessage = {
      type: TYPE_OP_START,
      op,
      args,
    };
    this.sendControl(ctrlMsg);

    return opConn;
  }

  /**
   * Send control envelope
   */
  private sendControl(msg: ControlMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const frame = CONTROL_PREFIX + JSON.stringify(msg);
    this.ws.send(frame);
  }

  /**
   * Send data frame
   */
  sendData(data: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(data);
  }

  /**
   * Close the control connection
   */
  close(): void {
    if (this.opConn) {
      this.opConn.close();
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, '');
    }
    this.closed = true;
  }

  /**
   * Whether the connection is closed
   */
  isClosed(): boolean {
    return this.closed;
  }
}

// Pool configuration (matches Go SDK)
const MAX_POOL_SIZE = 100; // Sanity cap - checkout fails if pool is full
const POOL_DRAIN_THRESHOLD = 20; // When release and size > this, drain idle conns
const POOL_DRAIN_TARGET = 10; // Drain down to this many conns when draining

/**
 * ControlPool manages a pool of control connections for concurrent operations.
 */
export class ControlPool {
  private conns: ControlConnection[] = [];
  private waiters: Array<{
    resolve: (cc: ControlConnection) => void;
    reject: (err: Error) => void;
  }> = [];
  private closed: boolean = false;

  constructor(
    private sprite: Sprite,
    private maxSize: number = MAX_POOL_SIZE
  ) {}

  /**
   * Acquire a connection from the pool.
   * Creates a new connection if the pool isn't full, otherwise waits.
   */
  async acquire(): Promise<ControlConnection> {
    if (this.closed) {
      throw new Error('Pool is closed');
    }

    // Try to find an available connection
    for (const cc of this.conns) {
      if (!cc.isClosed() && !cc.isActive()) {
        cc.setActive(true);
        return cc;
      }
    }

    // If pool isn't full, create a new connection
    if (this.conns.length < this.maxSize) {
      const cc = new ControlConnection(this.sprite);
      await cc.connect();
      this.conns.push(cc);
      cc.setActive(true);
      return cc;
    }

    // Pool is full, wait for a connection
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /**
   * Release a connection back to the pool.
   */
  release(cc: ControlConnection): void {
    cc.setActive(false);
    cc.clearOpConn();

    // If there are waiters, give them this connection
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      cc.setActive(true);
      waiter.resolve(cc);
      return;
    }

    // Try to drain idle connections if pool is large
    this.tryDrain();
  }

  /**
   * Drain idle connections when pool is large.
   * When pool size exceeds POOL_DRAIN_THRESHOLD, close idle connections
   * down to POOL_DRAIN_TARGET.
   */
  private tryDrain(): void {
    if (this.closed || this.conns.length <= POOL_DRAIN_THRESHOLD) {
      return;
    }

    // Find idle connections (not active, not closed)
    const idleConns = this.conns.filter(
      (cc) => !cc.isActive() && !cc.isClosed()
    );

    const toClose = this.conns.length - POOL_DRAIN_TARGET;
    if (toClose <= 0) {
      return;
    }

    // Close idle connections
    let closed = 0;
    for (const cc of idleConns) {
      if (closed >= toClose) break;
      cc.close();
      this.conns = this.conns.filter((c) => c !== cc);
      closed++;
    }
  }

  /**
   * Close all connections in the pool.
   */
  close(): void {
    this.closed = true;

    // Cancel all waiters
    for (const waiter of this.waiters) {
      waiter.reject(new Error('Pool is closed'));
    }
    this.waiters = [];

    // Close all connections
    for (const cc of this.conns) {
      cc.close();
    }
    this.conns = [];
  }

  /**
   * Get the current number of connections in the pool.
   */
  size(): number {
    return this.conns.length;
  }

  /**
   * Check if the pool has any active connections.
   */
  hasConnections(): boolean {
    return this.conns.length > 0;
  }
}

/**
 * Get or create a control pool for a sprite.
 */
const controlPools = new WeakMap<Sprite, ControlPool>();

export async function getControlConnection(sprite: Sprite): Promise<ControlConnection> {
  let pool = controlPools.get(sprite);

  // Get or create pool
  if (!pool) {
    pool = new ControlPool(sprite);
    controlPools.set(sprite, pool);
  }

  return pool.acquire();
}

export function releaseControlConnection(sprite: Sprite, cc: ControlConnection): void {
  const pool = controlPools.get(sprite);
  if (pool) {
    pool.release(cc);
  }
}

export function closeControlConnection(sprite: Sprite): void {
  const pool = controlPools.get(sprite);
  if (pool) {
    pool.close();
    controlPools.delete(sprite);
  }
}

export function hasControlConnection(sprite: Sprite): boolean {
  const pool = controlPools.get(sprite);
  return pool !== undefined && pool.hasConnections();
}
