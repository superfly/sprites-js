/**
 * Sprites client implementation
 */

import { Sprite } from './sprite.js';
import { parseAPIError } from './types.js';
import type {
  ClientOptions,
  SpriteConfig,
  SpriteInfo,
  SpriteList,
  ListOptions,
  CreateSpriteRequest,
  CreateSpriteOptions,
  UpdateSpriteOptions,
  RestartSpriteResult,
  SpriteCheck,
  SpriteStateEvent,
  URLSettings,
} from './types.js';
import { NDJSONStream } from './ndjson.js';

const CREATE_SPRITE_OPTION_KEYS = {
  config: true,
  environment: true,
  urlSettings: true,
  labels: true,
  waitForCapacity: true,
  runtime: true,
} as const satisfies Record<keyof CreateSpriteOptions, true>;

/** Stream returned by the real-time Sprite listing endpoint. */
export class SpriteListStream extends NDJSONStream<SpriteStateEvent> {
  constructor(response: Response) {
    super(response, data => ({
      type: data.type,
      name: data.name,
      status: data.status,
      runningVersion: data.running_version,
      lastRunningAt: data.last_running_at ? new Date(data.last_running_at) : undefined,
      lastWarmingAt: data.last_warming_at ? new Date(data.last_warming_at) : undefined,
      timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
      organization: {
        name: data.org?.name,
        running: data.org?.running ?? 0,
        warm: data.org?.warm ?? 0,
        cold: data.org?.cold ?? 0,
        runningLimit: data.org?.running_limit,
        warmLimit: data.org?.warm_limit,
      },
    }));
  }
}

/**
 * Map API snake_case response to camelCase SpriteInfo fields
 */
function spriteFromAPI(data: any): SpriteInfo {
  return {
    id: data.id,
    name: data.name,
    organization: data.organization ?? data.org_slug,
    status: data.status,
    config: data.config ? {
      ramMB: data.config.ram_mb,
      cpus: data.config.cpus,
      region: data.config.region,
      storageGB: data.config.storage_gb,
    } : undefined,
    environment: data.environment,
    createdAt: data.created_at ? new Date(data.created_at) : undefined,
    updatedAt: data.updated_at ? new Date(data.updated_at) : undefined,
    url: data.url,
    urlSettings: data.url_settings ? {
      auth: data.url_settings.auth,
      privateAccess: data.url_settings.private_access,
    } : undefined,
    bucketName: data.bucket_name,
    primaryRegion: data.primary_region,
    version: data.version,
    environmentVersion: data.environment_version,
    labels: Array.isArray(data.labels) ? data.labels : [],
    lastRunningAt: data.last_running_at ? new Date(data.last_running_at) : undefined,
    lastWarmingAt: data.last_warming_at ? new Date(data.last_warming_at) : undefined,
  } as SpriteInfo;
}

function spriteFromInfo(info: SpriteInfo, client: SpritesClient): Sprite {
  const sprite = new Sprite(info.name, client);
  const { organization, ...fields } = info;
  Object.assign(sprite, fields);
  sprite.organizationName = organization;
  return sprite;
}

/**
 * Main client for interacting with the Sprites API
 */
export class SpritesClient {
  readonly baseURL: string;
  readonly token: string;
  private readonly timeout: number;
  readonly controlMode: boolean;

  constructor(token: string, options: ClientOptions = {}) {
    this.token = token;
    this.baseURL = (options.baseURL || 'https://api.sprites.dev').replace(/\/+$/, '');
    this.timeout = options.timeout || 30000;
    this.controlMode = options.controlMode === true;
  }

  /**
   * Get a handle to a sprite (doesn't create it on the server)
   */
  sprite(name: string): Sprite {
    return new Sprite(name, this);
  }

  /**
   * Create a new sprite
   */
  async createSprite(name: string, config?: SpriteConfig): Promise<Sprite>;
  async createSprite(name: string, options?: CreateSpriteOptions): Promise<Sprite>;
  async createSprite(
    name: string,
    config: SpriteConfig | undefined,
    options: Omit<CreateSpriteOptions, 'config'>
  ): Promise<Sprite>;
  async createSprite(
    name: string,
    configOrOptions?: SpriteConfig | CreateSpriteOptions,
    extraOptions: Omit<CreateSpriteOptions, 'config'> = {}
  ): Promise<Sprite> {
    const value = configOrOptions ?? {};
    const isOptions = (Object.keys(CREATE_SPRITE_OPTION_KEYS) as Array<keyof CreateSpriteOptions>)
      .some(key => key in value);
    const options: CreateSpriteOptions = isOptions
      ? value as CreateSpriteOptions
      : { ...(configOrOptions !== undefined && { config: value as SpriteConfig }), ...extraOptions };
    const request: CreateSpriteRequest = { name, ...options };

    const response = await this.fetch(`${this.baseURL}/v1/sprites`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toAPIRequest(request)),
      signal: AbortSignal.timeout(120000), // 2 minute timeout for creation
    });

    if (!response.ok) {
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      const apiErr = parseAPIError(response.status, body, headers);
      if (apiErr) throw apiErr;
      throw new Error(`Failed to create sprite (status ${response.status}): ${body}`);
    }

    const info = spriteFromAPI(await response.json());
    return spriteFromInfo(info, this);
  }

  /**
   * Get information about a sprite
   */
  async getSprite(name: string): Promise<Sprite> {
    const response = await this.fetch(`${this.baseURL}/v1/sprites/${encodeURIComponent(name)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      const apiErr = parseAPIError(response.status, body, headers);
      if (apiErr) throw apiErr;
      throw new Error(`Failed to get sprite (status ${response.status}): ${body}`);
    }

    const info = spriteFromAPI(await response.json());
    return spriteFromInfo(info, this);
  }

  /**
   * List sprites with optional filtering and pagination
   */
  async listSprites(options: ListOptions = {}): Promise<SpriteList> {
    const params = new URLSearchParams();
    if (options.maxResults) params.set('max_results', options.maxResults.toString());
    if (options.continuationToken) params.set('continuation_token', options.continuationToken);
    if (options.prefix) params.set('prefix', options.prefix);
    if (options.bulkLoad) params.set('bulk_load', 'true');

    const query = params.toString();
    const url = `${this.baseURL}/v1/sprites${query ? `?${query}` : ''}`;
    const response = await this.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      const apiErr = parseAPIError(response.status, body, headers);
      if (apiErr) throw apiErr;
      throw new Error(`Failed to list sprites (status ${response.status}): ${body}`);
    }

    const data = await response.json() as any;
    return {
      sprites: (data.sprites || []).map(spriteFromAPI),
      hasMore: data.has_more || false,
      nextContinuationToken: data.next_continuation_token,
      running: data.running ?? 0,
      warm: data.warm ?? 0,
      cold: data.cold ?? 0,
      organizationName: data.name,
      runningLimit: data.running_limit,
      warmLimit: data.warm_limit,
    } as SpriteList;
  }

  /** Watch Sprite state and organization count updates as NDJSON. */
  async watchSprites(options: Pick<ListOptions, 'prefix' | 'maxResults'> = {}): Promise<SpriteListStream> {
    const params = new URLSearchParams();
    if (options.prefix) params.set('prefix', options.prefix);
    if (options.maxResults) params.set('max_results', options.maxResults.toString());
    const query = params.toString();
    const response = await this.fetch(`${this.baseURL}/v1/sprites${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/x-ndjson',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      const error = parseAPIError(response.status, body, Object.fromEntries(response.headers.entries()));
      if (error) throw error;
      throw new Error(`Failed to watch sprites (status ${response.status}): ${body}`);
    }
    return new SpriteListStream(response);
  }

  /**
   * List all sprites, handling pagination automatically
   */
  async listAllSprites(prefix?: string): Promise<Sprite[]> {
    const allSprites: Sprite[] = [];
    let continuationToken: string | undefined;

    do {
      const result = await this.listSprites({
        prefix,
        maxResults: 50,
        continuationToken,
      });

      for (const info of result.sprites) {
        allSprites.push(spriteFromInfo(info, this));
      }

      continuationToken = result.hasMore ? result.nextContinuationToken : undefined;
    } while (continuationToken);

    return allSprites;
  }

  /**
   * Delete a sprite
   */
  async deleteSprite(name: string): Promise<void> {
    const response = await this.fetch(`${this.baseURL}/v1/sprites/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      const apiErr = parseAPIError(response.status, body, headers);
      if (apiErr) throw apiErr;
      throw new Error(`Failed to delete sprite (status ${response.status}): ${body}`);
    }
  }

  /**
   * Upgrade a sprite to the latest version
   */
  async upgradeSprite(name: string): Promise<void> {
    const response = await this.fetch(`${this.baseURL}/v1/sprites/${encodeURIComponent(name)}/upgrade`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      const apiErr = parseAPIError(response.status, body, headers);
      if (apiErr) throw apiErr;
      throw new Error(`Failed to upgrade sprite (status ${response.status}): ${body}`);
    }
  }

  /** Restart the machine backing a Sprite. */
  async restartSprite(name: string): Promise<RestartSpriteResult> {
    const response = await this.fetch(
      `${this.baseURL}/v1/sprites/${encodeURIComponent(name)}/restart`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` },
        signal: AbortSignal.timeout(60000),
      }
    );
    const data = await this.readJSON(response, 'restart sprite');
    return {
      spriteName: data.sprite_name,
      machineId: data.machine_id,
      message: data.message,
    };
  }

  /** Check the health of a Sprite. */
  async checkSprite(name: string): Promise<SpriteCheck> {
    const response = await this.fetch(
      `${this.baseURL}/v1/sprites/${encodeURIComponent(name)}/check`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.token}` },
        signal: AbortSignal.timeout(this.timeout),
      }
    );
    const data = await this.readJSON(response, 'check sprite');
    return {
      spriteName: data.sprite_name,
      spriteId: data.sprite_id,
      status: data.status,
      reason: data.reason ?? undefined,
      checkedAt: new Date(data.checked_at),
      elapsed: data.elapsed ?? undefined,
    };
  }

  /**
   * Update URL authentication settings for a sprite
   * @param name - Sprite name
   * @param settings - URL settings with auth: "public" for no auth, "sprite" for authenticated
   */
  async updateURLSettings(name: string, settings: URLSettings): Promise<void> {
    await this.updateSprite(name, { urlSettings: settings });
  }

  /** Partially update mutable Sprite settings and return the updated Sprite. */
  async updateSprite(name: string, options: UpdateSpriteOptions): Promise<Sprite> {
    if (options.urlSettings === undefined && options.labels === undefined) {
      throw new TypeError('urlSettings or labels is required');
    }

    const response = await this.fetch(`${this.baseURL}/v1/sprites/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toAPIRequest(options)),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      const apiErr = parseAPIError(response.status, body, headers);
      if (apiErr) throw apiErr;
      throw new Error(`Failed to update sprite (status ${response.status}): ${body}`);
    }

    const info = spriteFromAPI(await response.json());
    return spriteFromInfo({ ...info, name: info.name || name }, this);
  }

  /**
   * Create a sprite access token using a Fly.io macaroon token
   */
  static async createToken(
    flyMacaroon: string,
    orgSlug: string,
    inviteCode?: string
  ): Promise<string> {
    const apiURL = 'https://api.sprites.dev';
    const url = `${apiURL}/v1/organizations/${encodeURIComponent(orgSlug)}/tokens`;

    const body: any = {
      description: 'Sprite SDK Token',
    };

    if (inviteCode) {
      body.invite_code = inviteCode;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `FlyV1 ${flyMacaroon}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      const apiErr = parseAPIError(response.status, text, headers);
      if (apiErr) throw apiErr;
      throw new Error(`API returned status ${response.status}: ${text}`);
    }

    const result = await response.json() as { token: string };
    if (!result.token) {
      throw new Error('No token returned in response');
    }

    return result.token;
  }

  /**
   * Wrapper around fetch for consistent error handling
   */
  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Network error: ${error.message}`);
      }
      throw error;
    }
  }

  private async readJSON(response: Response, operation: string): Promise<any> {
    if (!response.ok) {
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      const apiErr = parseAPIError(response.status, body, headers);
      if (apiErr) throw apiErr;
      throw new Error(`Failed to ${operation} (status ${response.status}): ${body}`);
    }
    return response.json();
  }
}

/** Convert SDK camelCase request objects to the API's snake_case JSON. */
function toAPIRequest(value: any, preserveKeys = false): any {
  if (Array.isArray(value)) return value.map(item => toAPIRequest(item, preserveKeys));
  if (value === null || typeof value !== 'object') return value;

  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    const apiKey = preserveKeys ? key : key
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
    result[apiKey] = toAPIRequest(item, preserveKeys || key === 'environment');
  }
  return result;
}
