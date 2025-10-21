/**
 * ControlAPI probes control connection at init and uses it for exec.
 * For now, control exec uses the same /exec WebSocket endpoint with cc=true.
 * If a dedicated control channel is introduced later, wire it here.
 */

import type { Sprite } from './sprite.js';
import type { ExecResult, ExecOptions, SpawnOptions, Session } from './types.js';
import { SpriteCommand, exec as execFn, execFile as execFileFn, spawn as spawnFn } from './exec.js';
import type { SpriteExecAPI } from './api.js';

export class ControlAPI implements SpriteExecAPI {
  constructor(_sprite: Sprite) {}

  static async probe(sprite: Sprite): Promise<boolean> {
    // Probe by attempting a HEAD/GET to a control-capable endpoint.
    // Server returns 404 when control is not supported.
    const url = `${sprite.client.baseURL}/v1/sprites/${sprite.name}/exec?cc=true&stdin=false`;
    const fetchFn: any = (globalThis as any).fetch;
    const AbortSignalAny: any = (globalThis as any).AbortSignal;
    const resp = await fetchFn(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${sprite.client.token}` },
      // Keep probe lightweight
      signal: AbortSignalAny.timeout(5000),
    });
    // 101 (during upgrade) is not observable via fetch; if server supports control
    // it should return JSON list when no command, honoring cc=true. Treat 200 as success.
    if (resp.status === 200) return true;
    if (resp.status === 404) return false;
    // For other errors, conservatively report unsupported to allow fallback
    return false;
  }

  createCommand(sprite: Sprite, command: string, args: string[] = [], options: SpawnOptions = {}): SpriteCommand {
    // Force control mode for sessions/TTY control when possible
    return spawnFn(sprite, command, args, { ...options, controlMode: true });
  }

  async exec(sprite: Sprite, command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return execFn(sprite, command, { ...options, controlMode: true });
  }

  async execFile(sprite: Sprite, file: string, args: string[] = [], options: ExecOptions = {}): Promise<ExecResult> {
    return execFileFn(sprite, file, args, { ...options, controlMode: true });
  }

  async listSessions(sprite: Sprite): Promise<Session[]> {
    // Same as EndpointAPI; cc=true affects server behavior for tmux control paths
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


