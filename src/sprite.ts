/**
 * Sprite class representing a sprite instance
 */

import { SpritesClient } from './client.js';
import { SpriteCommand, spawn, exec, execFile } from './exec.js';
import { CheckpointStream, RestoreStream } from './checkpoint.js';
import { ProxySession, proxyPort, proxyPorts } from './proxy.js';
import {
  ServiceLogStream,
  listServices,
  getService,
  createService,
  deleteService,
  startService,
  stopService,
  signalService,
} from './services.js';
import { getNetworkPolicy, updateNetworkPolicy } from './policy.js';
import { SpriteFilesystem } from './filesystem.js';
import { ControlConnection, getControlConnection, closeControlConnection, hasControlConnection } from './control.js';
import type {
  SpawnOptions,
  ExecOptions,
  ExecResult,
  Session,
  SpriteConfig,
  Checkpoint,
  URLSettings,
  PortMapping,
  ServiceWithState,
  ServiceRequest,
  NetworkPolicy,
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
  url?: string;
  urlSettings?: URLSettings;

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
          workdir: s.workdir || '',
          created: new Date(s.created),
          bytesPerSecond: s.bytes_per_second || 0,
          isActive: s.is_active || false,
          tty: s.tty || false,
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

  /**
   * Create a checkpoint with an optional comment.
   * Returns a CheckpointStream for reading progress messages.
   */
  async createCheckpoint(comment?: string): Promise<CheckpointStream> {
    const body: any = {};
    if (comment) body.comment = comment;
    const response = await fetch(`${this.client.baseURL}/v1/sprites/${this.name}/checkpoint`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // No timeout: checkpoint streams can be long-running
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create checkpoint (status ${response.status}): ${text}`);
    }
    return new CheckpointStream(response);
  }

  /**
   * List checkpoints
   * @param historyFilter - Optional filter for checkpoint history
   */
  async listCheckpoints(historyFilter?: string): Promise<Checkpoint[]> {
    let url = `${this.client.baseURL}/v1/sprites/${this.name}/checkpoints`;
    if (historyFilter) {
      url += `?history=${encodeURIComponent(historyFilter)}`;
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to list checkpoints (status ${response.status}): ${text}`);
    }
    const raw = await response.json() as any[];
    return raw.map((cp) => ({
      id: cp.id,
      createTime: new Date(cp.create_time),
      comment: cp.comment,
      history: cp.history,
    }));
  }

  /**
   * Get checkpoint details
   */
  async getCheckpoint(id: string): Promise<Checkpoint> {
    const response = await fetch(`${this.client.baseURL}/v1/sprites/${this.name}/checkpoints/${id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404) {
      throw new Error(`Checkpoint not found: ${id}`);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get checkpoint (status ${response.status}): ${text}`);
    }
    const cp = await response.json() as any;
    return {
      id: cp.id,
      createTime: new Date(cp.create_time),
      comment: cp.comment,
      history: cp.history,
    };
  }

  /**
   * Restore from a checkpoint.
   * Returns a RestoreStream for reading progress messages.
   */
  async restoreCheckpoint(id: string): Promise<RestoreStream> {
    const response = await fetch(`${this.client.baseURL}/v1/sprites/${this.name}/checkpoints/${id}/restore`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.client.token}`,
      },
      // No timeout: restore streams can be long-running
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to restore checkpoint (status ${response.status}): ${text}`);
    }
    return new RestoreStream(response);
  }

  /**
   * Update URL authentication settings
   * @param settings - URL settings with auth: "public" for no auth, "sprite" for authenticated
   */
  async updateURLSettings(settings: URLSettings): Promise<void> {
    await this.client.updateURLSettings(this.name, settings);
  }

  /**
   * Create a proxy session for a single port
   * @param localPort - Local port to listen on
   * @param remotePort - Remote port to connect to on the sprite
   * @param remoteHost - Optional remote host (defaults to "localhost")
   */
  async proxyPort(
    localPort: number,
    remotePort: number,
    remoteHost?: string
  ): Promise<ProxySession> {
    return proxyPort(this.client, this.name, localPort, remotePort, remoteHost);
  }

  /**
   * Create proxy sessions for multiple port mappings
   * @param mappings - Array of port mappings
   */
  async proxyPorts(mappings: PortMapping[]): Promise<ProxySession[]> {
    return proxyPorts(this.client, this.name, mappings);
  }

  // ========== Services API ==========

  /**
   * List all services on this sprite
   */
  async listServices(): Promise<ServiceWithState[]> {
    return listServices(this.client, this.name);
  }

  /**
   * Get a specific service
   */
  async getService(serviceName: string): Promise<ServiceWithState> {
    return getService(this.client, this.name, serviceName);
  }

  /**
   * Create a service (starts automatically with log streaming)
   * @param serviceName - Name for the service
   * @param config - Service configuration
   * @param duration - Optional monitoring duration (e.g., "5s", "30s")
   * @returns Stream of log events during startup
   */
  async createService(
    serviceName: string,
    config: ServiceRequest,
    duration?: string
  ): Promise<ServiceLogStream> {
    return createService(this.client, this.name, serviceName, config, duration);
  }

  /**
   * Delete a service
   */
  async deleteService(serviceName: string): Promise<void> {
    return deleteService(this.client, this.name, serviceName);
  }

  /**
   * Start a service
   * @param serviceName - Service to start
   * @param duration - Optional monitoring duration (e.g., "5s", "30s")
   * @returns Stream of log events
   */
  async startService(
    serviceName: string,
    duration?: string
  ): Promise<ServiceLogStream> {
    return startService(this.client, this.name, serviceName, duration);
  }

  /**
   * Stop a service
   * @param serviceName - Service to stop
   * @param timeout - Optional stop timeout (e.g., "10s")
   * @returns Stream of log events
   */
  async stopService(
    serviceName: string,
    timeout?: string
  ): Promise<ServiceLogStream> {
    return stopService(this.client, this.name, serviceName, timeout);
  }

  /**
   * Send a signal to a service
   * @param serviceName - Service to signal
   * @param signal - Signal to send (e.g., "TERM", "KILL", "HUP")
   */
  async signalService(serviceName: string, signal: string): Promise<void> {
    return signalService(this.client, this.name, serviceName, signal);
  }

  // ========== Policy API ==========

  /**
   * Get the current network policy
   */
  async getNetworkPolicy(): Promise<NetworkPolicy> {
    return getNetworkPolicy(this.client, this.name);
  }

  /**
   * Update the network policy
   */
  async updateNetworkPolicy(policy: NetworkPolicy): Promise<void> {
    return updateNetworkPolicy(this.client, this.name, policy);
  }

  // ========== Filesystem API ==========

  /**
   * Get a filesystem interface for this sprite
   * @param workingDir - Optional working directory (default: "/")
   * @returns SpriteFilesystem instance for file operations
   *
   * @example
   * ```typescript
   * const fs = sprite.filesystem("/app");
   * await fs.readFile("config.json", "utf8");
   * await fs.writeFile("output.txt", "data");
   * await fs.readdir("/app", { withFileTypes: true });
   * await fs.mkdir("deep/path", { recursive: true });
   * await fs.rm("file.txt");
   * await fs.stat("file.txt");
   * await fs.rename("old.txt", "new.txt");
   * await fs.copyFile("src.txt", "dst.txt");
   * await fs.chmod("script.sh", 0o755);
   * ```
   */
  filesystem(workingDir: string = '/'): SpriteFilesystem {
    return new SpriteFilesystem(this.client, this.name, workingDir);
  }

  // ========== Control Connection API ==========

  /**
   * Check if control mode is enabled for this sprite
   */
  useControlMode(): boolean {
    return this.client.controlMode;
  }

  /**
   * Get or create a control connection for multiplexed operations
   */
  async getControlConnection(): Promise<ControlConnection> {
    return getControlConnection(this);
  }

  /**
   * Close the control connection if open
   */
  closeControlConnection(): void {
    closeControlConnection(this);
  }

  /**
   * Check if this sprite has an active control connection.
   */
  hasControlConnection(): boolean {
    return hasControlConnection(this);
  }
}

