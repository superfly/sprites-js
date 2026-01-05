/**
 * Port forwarding/proxy implementation for Sprites
 */

import { EventEmitter } from 'node:events';
import { createServer, Socket, Server } from 'node:net';
import type { PortMapping, ProxyInitMessage, ProxyResponseMessage } from './types.js';

/**
 * Represents an active port proxy session
 */
export class ProxySession extends EventEmitter {
  readonly localPort: number;
  readonly remotePort: number;
  readonly remoteHost: string;

  private server: Server | null = null;
  private connections: Map<Socket, WebSocket> = new Map();
  private closed = false;

  constructor(
    private client: { baseURL: string; token: string },
    private spriteName: string,
    mapping: PortMapping
  ) {
    super();
    this.localPort = mapping.localPort;
    this.remotePort = mapping.remotePort;
    this.remoteHost = mapping.remoteHost || 'localhost';
  }

  /**
   * Start the proxy listener
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        if (!this.closed) {
          this.emit('error', err);
        }
        reject(err);
      });

      this.server.listen(this.localPort, 'localhost', () => {
        resolve();
      });
    });
  }

  /**
   * Handle an incoming local connection
   */
  private async handleConnection(localSocket: Socket): Promise<void> {
    // Build WebSocket URL
    let baseURL = this.client.baseURL;
    if (baseURL.startsWith('http')) {
      baseURL = 'ws' + baseURL.substring(4);
    }
    const wsURL = `${baseURL}/v1/sprites/${this.spriteName}/proxy`;

    try {
      const ws = new WebSocket(wsURL, {
        headers: {
          'Authorization': `Bearer ${this.client.token}`,
        },
      });

      ws.binaryType = 'arraybuffer';

      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve());
        ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')));
      });

      // Send initialization message
      const initMsg: ProxyInitMessage = {
        host: this.remoteHost,
        port: this.remotePort,
      };
      ws.send(JSON.stringify(initMsg));

      // Wait for response
      const response = await new Promise<ProxyResponseMessage>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for proxy response'));
        }, 10_000);

        const messageHandler = (event: MessageEvent) => {
          if (typeof event.data === 'string') {
            clearTimeout(timeout);
            ws.removeEventListener('message', messageHandler);
            try {
              resolve(JSON.parse(event.data) as ProxyResponseMessage);
            } catch {
              reject(new Error('Invalid proxy response'));
            }
          }
        };
        ws.addEventListener('message', messageHandler);
      });

      if (response.status !== 'connected') {
        ws.close();
        localSocket.destroy();
        return;
      }

      // Store the connection
      this.connections.set(localSocket, ws);

      // Set up bidirectional forwarding
      // Local -> WebSocket
      localSocket.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      localSocket.on('end', () => {
        ws.close();
        this.connections.delete(localSocket);
      });

      localSocket.on('error', () => {
        ws.close();
        this.connections.delete(localSocket);
      });

      // WebSocket -> Local
      ws.addEventListener('message', (event) => {
        if (event.data instanceof ArrayBuffer) {
          const buffer = Buffer.from(event.data);
          if (!localSocket.destroyed) {
            localSocket.write(buffer);
          }
        }
      });

      ws.addEventListener('close', () => {
        if (!localSocket.destroyed) {
          localSocket.end();
        }
        this.connections.delete(localSocket);
      });

      ws.addEventListener('error', () => {
        if (!localSocket.destroyed) {
          localSocket.destroy();
        }
        this.connections.delete(localSocket);
      });
    } catch (err) {
      localSocket.destroy();
      this.emit('error', err);
    }
  }

  /**
   * Get the local address of the proxy listener
   */
  localAddr(): string | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (typeof addr === 'string') return addr;
    if (addr) return `localhost:${addr.port}`;
    return null;
  }

  /**
   * Close the proxy session
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    // Close all active connections
    for (const [socket, ws] of this.connections) {
      ws.close();
      socket.destroy();
    }
    this.connections.clear();

    // Close the server
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.emit('close');
  }

  /**
   * Wait for the proxy session to close
   */
  async wait(): Promise<void> {
    if (this.closed) return;
    return new Promise((resolve) => {
      this.once('close', resolve);
    });
  }
}

/**
 * Manages multiple proxy sessions
 */
export class ProxyManager {
  private sessions: ProxySession[] = [];

  /**
   * Add a session to the manager
   */
  addSession(session: ProxySession): void {
    this.sessions.push(session);
  }

  /**
   * Close all managed proxy sessions
   */
  closeAll(): void {
    for (const session of this.sessions) {
      session.close();
    }
    this.sessions = [];
  }

  /**
   * Wait for all proxy sessions to close
   */
  async waitAll(): Promise<void> {
    await Promise.all(this.sessions.map((s) => s.wait()));
  }
}

/**
 * Create a proxy session for a single port
 */
export async function proxyPort(
  client: { baseURL: string; token: string },
  spriteName: string,
  localPort: number,
  remotePort: number,
  remoteHost?: string
): Promise<ProxySession> {
  const session = new ProxySession(client, spriteName, {
    localPort,
    remotePort,
    remoteHost,
  });
  await session.start();
  return session;
}

/**
 * Create proxy sessions for multiple port mappings
 */
export async function proxyPorts(
  client: { baseURL: string; token: string },
  spriteName: string,
  mappings: PortMapping[]
): Promise<ProxySession[]> {
  const sessions: ProxySession[] = [];

  for (const mapping of mappings) {
    try {
      const session = new ProxySession(client, spriteName, mapping);
      await session.start();
      sessions.push(session);
    } catch (err) {
      // Clean up any sessions we already created
      for (const s of sessions) {
        s.close();
      }
      throw err;
    }
  }

  return sessions;
}
