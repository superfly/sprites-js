/**
 * Internal API interface for exec-related operations.
 */

import type { Sprite } from './sprite.js';
import type { ExecResult, ExecOptions, SpawnOptions, Session } from './types.js';
import { SpriteCommand } from './exec.js';

export interface SpriteExecAPI {
  createCommand(sprite: Sprite, command: string, args?: string[], options?: SpawnOptions): SpriteCommand;
  exec(sprite: Sprite, command: string, options?: ExecOptions): Promise<ExecResult>;
  execFile(sprite: Sprite, file: string, args?: string[], options?: ExecOptions): Promise<ExecResult>;
  listSessions(sprite: Sprite): Promise<Session[]>;
}


