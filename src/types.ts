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
  /** Enable control mode for multiplexed WebSocket operations */
  controlMode?: boolean;
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
 * Error codes returned by the API for rate limiting
 */
export const ERR_CODE_CREATION_RATE_LIMITED = 'sprite_creation_rate_limited';
export const ERR_CODE_CONCURRENT_LIMIT_EXCEEDED = 'concurrent_sprite_limit_exceeded';

/**
 * Structured error response from the Sprites API
 */
export class APIError extends Error {
  /** Machine-readable error code (e.g., "sprite_creation_rate_limited") */
  readonly errorCode?: string;
  /** HTTP status code */
  readonly statusCode?: number;
  /** Rate limit value (e.g., 10 sprites per minute) */
  readonly limit?: number;
  /** Rate limit window in seconds */
  readonly windowSeconds?: number;
  /** Number of seconds to wait before retrying (from JSON body) */
  readonly retryAfterSeconds?: number;
  /** Current count (for concurrent limit errors) */
  readonly currentCount?: number;
  /** Whether an upgrade is available */
  readonly upgradeAvailable?: boolean;
  /** URL to upgrade the account (for rate limit errors) */
  readonly upgradeUrl?: string;
  /** Retry-After header value in seconds */
  readonly retryAfterHeader?: number;
  /** X-RateLimit-Limit header value */
  readonly rateLimitLimit?: number;
  /** X-RateLimit-Remaining header value */
  readonly rateLimitRemaining?: number;
  /** X-RateLimit-Reset header value (Unix timestamp) */
  readonly rateLimitReset?: number;

  constructor(
    message: string,
    options: {
      errorCode?: string;
      statusCode?: number;
      limit?: number;
      windowSeconds?: number;
      retryAfterSeconds?: number;
      currentCount?: number;
      upgradeAvailable?: boolean;
      upgradeUrl?: string;
      retryAfterHeader?: number;
      rateLimitLimit?: number;
      rateLimitRemaining?: number;
      rateLimitReset?: number;
    } = {}
  ) {
    super(message);
    this.name = 'APIError';
    this.errorCode = options.errorCode;
    this.statusCode = options.statusCode;
    this.limit = options.limit;
    this.windowSeconds = options.windowSeconds;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.currentCount = options.currentCount;
    this.upgradeAvailable = options.upgradeAvailable;
    this.upgradeUrl = options.upgradeUrl;
    this.retryAfterHeader = options.retryAfterHeader;
    this.rateLimitLimit = options.rateLimitLimit;
    this.rateLimitRemaining = options.rateLimitRemaining;
    this.rateLimitReset = options.rateLimitReset;
  }

  /** Returns true if this is a 429 rate limit error */
  isRateLimitError(): boolean {
    return this.statusCode === 429;
  }

  /** Returns true if this is a sprite creation rate limit error */
  isCreationRateLimited(): boolean {
    return this.errorCode === ERR_CODE_CREATION_RATE_LIMITED;
  }

  /** Returns true if this is a concurrent sprite limit error */
  isConcurrentLimitExceeded(): boolean {
    return this.errorCode === ERR_CODE_CONCURRENT_LIMIT_EXCEEDED;
  }

  /** Returns the number of seconds to wait before retrying.
   * Prefers the JSON field, falling back to the header value.
   */
  getRetryAfterSeconds(): number | undefined {
    if (this.retryAfterSeconds !== undefined && this.retryAfterSeconds > 0) {
      return this.retryAfterSeconds;
    }
    return this.retryAfterHeader;
  }
}

/**
 * Parse a structured API error from an HTTP response.
 * Returns undefined if statusCode < 400.
 */
export function parseAPIError(
  statusCode: number,
  body: string | undefined,
  headers?: Record<string, string>
): APIError | undefined {
  if (statusCode < 400) {
    return undefined;
  }

  headers = headers || {};

  // Parse rate limit headers (check both lower and original case)
  const getHeader = (name: string): string | undefined => {
    return headers![name.toLowerCase()] || headers![name];
  };

  let retryAfterHeader: number | undefined;
  let rateLimitLimit: number | undefined;
  let rateLimitRemaining: number | undefined;
  let rateLimitReset: number | undefined;

  const ra = getHeader('Retry-After');
  if (ra) {
    const v = parseInt(ra, 10);
    if (!isNaN(v)) retryAfterHeader = v;
  }

  const rl = getHeader('X-RateLimit-Limit');
  if (rl) {
    const v = parseInt(rl, 10);
    if (!isNaN(v)) rateLimitLimit = v;
  }

  const rr = getHeader('X-RateLimit-Remaining');
  if (rr) {
    const v = parseInt(rr, 10);
    if (!isNaN(v)) rateLimitRemaining = v;
  }

  const rs = getHeader('X-RateLimit-Reset');
  if (rs) {
    const v = parseInt(rs, 10);
    if (!isNaN(v)) rateLimitReset = v;
  }

  // Try to parse JSON body
  let message = '';
  let errorCode: string | undefined;
  let limit: number | undefined;
  let windowSeconds: number | undefined;
  let retryAfterSeconds: number | undefined;
  let currentCount: number | undefined;
  let upgradeAvailable: boolean | undefined;
  let upgradeUrl: string | undefined;

  if (body) {
    try {
      const data = JSON.parse(body);
      errorCode = data.error;
      message = data.message || '';
      limit = data.limit;
      windowSeconds = data.window_seconds;
      retryAfterSeconds = data.retry_after_seconds;
      currentCount = data.current_count;
      upgradeAvailable = data.upgrade_available;
      upgradeUrl = data.upgrade_url;
    } catch {
      // Use raw body as message
      message = body;
    }
  }

  // Fallback message if nothing was parsed
  if (!message && !errorCode) {
    message = `API error (status ${statusCode})`;
  }

  return new APIError(message || errorCode || `API error (status ${statusCode})`, {
    errorCode,
    statusCode,
    limit,
    windowSeconds,
    retryAfterSeconds,
    currentCount,
    upgradeAvailable,
    upgradeUrl,
    retryAfterHeader,
    rateLimitLimit,
    rateLimitRemaining,
    rateLimitReset,
  });
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

// ========== Filesystem Types ==========

/**
 * File statistics (matches Node.js fs.Stats interface subset)
 */
export interface Stats {
  /** File size in bytes */
  size: number;
  /** File mode (permissions) */
  mode: number;
  /** Last modified time */
  mtime: Date;
  /** Last access time */
  atime: Date;
  /** Creation time */
  birthtime: Date;
  /** True if this is a directory */
  isDirectory(): boolean;
  /** True if this is a regular file */
  isFile(): boolean;
  /** True if this is a symbolic link */
  isSymbolicLink(): boolean;
}

/**
 * Directory entry (matches Node.js fs.Dirent interface)
 */
export interface Dirent {
  /** Entry name (file or directory name) */
  name: string;
  /** Parent directory path */
  parentPath: string;
  /** True if this is a directory */
  isDirectory(): boolean;
  /** True if this is a regular file */
  isFile(): boolean;
  /** True if this is a symbolic link */
  isSymbolicLink(): boolean;
}

/**
 * Error codes for filesystem operations
 */
export type FilesystemErrorCode =
  | 'ENOENT'    // File not found
  | 'EEXIST'    // File already exists
  | 'ENOTDIR'   // Not a directory
  | 'EISDIR'    // Is a directory
  | 'EACCES'    // Permission denied
  | 'ENOTEMPTY' // Directory not empty
  | 'EINVAL'    // Invalid argument
  | 'EIO'       // I/O error
  | 'UNKNOWN';  // Unknown error

/**
 * Filesystem error with code and path information
 */
export class FilesystemError extends Error {
  constructor(
    message: string,
    public readonly code: FilesystemErrorCode,
    public readonly path: string,
    public readonly syscall?: string
  ) {
    super(message);
    this.name = 'FilesystemError';
  }
}

/**
 * Options for readdir
 */
export interface ReaddirOptions {
  /** If true, returns Dirent objects instead of strings */
  withFileTypes?: boolean;
  /** Encoding for file names (default: 'utf8') */
  encoding?: BufferEncoding;
}

/**
 * Options for mkdir
 */
export interface MkdirOptions {
  /** File mode (permissions), default 0o777 */
  mode?: number;
  /** Create parent directories as needed */
  recursive?: boolean;
}

/**
 * Options for rm/rmdir
 */
export interface RmOptions {
  /** If true, no error if path doesn't exist */
  force?: boolean;
  /** Recursively remove directory contents */
  recursive?: boolean;
}

/**
 * Options for copyFile
 */
export interface CopyFileOptions {
  /** Recursively copy directory contents */
  recursive?: boolean;
}

/**
 * Options for chmod
 */
export interface ChmodOptions {
  /** Recursively change mode */
  recursive?: boolean;
}

/**
 * Internal: File entry from server list response
 */
export interface FsEntry {
  name: string;
  path: string;
  type: string;
  size: number;
  mode: string;
  modTime: string;
  isDir: boolean;
}

/**
 * Internal: List response from server
 */
export interface FsListResponse {
  path: string;
  entries: FsEntry[];
  count: number;
}

/**
 * Internal: Write response from server
 */
export interface FsWriteResponse {
  path: string;
  size: number;
  mode: string;
}

/**
 * Internal: Delete response from server
 */
export interface FsDeleteResponse {
  deleted: string[];
  count: number;
}

/**
 * Internal: Rename response from server
 */
export interface FsRenameResponse {
  source: string;
  dest: string;
}

/**
 * Internal: Copy response from server
 */
export interface FsCopyResponse {
  source: string;
  dest: string;
  count: number;
}

/**
 * Internal: Chmod response from server
 */
export interface FsChmodResponse {
  path: string;
  mode: string;
  count: number;
}

/**
 * Internal: Error response from server
 */
export interface FsErrorResponse {
  error: string;
  code?: string;
  path?: string;
}

