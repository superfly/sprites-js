/**
 * WebSocket communication layer for command execution
 *
 * Note: The standard WebSocket API does not expose HTTP error responses
 * on connection failure. For structured APIError handling, see the HTTP
 * client methods in client.ts which use parseAPIError.
 */

import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { StreamID, ControlMessage } from './types.js';

// WebSocket keepalive timeouts (matching Go SDK)
const WS_PING_INTERVAL = 15_000; // 15 seconds
const WS_PONG_WAIT = 45_000; // 45 seconds

/**
 * WebSocket command execution handler
 */
export class WSCommand extends EventEmitter {
  private ws: WebSocket | null = null;
  private exitCode: number = -1;
  private tty: boolean;
  private started: boolean = false;
  private done: boolean = false;
  private closeError: Error | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPongTime: number = 0;

  /** Whether this is attaching to an existing session */
  isAttach: boolean = false;

  readonly stdout: Writable;
  readonly stderr: Writable;

  constructor(
    private url: string,
    private headers: Record<string, string>,
    tty: boolean = false
  ) {
    super();
    this.tty = tty;
    this.stdout = new Writable({
      write: () => {}, // No-op, actual writing happens in message handler
    });
    this.stderr = new Writable({
      write: () => {}, // No-op, actual writing happens in message handler
    });
  }

  /**
   * Start the WebSocket connection
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('WSCommand already started');
    }
    this.started = true;

    return new Promise((resolve, reject) => {
      let resolved = false;

      try {
        this.ws = new WebSocket(this.url, {
          headers: this.headers,
        });

        this.ws.binaryType = 'arraybuffer';

        this.ws.addEventListener('open', async () => {
          // When attaching to an existing session, wait for session_info to determine TTY mode
          if (this.isAttach) {
            try {
              await this.waitForSessionInfo();
            } catch (err) {
              reject(err);
              return;
            }
          }

          // Start keepalive ping/pong
          this.startKeepalive();

          resolved = true;
          resolve();
        });

        this.ws.addEventListener('error', () => {
          if (this.done) return; // Ignore errors after exit (close race)
          const error = new Error('WebSocket error');
          if (!resolved) {
            this.emit('error', error);
            reject(error);
          } else {
            // Post-connection error: store it for handleClose to use.
            // Don't emit here - handleClose always fires after error
            // and will determine the proper outcome.
            this.closeError = error;
          }
        });

        this.ws.addEventListener('message', (event) => {
          this.handleMessage(event);
        });

        this.ws.addEventListener('close', (event) => {
          this.handleClose(event);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Wait for session_info message when attaching to a session.
   * Sets TTY mode based on the session's actual mode.
   */
  private waitForSessionInfo(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for session_info'));
      }, 10_000);

      const messageHandler = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          try {
            const info = JSON.parse(event.data);
            if (info.type === 'session_info') {
              clearTimeout(timeout);
              this.ws?.removeEventListener('message', messageHandler);
              this.tty = info.tty === true;
              this.emit('message', info);
              resolve();
              return;
            }
            // Pass other text messages to handler
            this.emit('message', info);
          } catch {
            // Not JSON, ignore during session_info wait
          }
        }
        // Ignore binary messages during this phase - they're historical output
      };

      this.ws?.addEventListener('message', messageHandler);
    });
  }

  /**
   * Start keepalive ping/pong mechanism
   */
  private startKeepalive(): void {
    this.lastPongTime = Date.now();

    // Send pings at regular intervals
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopKeepalive();
        return;
      }

      // Check if we've received a pong recently
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      if (timeSinceLastPong > WS_PONG_WAIT) {
        // Connection appears dead
        this.emit('error', new Error('WebSocket keepalive timeout'));
        this.close();
        return;
      }

      // Note: Browser WebSocket API doesn't expose ping/pong directly.
      // Node.js WebSocket implementation may support it differently.
      // The server-side handles keepalive; we just track activity.
    }, WS_PING_INTERVAL);
  }

  /**
   * Stop keepalive mechanism
   */
  private stopKeepalive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Reset keepalive timer (call on any message received)
   */
  private resetKeepalive(): void {
    this.lastPongTime = Date.now();
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(event: MessageEvent): void {
    // Reset keepalive on any message received
    this.resetKeepalive();

    if (this.tty) {
      // TTY mode
      if (typeof event.data === 'string') {
        // Text message - control or notification
        try {
          const msg = JSON.parse(event.data);
          // Handle exit message from server
          if (msg.type === 'exit' && typeof msg.exit_code === 'number') {
            this.exitCode = msg.exit_code;
            if (!this.done) {
              this.done = true;
              this.emit('exit', this.exitCode);
            }
          }
          this.emit('message', msg);
        } catch {
          // Not JSON, treat as raw text
          this.emit('message', event.data);
        }
      } else {
        // Binary - raw terminal data
        const buffer = Buffer.from(event.data as ArrayBuffer);
        this.emit('stdout', buffer);
      }
    } else {
      // Non-TTY mode - stream-based protocol
      const data = Buffer.from(event.data as ArrayBuffer);
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
          this.exitCode = payload.length > 0 ? payload[0] : 0;
          if (!this.done) {
            this.done = true;
            this.emit('exit', this.exitCode);
          }
          this.close();
          break;
      }
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(event: CloseEvent): void {
    this.stopKeepalive();

    if (!this.done) {
      this.done = true;

      // In non-TTY mode, we always expect an exit frame before close.
      // If we never got one, emit an error regardless of close code.
      if (!this.tty && this.exitCode === -1) {
        const error = this.closeError || new Error(`WebSocket closed without exit frame (code ${event.code})`);
        this.emit('error', error);
        return;
      }

      // In TTY mode, determine exit code from the close event if no exit message was received.
      if (this.tty && this.exitCode === -1) {
        this.exitCode = event.code === 1000 ? 0 : 1;
      }

      this.emit('exit', this.exitCode);
    }
  }

  /**
   * Write data to stdin
   */
  writeStdin(data: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }

    if (this.tty) {
      this.ws.send(data);
    } else {
      const message = Buffer.allocUnsafe(data.length + 1);
      message[0] = StreamID.Stdin;
      data.copy(message, 1);
      this.ws.send(message);
    }
  }

  /**
   * Send stdin EOF
   */
  sendStdinEOF(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (!this.tty) {
      const message = Buffer.from([StreamID.StdinEOF]);
      this.ws.send(message);
    }
  }

  /**
   * Send resize control message (TTY only)
   */
  resize(cols: number, rows: number): void {
    if (!this.tty || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const msg: ControlMessage = { type: 'resize', cols, rows };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send a signal to the remote process
   */
  signal(sig: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const msg = { type: 'signal', signal: sig };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Get the current TTY mode
   */
  isTTY(): boolean {
    return this.tty;
  }

  /**
   * Get the exit code
   */
  getExitCode(): number {
    return this.exitCode;
  }

  /**
   * Check if the command is done
   */
  isDone(): boolean {
    return this.done;
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    this.stopKeepalive();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, '');
    }
  }

  /**
   * Wait for the command to complete
   */
  async wait(): Promise<number> {
    if (this.done) {
      return this.exitCode;
    }

    return new Promise((resolve) => {
      this.once('exit', (code) => {
        resolve(code);
      });
    });
  }
}

