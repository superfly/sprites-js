/**
 * Sprites JavaScript/TypeScript SDK
 * 
 * Remote command execution for Sprites, with an API that mirrors Node.js child_process
 */

export { SpritesClient } from './client.js';
export { Sprite } from './sprite.js';
export { SpriteCommand } from './exec.js';

export type {
  ClientOptions,
  SpriteConfig,
  SpawnOptions,
  ExecOptions,
  ExecResult,
  SpriteInfo,
  SpriteList,
  ListOptions,
  Session,
  PortNotification,
  OrganizationInfo,
  ControlMessage,
  CreateSpriteRequest,
  CreateSpriteResponse,
  Checkpoint,
  URLSettings,
} from './types.js';

export { ExecError, StreamID } from './types.js';

