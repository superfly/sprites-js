import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { SpritesClient } from './client.js';
import { APIError } from './types.js';
import type { HTTPExecOptions, SpriteInfo, SpriteList, URLSettings } from './types.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function captureFetch(...responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input.toString(), init });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected fetch');
    return response;
  }) as typeof fetch;
  return calls;
}

const spriteJSON = {
  id: 'sprite-1',
  name: 'hello world',
  organization: 'test-org',
  status: 'running',
  config: { ram_mb: 4096, cpus: 8, region: 'ord', storage_gb: 10 },
  created_at: '2026-07-20T10:00:00Z',
  updated_at: '2026-07-20T11:00:00Z',
  bucket_name: 'bucket',
  primary_region: 'ord',
  url: 'https://hello.sprites.app',
  url_settings: { auth: 'sprite', private_access: 'admins' },
  version: '1.2.3',
  environment_version: '4.5.6',
  labels: ['sdk', 'test'],
  last_running_at: '2026-07-20T10:30:00Z',
  last_warming_at: '2026-07-20T10:20:00Z',
};

describe('SpritesClient public interface', () => {
  it('preserves compatible optional response fields and extensible URL auth values', () => {
    const info: SpriteInfo = {
      id: 'sprite-1',
      name: 'demo',
      organization: 'test-org',
      status: 'running',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const list: SpriteList = { sprites: [info], hasMore: false };
    const settings: URLSettings = { auth: 'future-api-auth-mode' };
    // @ts-expect-error HTTP exec cannot create detachable sessions.
    const unsupported: HTTPExecOptions = { detachable: true };

    assert.equal(list.sprites[0].labels, undefined);
    assert.equal(list.running, undefined);
    assert.equal(settings.auth, 'future-api-auth-mode');
    void unsupported;
  });

  it('constructs handles and preserves client options', () => {
    const client = new SpritesClient('token', {
      baseURL: 'https://example.test///',
      timeout: 1234,
      controlMode: true,
    });
    assert.equal(client.baseURL, 'https://example.test');
    assert.equal(client.token, 'token');
    assert.equal(client.controlMode, true);
    assert.equal(client.sprite('demo').name, 'demo');
  });

  it('creates a Sprite with every current API option and maps response metadata', async () => {
    const calls = captureFetch(jsonResponse(spriteJSON, 201));
    const client = new SpritesClient('token', { baseURL: 'https://example.test' });
    const sprite = await client.createSprite('hello world', {
      config: { ramMB: 4096, cpus: 8, region: 'ord', storageGB: 10 },
      environment: { MODE: 'test' },
      urlSettings: { auth: 'sprite', privateAccess: 'admins' },
      labels: ['sdk', 'test'],
      waitForCapacity: true,
      runtime: 'dev',
    });

    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      name: 'hello world',
      config: { ram_mb: 4096, cpus: 8, region: 'ord', storage_gb: 10 },
      environment: { MODE: 'test' },
      url_settings: { auth: 'sprite', private_access: 'admins' },
      labels: ['sdk', 'test'],
      wait_for_capacity: true,
      runtime: 'dev',
    });
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.match(headers['User-Agent'], /^sprites-js\//);
    assert.match(headers['Fly-Client-Interactive'], /^(true|false)$/);
    assert.match(headers['Fly-Client-Parent'], /^(node|python|shell|other)$/);
    assert.equal(headers.Authorization, 'Bearer token');
    assert.equal(sprite.config?.ramMB, 4096);
    assert.equal(sprite.organizationName, 'test-org');
    assert.equal(sprite.urlSettings?.privateAccess, 'admins');
    assert.deepEqual(sprite.labels, ['sdk', 'test']);
    assert.equal(sprite.version, '1.2.3');
    assert.equal(sprite.environmentVersion, '4.5.6');
    assert.equal(sprite.lastRunningAt?.toISOString(), '2026-07-20T10:30:00.000Z');
  });

  it('keeps the legacy createSprite(name, config, options) signature', async () => {
    const calls = captureFetch(jsonResponse(spriteJSON, 201));
    const client = new SpritesClient('token', { baseURL: 'https://example.test' });
    await client.createSprite(
      'demo',
      { ramMB: 1024 },
      { labels: ['legacy'], urlSettings: { auth: 'public' } }
    );
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      name: 'demo',
      config: { ram_mb: 1024 },
      labels: ['legacy'],
      url_settings: { auth: 'public' },
    });
  });

  it('gets, lists, and automatically paginates Sprites', async () => {
    const calls = captureFetch(
      jsonResponse(spriteJSON),
      jsonResponse({ sprites: [spriteJSON], has_more: true, next_continuation_token: 'next', running: 1, warm: 2, cold: 3, name: 'test-org', running_limit: 10, warm_limit: 20 }),
      jsonResponse({ sprites: [spriteJSON], has_more: true, next_continuation_token: 'next' }),
      jsonResponse({ sprites: [{ ...spriteJSON, name: 'second' }], has_more: false })
    );
    const client = new SpritesClient('token', { baseURL: 'https://example.test' });

    assert.equal((await client.getSprite('hello world')).id, 'sprite-1');
    const page = await client.listSprites({ prefix: 'hello ', maxResults: 10, continuationToken: 'a/b', bulkLoad: true });
    assert.deepEqual({ running: page.running, warm: page.warm, cold: page.cold }, { running: 1, warm: 2, cold: 3 });
    assert.deepEqual(
      { name: page.organizationName, runningLimit: page.runningLimit, warmLimit: page.warmLimit },
      { name: 'test-org', runningLimit: 10, warmLimit: 20 }
    );
    const query = new URL(calls[1].url).searchParams;
    assert.equal(query.get('bulk_load'), 'true');
    assert.equal(query.get('continuation_token'), 'a/b');

    const all = await client.listAllSprites('hello');
    assert.deepEqual(all.map(sprite => sprite.name), ['hello world', 'second']);
    assert.match(calls[0].url, /hello%20world$/);
  });

  it('streams real-time Sprite state and organization counts', async () => {
    const calls = captureFetch(new Response(
      '{"name":"demo","status":"running","running_version":"1.2.3","last_running_at":"2026-07-20T10:00:00Z","org":{"name":"test-org","running":1,"warm":2,"cold":3,"running_limit":10,"warm_limit":20}}\n'
    ));
    const client = new SpritesClient('token', { baseURL: 'https://example.test' });
    const stream = await client.watchSprites({ prefix: 'dev-', maxResults: 5 });
    const event = await stream.next();
    assert.equal(event?.runningVersion, '1.2.3');
    assert.equal(event?.lastRunningAt?.toISOString(), '2026-07-20T10:00:00.000Z');
    assert.deepEqual(event?.organization, {
      name: 'test-org', running: 1, warm: 2, cold: 3, runningLimit: 10, warmLimit: 20,
    });
    assert.equal((calls[0].init?.headers as Record<string, string>).Accept, 'application/x-ndjson');
    assert.equal(new URL(calls[0].url).searchParams.get('prefix'), 'dev-');
  });

  it('deletes, upgrades, restarts, and checks a Sprite', async () => {
    const calls = captureFetch(
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      jsonResponse({ sprite_name: 'hello world', machine_id: 'machine-1', message: 'queued' }, 202),
      jsonResponse({ sprite_name: 'hello world', sprite_id: 'sprite-1', status: 'ok', reason: null, checked_at: '2026-07-20T12:00:00Z', elapsed: 0.25 })
    );
    const client = new SpritesClient('token', { baseURL: 'https://example.test' });
    await client.deleteSprite('hello world');
    await client.upgradeSprite('hello world');
    assert.deepEqual(await client.restartSprite('hello world'), {
      spriteName: 'hello world', machineId: 'machine-1', message: 'queued',
    });
    const check = await client.checkSprite('hello world');
    assert.equal(check.checkedAt.toISOString(), '2026-07-20T12:00:00.000Z');
    assert.equal(check.reason, undefined);
    assert.ok(calls.every(call => call.url.includes('hello%20world')));
  });

  it('updates URL settings and labels and rejects an empty update', async () => {
    const calls = captureFetch(jsonResponse(spriteJSON), jsonResponse(spriteJSON));
    const client = new SpritesClient('token', { baseURL: 'https://example.test' });
    await client.updateURLSettings('hello world', { auth: 'public', privateAccess: 'admins' });
    const updated = await client.updateSprite('hello world', { labels: [] });
    assert.equal(updated.name, 'hello world');
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      url_settings: { auth: 'public', private_access: 'admins' },
    });
    assert.deepEqual(JSON.parse(calls[1].init?.body as string), { labels: [] });
    await assert.rejects(() => client.updateSprite('demo', {}), /urlSettings or labels is required/);
  });

  it('creates access tokens and encodes organization slugs', async () => {
    const calls = captureFetch(jsonResponse({ token: 'sprite-token' }, 201));
    assert.equal(await SpritesClient.createToken('fly-token', 'org/name', 'invite'), 'sprite-token');
    assert.match(calls[0].url, /organizations\/org%2Fname\/tokens$/);
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      description: 'Sprite SDK Token', invite_code: 'invite',
    });
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(Object.keys(headers).some(name => name.startsWith('Fly-Client-')), false);
  });

  it('surfaces structured API and network errors', async () => {
    captureFetch(jsonResponse({ error: 'limited', error_code: 'sprite_creation_rate_limited' }, 429));
    const client = new SpritesClient('token', { baseURL: 'https://example.test' });
    await assert.rejects(() => client.getSprite('demo'), APIError);

    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    await assert.rejects(() => client.getSprite('demo'), /Network error: offline/);
  });
});
