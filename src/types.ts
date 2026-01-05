/**
 * Type definitions for the Sprites JavaScript SDK
 */

/**
 * Client configuration options
 */
export interface ClientOptions {
  /** Base URL for the Sprites API (default: https://api.sprites.dev) */
  baseURL?: string;
  /** HTTP request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * URL authentication settings
 */
export interface URLSettings {
  /** Auth mode: "public" for no auth, "sprite" for Sprite authentication */
  auth?: string;
}

/**
 * Sprite configuration options for creation
 */
export interface SpriteConfig {
  /** RAM in megabytes */
  ramMB?: number;
  /** Number of CPUs */
  cpus?: number;
  /** Region to deploy the sprite */
  region?: string;
  /** Storage in gigabytes */
  storageGB?: number;
}

/**
 * Options for spawning a command
 */
export interface SpawnOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Environment variables as key-value pairs */
  env?: Record<string, string>;
  /** Enable TTY mode */
  tty?: boolean;
  /** TTY rows (height) */
  rows?: number;
  /** TTY columns (width) */
  cols?: number;
  /** Create a detachable tmux session */
  detachable?: boolean;
  /** Attach to existing session ID */
  sessionId?: string;
  /** Enable control mode (requires detachable or sessionId) */
  controlMode?: boolean;
}

/**
 * Options for exec methods
 */
export interface ExecOptions extends SpawnOptions {
  /** Encoding for output (default: 'utf8') */
  encoding?: BufferEncoding;
  /** Maximum buffer size for output (default: 10MB) */
  maxBuffer?: number;
}

/**
 * Result from exec methods
 */
export interface ExecResult {
  /** Standard output */
  stdout: string | Buffer;
  /** Standard error */
  stderr: string | Buffer;
  /** Exit code */
  exitCode: number;
}

/**
 * Sprite information from the API
 */
export interface SpriteInfo {
  /** Sprite ID */
  id: string;
  /** Sprite name */
  name: string;
  /** Organization name */
  organization: string;
  /** Current status */
  status: string;
  /** Configuration */
  config?: SpriteConfig;
  /** Environment variables */
  environment?: Record<string, string>;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Bucket name */
  bucketName?: string;
  /** Primary region */
  primaryRegion?: string;
  /** Public URL for the sprite */
  url?: string;
  /** URL authentication settings */
  urlSettings?: URLSettings;
}

/**
 * Options for listing sprites
 */
export interface ListOptions {
  /** Filter by name prefix */
  prefix?: string;
  /** Maximum number of results */
  maxResults?: number;
  /** Continuation token for pagination */
  continuationToken?: string;
}

/**
 * Paginated list of sprites
 */
export interface SpriteList {
  /** Array of sprite information */
  sprites: SpriteInfo[];
  /** Whether there are more results */
  hasMore: boolean;
  /** Token for fetching next page */
  nextContinuationToken?: string;
}

/**
 * Execution session information
 */
export interface Session {
  /** Session ID */
  id: string;
  /** Command being executed */
  command: string;
  /** Working directory */
  workdir: string;
  /** Session creation time */
  created: Date;
  /** Bytes per second throughput */
  bytesPerSecond: number;
  /** Whether the session is currently active */
  isActive: boolean;
  /** Last activity timestamp */
  lastActivity?: Date;
  /** Whether the session is in TTY mode */
  tty: boolean;
}

/**
 * Port notification message
 */
export interface PortNotification {
  /** Notification type */
  type: 'port_opened' | 'port_closed';
  /** Port number */
  port: number;
  /** IP address */
  address: string;
  /** Process ID */
  pid: number;
}

/**
 * Organization information
 */
export interface OrganizationInfo {
  /** Organization name */
  name: string;
  /** Organization URL */
  url: string;
}

/**
 * WebSocket control message
 */
export interface ControlMessage {
  /** Message type */
  type: 'resize';
  /** Terminal columns */
  cols?: number;
  /** Terminal rows */
  rows?: number;
}

/**
 * Stream ID for the binary protocol
 */
export enum StreamID {
  Stdin = 0,
  Stdout = 1,
  Stderr = 2,
  Exit = 3,
  StdinEOF = 4,
}

/**
 * Error thrown when a command exits with a non-zero code
 */
export class ExecError extends Error {
  constructor(
    message: string,
    public readonly result: ExecResult
  ) {
    super(message);
    this.name = 'ExecError';
  }

  get exitCode(): number {
    return this.result.exitCode;
  }

  get stdout(): string | Buffer {
    return this.result.stdout;
  }

  get stderr(): string | Buffer {
    return this.result.stderr;
  }
}

/**
 * Request body for creating a sprite
 */
export interface CreateSpriteRequest {
  /** Sprite name */
  name: string;
  /** Optional configuration */
  config?: SpriteConfig;
  /** Optional environment variables */
  environment?: Record<string, string>;
}

/**
 * Response from sprite creation
 */
export interface CreateSpriteResponse {
  /** Created sprite name */
  name: string;
}

/**
 * Checkpoint information
 */
export interface Checkpoint {
  /** Checkpoint identifier (e.g., "v3" or "Current") */
  id: string;
  /** Creation time */
  createTime: Date;
  /** Optional user-provided comment */
  comment?: string;
  /** Optional history entries */
  history?: string[];
}

/**
 * Streaming message from checkpoint/restore operations
 */
export interface StreamMessage {
  /** Message type */
  type: 'info' | 'stdout' | 'stderr' | 'error';
  /** Message data */
  data?: string;
  /** Error message */
  error?: string;
}

/**
 * Port mapping for proxy operations
 */
export interface PortMapping {
  /** Local port to listen on */
  localPort: number;
  /** Remote port to connect to */
  remotePort: number;
  /** Optional remote host (defaults to "localhost") */
  remoteHost?: string;
}

/**
 * Proxy initialization message
 */
export interface ProxyInitMessage {
  /** Remote host to connect to */
  host: string;
  /** Remote port to connect to */
  port: number;
}

/**
 * Proxy response message
 */
export interface ProxyResponseMessage {
  /** Connection status */
  status: string;
  /** Target address */
  target: string;
}

/**
 * Service definition
 */
export interface Service {
  /** Service name */
  name: string;
  /** Command to execute */
  cmd: string;
  /** Command arguments */
  args: string[];
  /** Service dependencies */
  needs: string[];
  /** Optional HTTP port for proxy routing */
  httpPort?: number;
}

/**
 * Service state information
 */
export interface ServiceState {
  /** Service name */
  name: string;
  /** Current status */
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  /** Process ID if running */
  pid?: number;
  /** Start timestamp (ISO 8601) */
  startedAt?: string;
  /** Error message if failed */
  error?: string;
  /** Number of restarts */
  restartCount?: number;
  /** Next restart timestamp (ISO 8601) */
  nextRestartAt?: string;
}

/**
 * Service with its current state
 */
export interface ServiceWithState extends Service {
  /** Current service state */
  state?: ServiceState;
}

/**
 * Request body for creating/updating a service
 */
export interface ServiceRequest {
  /** Command to execute */
  cmd: string;
  /** Command arguments */
  args?: string[];
  /** Service dependencies */
  needs?: string[];
  /** Optional HTTP port for proxy routing */
  httpPort?: number;
}

/**
 * Service log event from NDJSON stream
 */
export interface ServiceLogEvent {
  /** Event type */
  type: 'stdout' | 'stderr' | 'exit' | 'error' | 'complete' | 'started' | 'stopping' | 'stopped';
  /** Event data (log output) */
  data?: string;
  /** Exit code (for "exit" type) */
  exitCode?: number;
  /** Event timestamp (milliseconds since epoch) */
  timestamp: number;
  /** Log file paths (for "complete" type) */
  logFiles?: Record<string, string>;
}

/**
 * Network policy rule
 */
export interface PolicyRule {
  /** Domain to match (mutually exclusive with include) */
  domain?: string;
  /** Action to take */
  action?: 'allow' | 'deny';
  /** Include preset rules (e.g., "defaults") - mutually exclusive with domain */
  include?: string;
}

/**
 * Network policy document
 */
export interface NetworkPolicy {
  /** Array of policy rules */
  rules: PolicyRule[];
}

