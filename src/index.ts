/**
 * Sprites JavaScript/TypeScript SDK
 *
 * Remote command execution for Sprites, with an API that mirrors Node.js child_process
 */

export { SpritesClient, SpriteListStream } from './client.js';
export { Sprite } from './sprite.js';
export { SpriteCommand } from './exec.js';
export { SessionKillStream } from './exec.js';
export { CheckpointStream, RestoreStream } from './checkpoint.js';
export { ProxySession, ProxyManager, proxyPort, proxyPorts } from './proxy.js';
export { ServiceLogStream } from './services.js';
export { SpriteFilesystem } from './filesystem.js';
export { ControlConnection, OpConn } from './control.js';
export { PortWatcher, FilesystemWatcher } from './watch.js';
export type { StartOpOptions } from './control.js';

export type {
  ClientOptions,
  SpriteConfig,
  SpawnOptions,
  ExecOptions,
  ExecResult,
  HTTPExecOptions,
  SpriteInfo,
  SpriteList,
  SpriteStateEvent,
  ListOptions,
  Session,
  PortNotification,
  PortList,
  PortWatchEvent,
  OrganizationInfo,
  ControlMessage,
  CreateSpriteRequest,
  CreateSpriteOptions,
  UpdateSpriteOptions,
  RestartSpriteResult,
  SpriteCheck,
  SessionKillEvent,
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
  PrivilegesPolicy,
  ResourcesPolicy,
  Stats,
  Dirent,
  FilesystemErrorCode,
  ReaddirOptions,
  MkdirOptions,
  RmOptions,
  CopyFileOptions,
  ChmodOptions,
  RenameOptions,
  ChownOptions,
  FilesystemWatchOptions,
  FilesystemWatchEvent,
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
