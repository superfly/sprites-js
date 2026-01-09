/**
 * Filesystem operations for Sprites
 * API mirrors Node.js fs/promises for familiarity
 */

import { SpritesClient } from './client.js';
import type {
  Stats,
  Dirent,
  FilesystemError,
  FilesystemErrorCode,
  ReaddirOptions,
  MkdirOptions,
  RmOptions,
  CopyFileOptions,
  ChmodOptions,
  FsEntry,
  FsListResponse,
  FsErrorResponse,
} from './types.js';

/**
 * Implementation of Stats interface
 */
class StatsImpl implements Stats {
  size: number;
  mode: number;
  mtime: Date;
  atime: Date;
  birthtime: Date;
  private _isDir: boolean;
  private _isSymlink: boolean;

  constructor(entry: FsEntry) {
    this.size = entry.size;
    this.mode = parseInt(entry.mode, 8) || 0o644;
    this.mtime = new Date(entry.modTime);
    this.atime = new Date(entry.modTime);
    this.birthtime = new Date(entry.modTime);
    this._isDir = entry.isDir;
    this._isSymlink = entry.type === 'symlink';
  }

  isDirectory(): boolean {
    return this._isDir;
  }

  isFile(): boolean {
    return !this._isDir && !this._isSymlink;
  }

  isSymbolicLink(): boolean {
    return this._isSymlink;
  }
}

/**
 * Implementation of Dirent interface
 */
class DirentImpl implements Dirent {
  name: string;
  parentPath: string;
  private _isDir: boolean;
  private _isSymlink: boolean;

  constructor(entry: FsEntry, parentPath: string) {
    this.name = entry.name;
    this.parentPath = parentPath;
    this._isDir = entry.isDir;
    this._isSymlink = entry.type === 'symlink';
  }

  isDirectory(): boolean {
    return this._isDir;
  }

  isFile(): boolean {
    return !this._isDir && !this._isSymlink;
  }

  isSymbolicLink(): boolean {
    return this._isSymlink;
  }
}

/**
 * Create a FilesystemError from server response
 */
function createError(
  message: string,
  code: FilesystemErrorCode,
  path: string,
  syscall?: string
): FilesystemError {
  // Import dynamically to avoid circular dependency
  const error = new Error(message) as FilesystemError;
  error.name = 'FilesystemError';
  (error as any).code = code;
  (error as any).path = path;
  (error as any).syscall = syscall;
  return error;
}

/**
 * Parse error code from server response
 */
function parseErrorCode(serverCode?: string): FilesystemErrorCode {
  if (!serverCode) return 'UNKNOWN';

  const codeMap: Record<string, FilesystemErrorCode> = {
    'ENOENT': 'ENOENT',
    'EEXIST': 'EEXIST',
    'ENOTDIR': 'ENOTDIR',
    'EISDIR': 'EISDIR',
    'EACCES': 'EACCES',
    'ENOTEMPTY': 'ENOTEMPTY',
    'EINVAL': 'EINVAL',
    'EIO': 'EIO',
  };

  return codeMap[serverCode] || 'UNKNOWN';
}

/**
 * Join path segments, handling absolute paths
 */
function joinPath(base: string, ...parts: string[]): string {
  let result = base;
  for (const part of parts) {
    if (part.startsWith('/')) {
      result = part;
    } else if (result.endsWith('/')) {
      result = result + part;
    } else {
      result = result + '/' + part;
    }
  }
  return result;
}

/**
 * SpriteFilesystem provides filesystem operations on a sprite
 * API mirrors Node.js fs/promises for familiarity
 */
export class SpriteFilesystem {
  private readonly client: SpritesClient;
  private readonly spriteName: string;
  private readonly workingDir: string;

  constructor(client: SpritesClient, spriteName: string, workingDir: string = '/') {
    this.client = client;
    this.spriteName = spriteName;
    this.workingDir = workingDir;
  }

  /**
   * Build the full URL for a filesystem endpoint
   */
  private buildURL(endpoint: string): string {
    return `${this.client.baseURL}/v1/sprites/${this.spriteName}/fs${endpoint}`;
  }

  /**
   * Get authorization headers
   */
  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.client.token}`,
    };
  }

  /**
   * Handle error response from server
   */
  private async handleError(response: Response, path: string, syscall: string): Promise<never> {
    let errorData: FsErrorResponse;
    try {
      errorData = await response.json() as FsErrorResponse;
    } catch {
      throw createError(
        `${syscall} failed with status ${response.status}`,
        'UNKNOWN',
        path,
        syscall
      );
    }

    const code = parseErrorCode(errorData.code);
    throw createError(
      errorData.error || `${syscall} failed`,
      code,
      errorData.path || path,
      syscall
    );
  }

  /**
   * Read the contents of a file
   * @param path - File path (relative to workingDir or absolute)
   * @param encoding - If 'utf8', returns string; otherwise returns Buffer
   */
  async readFile(path: string, encoding?: 'utf8'): Promise<string>;
  async readFile(path: string, encoding?: null): Promise<Buffer>;
  async readFile(path: string, encoding?: 'utf8' | null): Promise<string | Buffer> {
    const url = new URL(this.buildURL('/read'));
    url.searchParams.set('path', path);
    url.searchParams.set('workingDir', this.workingDir);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      await this.handleError(response, path, 'read');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (encoding === 'utf8') {
      return buffer.toString('utf8');
    }
    return buffer;
  }

  /**
   * Write data to a file, creating it if it doesn't exist
   * @param path - File path (relative to workingDir or absolute)
   * @param data - Data to write (string or Buffer)
   * @param options - Write options (mode, etc.)
   */
  async writeFile(
    path: string,
    data: string | Buffer,
    options?: { mode?: number }
  ): Promise<void> {
    const url = new URL(this.buildURL('/write'));
    url.searchParams.set('path', path);
    url.searchParams.set('workingDir', this.workingDir);
    url.searchParams.set('mkdirParents', 'true');

    if (options?.mode !== undefined) {
      url.searchParams.set('mode', options.mode.toString(8).padStart(4, '0'));
    }

    const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/octet-stream',
      },
      body,
    });

    if (!response.ok) {
      await this.handleError(response, path, 'write');
    }
  }

  /**
   * Read the contents of a directory
   * @param path - Directory path (relative to workingDir or absolute)
   * @param options - If withFileTypes is true, returns Dirent objects
   */
  async readdir(path: string, options?: { withFileTypes?: false }): Promise<string[]>;
  async readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
    const url = new URL(this.buildURL('/list'));
    url.searchParams.set('path', path);
    url.searchParams.set('workingDir', this.workingDir);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      await this.handleError(response, path, 'readdir');
    }

    const data = await response.json() as FsListResponse;

    if (options?.withFileTypes) {
      return data.entries.map(entry => new DirentImpl(entry, path));
    }

    return data.entries.map(entry => entry.name);
  }

  /**
   * Create a directory
   * @param path - Directory path (relative to workingDir or absolute)
   * @param options - If recursive is true, creates parent directories
   */
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    // Use writeFile to create a .keep file in the directory
    // Server creates parent directories when mkdirParents is true
    const keepPath = joinPath(path, '.keep');
    const url = new URL(this.buildURL('/write'));
    url.searchParams.set('path', keepPath);
    url.searchParams.set('workingDir', this.workingDir);

    if (options?.recursive) {
      url.searchParams.set('mkdirParents', 'true');
    }

    if (options?.mode !== undefined) {
      url.searchParams.set('mode', options.mode.toString(8).padStart(4, '0'));
    }

    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.alloc(0),
    });

    if (!response.ok) {
      await this.handleError(response, path, 'mkdir');
    }

    // Remove the .keep file to leave an empty directory
    try {
      await this.rm(keepPath);
    } catch {
      // Ignore errors removing .keep
    }
  }

  /**
   * Remove a file or directory
   * @param path - Path to remove (relative to workingDir or absolute)
   * @param options - If recursive is true, removes directory contents
   */
  async rm(path: string, options?: RmOptions): Promise<void> {
    const url = new URL(this.buildURL('/delete'));
    url.searchParams.set('path', path);
    url.searchParams.set('workingDir', this.workingDir);

    if (options?.recursive) {
      url.searchParams.set('recursive', 'true');
    }

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      if (options?.force && response.status === 404) {
        return; // Ignore not found errors when force is true
      }
      await this.handleError(response, path, 'rm');
    }
  }

  /**
   * Get file or directory statistics
   * @param path - Path to stat (relative to workingDir or absolute)
   */
  async stat(path: string): Promise<Stats> {
    const url = new URL(this.buildURL('/list'));
    url.searchParams.set('path', path);
    url.searchParams.set('workingDir', this.workingDir);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      await this.handleError(response, path, 'stat');
    }

    const data = await response.json() as FsListResponse;

    if (data.entries.length === 0) {
      throw createError(`ENOENT: no such file or directory, stat '${path}'`, 'ENOENT', path, 'stat');
    }

    return new StatsImpl(data.entries[0]);
  }

  /**
   * Rename a file or directory
   * @param oldPath - Current path (relative to workingDir or absolute)
   * @param newPath - New path (relative to workingDir or absolute)
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const url = this.buildURL('/rename');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: oldPath,
        dest: newPath,
        workingDir: this.workingDir,
      }),
    });

    if (!response.ok) {
      await this.handleError(response, oldPath, 'rename');
    }
  }

  /**
   * Copy a file
   * @param src - Source path (relative to workingDir or absolute)
   * @param dest - Destination path (relative to workingDir or absolute)
   * @param options - Copy options (recursive for directories)
   */
  async copyFile(src: string, dest: string, options?: CopyFileOptions): Promise<void> {
    const url = this.buildURL('/copy');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: src,
        dest: dest,
        workingDir: this.workingDir,
        recursive: options?.recursive,
      }),
    });

    if (!response.ok) {
      await this.handleError(response, src, 'copyFile');
    }
  }

  /**
   * Change file mode (permissions)
   * @param path - Path to chmod (relative to workingDir or absolute)
   * @param mode - New file mode (e.g., 0o755)
   * @param options - Chmod options (recursive for directories)
   */
  async chmod(path: string, mode: number, options?: ChmodOptions): Promise<void> {
    const url = this.buildURL('/chmod');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: path,
        workingDir: this.workingDir,
        mode: mode.toString(8).padStart(4, '0'),
        recursive: options?.recursive,
      }),
    });

    if (!response.ok) {
      await this.handleError(response, path, 'chmod');
    }
  }

  /**
   * Check if a file or directory exists
   * @param path - Path to check (relative to workingDir or absolute)
   */
  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Append data to a file
   * @param path - File path (relative to workingDir or absolute)
   * @param data - Data to append (string or Buffer)
   */
  async appendFile(path: string, data: string | Buffer): Promise<void> {
    // Read existing content, append new data, write back
    let existing: Buffer;
    try {
      existing = await this.readFile(path, null);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        existing = Buffer.alloc(0);
      } else {
        throw error;
      }
    }

    const newData = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const combined = Buffer.concat([existing, newData]);
    await this.writeFile(path, combined);
  }

  /**
   * Read a file as JSON
   * @param path - File path (relative to workingDir or absolute)
   */
  async readJSON<T = unknown>(path: string): Promise<T> {
    const content = await this.readFile(path, 'utf8');
    return JSON.parse(content) as T;
  }

  /**
   * Write data as JSON to a file
   * @param path - File path (relative to workingDir or absolute)
   * @param data - Data to serialize to JSON
   * @param options - JSON serialization options
   */
  async writeJSON(
    path: string,
    data: unknown,
    options?: { spaces?: number }
  ): Promise<void> {
    const content = JSON.stringify(data, null, options?.spaces);
    await this.writeFile(path, content);
  }
}
