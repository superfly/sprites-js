/**
 * EndpointAPI implements the existing behavior using the /exec endpoint.
 */

import type { Sprite } from './sprite.js';
import type { ExecResult, ExecOptions, SpawnOptions, Session } from './types.js';
import { SpriteCommand, exec as execFn, execFile as execFileFn, spawn as spawnFn } from './exec.js';
import type { SpriteExecAPI } from './api.js';

export class EndpointAPI implements SpriteExecAPI {
  createCommand(sprite: Sprite, command: string, args: string[] = [], options: SpawnOptions = {}): SpriteCommand {
    return spawnFn(sprite, command, args, options);
  }

  async exec(sprite: Sprite, command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return execFn(sprite, command, options);
  }

  async execFile(sprite: Sprite, file: string, args: string[] = [], options: ExecOptions = {}): Promise<ExecResult> {
    return execFileFn(sprite, file, args, options);
  }

  async listSessions(sprite: Sprite): Promise<Session[]> {
    const fetchFn: any = (globalThis as any).fetch;
    const AbortSignalAny: any = (globalThis as any).AbortSignal;
    const response = await fetchFn(`${sprite.client.baseURL}/v1/sprites/${sprite.name}/exec`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sprite.client.token}`,
      },
      signal: AbortSignalAny.timeout(30000),
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
        if (s.last_activity) session.lastActivity = new Date(s.last_activity);
        sessions.push(session);
      }
    }
    return sessions;
  }
}


