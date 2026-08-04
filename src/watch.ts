import { EventEmitter } from 'node:events';
import { signalHeaders } from './client-signals.js';
import type { SpritesClient } from './client.js';
import type { FilesystemWatchEvent, PortWatchEvent } from './types.js';

class WebSocketJSONStream<T> extends EventEmitter implements AsyncIterable<T> {
  private ws: WebSocket | null = null;
  private queue: T[] = [];
  private waiters: Array<{
    resolve: (event: T | null) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private finished = false;
  private terminalError: Error | null = null;

  protected async connectURL(url: string, token: string, initialMessage?: unknown): Promise<void> {
    if (this.ws) throw new Error('Watcher already connected');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { ...signalHeaders(), 'Authorization': `Bearer ${token}` },
      });
      this.ws = ws;
      let connected = false;
      ws.addEventListener('open', () => {
        connected = true;
        if (initialMessage !== undefined) ws.send(JSON.stringify(initialMessage));
        resolve();
      });
      ws.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        try {
          const value = JSON.parse(event.data) as T;
          this.emit('event', value);
          const waiter = this.waiters.shift();
          if (waiter) waiter.resolve(value); else this.queue.push(value);
        } catch {
          // Ignore malformed event frames.
        }
      });
      ws.addEventListener('error', (event: any) => {
        const error = new Error(`WebSocket error: ${event?.message || 'unknown'} (url: ${url})`);
        if (ws.readyState === WebSocket.CONNECTING) {
          reject(error);
        } else {
          this.fail(error);
        }
      });
      ws.addEventListener('close', () => {
        if (!connected) reject(new Error(`WebSocket closed before open (url: ${url})`));
        this.finish();
      });
    });
  }

  async next(): Promise<T | null> {
    const event = this.queue.shift();
    if (event !== undefined) return event;
    if (this.terminalError) throw this.terminalError;
    if (this.closed) return null;
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ws?.close(1000, '');
    this.finish();
  }

  isClosed(): boolean {
    return this.closed;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    try {
      let event: T | null;
      while ((event = await this.next()) !== null) yield event;
    } finally {
      this.close();
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.closed) this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve(null);
    this.emit('close');
  }

  private fail(error: Error): void {
    if (this.finished) return;
    this.terminalError = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    this.finish();
    if (this.listenerCount('error') > 0) this.emit('error', error);
  }
}

export class PortWatcher extends WebSocketJSONStream<PortWatchEvent> {
  constructor(private client: SpritesClient, private spriteName: string) { super(); }

  async connect(): Promise<void> {
    let baseURL = this.client.baseURL;
    if (baseURL.startsWith('http')) baseURL = `ws${baseURL.slice(4)}`;
    await this.connectURL(
      `${baseURL}/v1/sprites/${encodeURIComponent(this.spriteName)}/ports/watch`,
      this.client.token
    );
  }
}

export class FilesystemWatcher extends WebSocketJSONStream<FilesystemWatchEvent> {
  constructor(
    private client: SpritesClient,
    private spriteName: string,
    private paths: string[],
    private workingDir: string,
    private recursive: boolean
  ) { super(); }

  async connect(): Promise<void> {
    let baseURL = this.client.baseURL;
    if (baseURL.startsWith('http')) baseURL = `ws${baseURL.slice(4)}`;
    await this.connectURL(
      `${baseURL}/v1/sprites/${encodeURIComponent(this.spriteName)}/fs/watch`,
      this.client.token,
      { type: 'subscribe', paths: this.paths, recursive: this.recursive, workingDir: this.workingDir }
    );
  }
}
