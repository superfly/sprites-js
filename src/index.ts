/**
 * Sprites JavaScript/TypeScript SDK
 *
 * Remote command execution for Sprites, with an API that mirrors Node.js child_process
 */

export { SpritesClient } from './client.js';
export { Sprite } from './sprite.js';
export { SpriteCommand } from './exec.js';
export { CheckpointStream, RestoreStream } from './checkpoint.js';
export { ProxySession, ProxyManager, proxyPort, proxyPorts } from './proxy.js';
export { ServiceLogStream } from './services.js';
export { SpriteFilesystem } from './filesystem.js';
export { ControlConnection, OpConn } from './control.js';
export type { StartOpOptions } from './control.js';

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
  StreamMessage,
  PortMapping,
  ProxyInitMessage,
  ProxyResponseMessage,
  Service,
  ServiceState,
  ServiceWithState,
  ServiceRequest,
  ServiceLogEvent,
  PolicyRule,
  NetworkPolicy,
  Stats,
  Dirent,
  FilesystemErrorCode,
  ReaddirOptions,
  MkdirOptions,
  RmOptions,
  CopyFileOptions,
  ChmodOptions,
} from './types.js';

export {
  ExecError,
  StreamID,
  FilesystemError,
  APIError,
  parseAPIError,
  ERR_CODE_CREATION_RATE_LIMITED,
  ERR_CODE_CONCURRENT_LIMIT_EXCEEDED,
} from './types.js';

