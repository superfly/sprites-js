/**
 * Sprite class representing a sprite instance
 */

import { SpritesClient } from './client.js';
import { SpriteCommand, spawn, exec, execFile } from './exec.js';
import type {
  SpawnOptions,
  ExecOptions,
  ExecResult,
  Session,
  SpriteConfig,
  Checkpoint,
} from './types.js';

/**
 * Represents a sprite instance
 */
export class Sprite {
  // Core properties
  readonly name: string;
  readonly client: SpritesClient;

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

  /**
   * Spawn a command on the sprite (event-based API, most Node.js-like)
   */
  spawn(command: string, args: string[] = [], options: SpawnOptions = {}): SpriteCommand {
    return spawn(this, command, args, options);
  }

  /**
   * Execute a command and return a promise with the output
   */
  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return exec(this, command, options);
  }

  /**
   * Execute a file with arguments and return a promise with the output
   */
  async execFile(file: string, args: string[] = [], options: ExecOptions = {}): Promise<ExecResult> {
    return execFile(this, file, args, options);
  }

  /**
   * Create a detachable tmux session
   */
  createSession(command: string, args: string[] = [], options: SpawnOptions = {}): SpriteCommand {
    return spawn(this, command, args, {
      ...options,
      detachable: true,
      tty: true,
    });
  }

  /**
   * Attach to an existing session
   */
  attachSession(sessionId: string, options: SpawnOptions = {}): SpriteCommand {
    return spawn(this, 'tmux', ['attach', '-t', sessionId], {
      ...options,
      sessionId,
      tty: true,
    });
  }

  /**
   * List active sessions
   */
  async listSessions(): Promise<Session[]> {
    const response = await fetch(`${this.client.baseURL}/v1/sprites/${this.name}/exec`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list sessions (status ${response.status}): ${body}`);
    }

    const result: any = await response.json();
    const sessions: Session[] = [];

    if (result.sessions && Array.isArray(result.sessions)) {
      for (const s of result.sessions) {
        const session: Session = {
          id: s.id,
          command: s.command,
          created: new Date(s.created),
          bytesPerSecond: s.bytes_per_second || 0,
          isActive: s.is_active || false,
        };

        if (s.last_activity) {
          session.lastActivity = new Date(s.last_activity);
        }

        sessions.push(session);
      }
    }

    return sessions;
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

  /**
   * Create a checkpoint with an optional comment.
   * Returns the streaming Response (NDJSON). Caller is responsible for consuming the stream.
   */
  async createCheckpoint(comment?: string): Promise<Response> {
    const body: any = {};
    if (comment) body.comment = comment;
    const response = await fetch(`${this.client.baseURL}/v1/sprites/${this.name}/checkpoint`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // No timeout: checkpoint streams can be long-running
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create checkpoint (status ${response.status}): ${text}`);
    }
    return response;
  }

  /**
   * List checkpoints
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    const response = await fetch(`${this.client.baseURL}/v1/sprites/${this.name}/checkpoints`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to list checkpoints (status ${response.status}): ${text}`);
    }
    const raw = await response.json() as any[];
    return raw.map((cp) => ({
      id: cp.id,
      createTime: new Date(cp.create_time),
      comment: cp.comment,
      history: cp.history,
    }));
  }

  /**
   * Get checkpoint details
   */
  async getCheckpoint(id: string): Promise<Checkpoint> {
    const response = await fetch(`${this.client.baseURL}/v1/sprites/${this.name}/checkpoints/${id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404) {
      throw new Error(`Checkpoint not found: ${id}`);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get checkpoint (status ${response.status}): ${text}`);
    }
    const cp = await response.json() as any;
    return {
      id: cp.id,
      createTime: new Date(cp.create_time),
      comment: cp.comment,
      history: cp.history,
    };
  }

  /**
   * Restore from a checkpoint. Returns the streaming Response (NDJSON).
   */
  async restoreCheckpoint(id: string): Promise<Response> {
    const response = await fetch(`${this.client.baseURL}/v1/sprites/${this.name}/checkpoints/${id}/restore`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
      },
      // No timeout: restore streams can be long-running
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to restore checkpoint (status ${response.status}): ${text}`);
    }
    return response;
  }
}

