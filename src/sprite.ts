/**
 * Sprite class representing a sprite instance
 */

import { SpritesClient } from './client.js';
import { SpriteCommand } from './exec.js';
import type { SpriteExecAPI } from './api.js';
import type {
  SpawnOptions,
  ExecOptions,
  ExecResult,
  Session,
  SpriteConfig,
} from './types.js';

/**
 * Represents a sprite instance
 */
export class Sprite {
  // Core properties
  readonly name: string;
  readonly client: SpritesClient;
  private api!: SpriteExecAPI;
  private connectPromise: Promise<void> | null = null;

  // Additional properties from API
  id?: string;
  organizationName?: string;
  status?: string;
  config?: SpriteConfig;
  environment?: Record<string, string>;
  createdAt?: Date;
  updatedAt?: Date;
  bucketName?: string;
  primaryRegion?: string;

  constructor(name: string, client: SpritesClient) {
    this.name = name;
    this.client = client;
  }

  // Internal: set the exec API implementation after initialization
  setAPI(api: SpriteExecAPI): void {
    this.api = api;
  }

  // Establish API selection by probing control endpoint; idempotent
  async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = (async () => {
      const fetchFn: any = (globalThis as any).fetch;
      const AbortSignalAny: any = (globalThis as any).AbortSignal;
      const url = `${this.client.baseURL}/v1/sprites/${this.name}/control`;
      const resp = await fetchFn(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.client.token}` },
        signal: AbortSignalAny.timeout(5000),
      });

      if (resp.status === 502) {
        throw new Error(`Sprite not found: ${this.name}`);
      }

      if (resp.status === 404) {
        // Exists but no control
        const { EndpointAPI } = await import('./endpoint_api.js');
        this.api = new EndpointAPI();
        return;
      }

      const { ControlAPI } = await import('./control_api.js');
      this.api = new ControlAPI(this);
    })();
    return this.connectPromise;
  }

  private ensureAPI(): SpriteExecAPI {
    if (!this.api) {
      throw new Error('Sprite not initialized. Use await client.sprite(name) to obtain a ready-to-use Sprite.');
    }
    return this.api;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    if (!this.api) {
      await this.connect();
    }
  }

  /**
   * Spawn a command on the sprite (event-based API, most Node.js-like)
   */
  spawn(command: string, args: string[] = [], options: SpawnOptions = {}): SpriteCommand {
    // spawn should return immediately; ensure connection asynchronously
    // but delay actual WS start until connect resolves by creating command after ensureConnected
    // To keep API simple, we create a command now and start it after connection inside exec helpers
    const startAfterConnect = async (cmd: SpriteCommand) => {
      try {
        await this.ensureConnected();
        // No-op: SpriteCommand.start() is invoked by factory in exec helpers; for spawn, it's already started
      } catch (e) {
        // Surface error via stderr to avoid relying on EventEmitter typings here
        const msg = String((e as Error).message || e);
        (cmd as any).stderr?.push(msg);
      }
    };
    const api = this.ensureAPI();
    const cmd = api.createCommand(this, command, args, options);
    void startAfterConnect(cmd);
    return cmd;
  }

  /**
   * Execute a command and return a promise with the output
   */
  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    await this.ensureConnected();
    const api = this.ensureAPI();
    return api.exec(this, command, options);
  }

  /**
   * Execute a file with arguments and return a promise with the output
   */
  async execFile(file: string, args: string[] = [], options: ExecOptions = {}): Promise<ExecResult> {
    await this.ensureConnected();
    const api = this.ensureAPI();
    return api.execFile(this, file, args, options);
  }

  /**
   * Create a detachable tmux session
   */
  createSession(command: string, args: string[] = [], options: SpawnOptions = {}): SpriteCommand {
    const api = this.ensureAPI();
    const cmd = api.createCommand(this, command, args, {
      ...options,
      detachable: true,
      tty: true,
    });
    void (async () => {
      try { await this.ensureConnected(); } catch (e) {
        const msg = String((e as Error).message || e);
        (cmd as any).stderr?.push(msg);
      }
    })();
    return cmd;
  }

  /**
   * Attach to an existing session
   */
  attachSession(sessionId: string, options: SpawnOptions = {}): SpriteCommand {
    const api = this.ensureAPI();
    const cmd = api.createCommand(this, 'tmux', ['attach', '-t', sessionId], {
      ...options,
      sessionId,
      tty: true,
    });
    void (async () => {
      try { await this.ensureConnected(); } catch (e) {
        const msg = String((e as Error).message || e);
        (cmd as any).stderr?.push(msg);
      }
    })();
    return cmd;
  }

  /**
   * List active sessions
   */
  async listSessions(): Promise<Session[]> {
    await this.ensureConnected();
    const api = this.ensureAPI();
    return api.listSessions(this);
  }

  /**
   * Delete this sprite
   */
  async delete(): Promise<void> {
    await this.client.deleteSprite(this.name);
  }

  /**
   * Alias for delete()
   */
  async destroy(): Promise<void> {
    await this.delete();
  }

  /**
   * Upgrade this sprite to the latest version
   */
  async upgrade(): Promise<void> {
    await this.client.upgradeSprite(this.name);
  }
}

