/**
 * Sprites client implementation
 */

import { Sprite } from './sprite.js';
import type {
  ClientOptions,
  SpriteConfig,
  SpriteInfo,
  SpriteList,
  ListOptions,
  CreateSpriteRequest,
  CreateSpriteResponse,
} from './types.js';

/**
 * Main client for interacting with the Sprites API
 */
export class SpritesClient {
  readonly baseURL: string;
  readonly token: string;
  private readonly timeout: number;

  constructor(token: string, options: ClientOptions = {}) {
    this.token = token;
    this.baseURL = (options.baseURL || 'https://api.sprites.dev').replace(/\/+$/, '');
    this.timeout = options.timeout || 30000;
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
  async createSprite(name: string, config?: SpriteConfig): Promise<Sprite> {
    const request: CreateSpriteRequest = { name, config };

    const response = await this.fetch(`${this.baseURL}/v1/sprites`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120000), // 2 minute timeout for creation
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to create sprite (status ${response.status}): ${body}`);
    }

    const result = await response.json() as CreateSpriteResponse;
    return new Sprite(result.name, this);
  }

  /**
   * Get information about a sprite
   */
  async getSprite(name: string): Promise<Sprite> {
    const response = await this.fetch(`${this.baseURL}/v1/sprites/${name}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (response.status === 404) {
      throw new Error(`Sprite not found: ${name}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to get sprite (status ${response.status}): ${body}`);
    }

    const info = await response.json() as SpriteInfo;
    const sprite = new Sprite(info.name, this);
    Object.assign(sprite, info);
    return sprite;
  }

  /**
   * List sprites with optional filtering and pagination
   */
  async listSprites(options: ListOptions = {}): Promise<SpriteList> {
    const params = new URLSearchParams();
    if (options.maxResults) params.set('max_results', options.maxResults.toString());
    if (options.continuationToken) params.set('continuation_token', options.continuationToken);
    if (options.prefix) params.set('prefix', options.prefix);

    const url = `${this.baseURL}/v1/sprites?${params}`;
    const response = await this.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list sprites (status ${response.status}): ${body}`);
    }

    return await response.json() as SpriteList;
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
        maxResults: 100,
        continuationToken,
      });

      for (const info of result.sprites) {
        const sprite = new Sprite(info.name, this);
        Object.assign(sprite, info);
        allSprites.push(sprite);
      }

      continuationToken = result.hasMore ? result.nextContinuationToken : undefined;
    } while (continuationToken);

    return allSprites;
  }

  /**
   * Delete a sprite
   */
  async deleteSprite(name: string): Promise<void> {
    const response = await this.fetch(`${this.baseURL}/v1/sprites/${name}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      throw new Error(`Failed to delete sprite (status ${response.status}): ${body}`);
    }
  }

  /**
   * Upgrade a sprite to the latest version
   */
  async upgradeSprite(name: string): Promise<void> {
    const response = await this.fetch(`${this.baseURL}/v1/sprites/${name}/upgrade`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      throw new Error(`Failed to upgrade sprite (status ${response.status}): ${body}`);
    }
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
    const url = `${apiURL}/v1/organizations/${orgSlug}/tokens`;

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
}

