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
}

