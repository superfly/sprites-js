import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { SpritesClient } from './client.js';
import { Sprite } from './sprite.js';
import { SpriteFilesystem } from './filesystem.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Sprite public interface', () => {
  it('delegates lifecycle and update operations to its client', async () => {
    const client = new SpritesClient('token');
    const sprite = new Sprite('demo', client);
    const calls: unknown[][] = [];
    client.deleteSprite = async (...args) => { calls.push(['delete', ...args]); };
    client.upgradeSprite = async (...args) => { calls.push(['upgrade', ...args]); };
    client.restartSprite = async (...args) => {
      calls.push(['restart', ...args]);
      return { spriteName: 'demo', machineId: 'm1', message: 'queued' };
    };
    client.checkSprite = async (...args) => {
      calls.push(['check', ...args]);
      return { spriteName: 'demo', spriteId: 's1', status: 'ok', checkedAt: new Date(0) };
    };
    client.updateURLSettings = async (...args) => { calls.push(['url', ...args]); };
    client.updateSprite = async (...args) => { calls.push(['update', ...args]); return sprite; };

    await sprite.delete();
    await sprite.destroy();
    await sprite.upgrade();
    assert.equal((await sprite.restart()).machineId, 'm1');
    assert.equal((await sprite.check()).status, 'ok');
    await sprite.updateURLSettings({ auth: 'public' });
    assert.equal(await sprite.update({ labels: ['test'] }), sprite);
    assert.deepEqual(calls.map(call => call[0]), ['delete', 'delete', 'upgrade', 'restart', 'check', 'url', 'update']);
  });

  it('lists sessions and supports every checkpoint operation', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      json({ sessions: [{ id: 'session-1', command: 'bash', workdir: '/app', created: '2026-07-20T10:00:00Z', bytes_per_second: 12.5, is_active: true, last_activity: '2026-07-20T10:01:00Z', tty: true }] }),
      new Response('{"type":"info","data":"saving"}\n{"type":"complete","data":"Checkpoint v1 created"}\n'),
      json([{ id: 'v1', create_time: '2026-07-20T10:00:00Z', comment: 'first', history: ['Current'], is_auto: true }]),
      json({ id: 'v1', create_time: '2026-07-20T10:00:00Z', comment: 'first', history: [], is_auto: true }),
      new Response('{"type":"info","data":"restoring"}\n{"type":"complete","data":"Restore from v1 complete"}\n'),
    ];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: input.toString(), init });
      return responses.shift()!;
    }) as typeof fetch;

    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo/name');
    const sessions = await sprite.listSessions();
    assert.equal(sessions[0].lastActivity?.toISOString(), '2026-07-20T10:01:00.000Z');

    const create = await sprite.createCheckpoint('before deploy');
    assert.deepEqual(await create.next(), { type: 'info', data: 'saving' });
    const checkpoints = await sprite.listCheckpoints('all/history');
    assert.equal(checkpoints[0].isAuto, true);
    assert.equal(new URL(calls[2].url).searchParams.get('history'), 'all/history');
    assert.equal((await sprite.getCheckpoint('v/1')).isAuto, true);
    const restore = await sprite.restoreCheckpoint('v/1');
    assert.equal((await restore.next())?.data, 'restoring');
    assert.ok(calls.every(call => call.url.includes('demo%2Fname')));
    assert.match(calls[3].url, /checkpoints\/v%2F1$/);
  });

  it('exposes services, policies, filesystem, and control-mode state', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init });
      if (url.endsWith('/services') && init?.method === 'GET') {
        return json({ services: [{ name: 'web api', cmd: 'node', args: [], needs: [], http_port: 3000, state: { name: 'web api', status: 'running', restart_count: 2 } }] });
      }
      if (new URL(url).pathname.endsWith('/services/web%20api') && init?.method === 'GET') {
        return json({ name: 'web api', cmd: 'node', args: [], needs: [], http_port: 3000 });
      }
      if (new URL(url).pathname.endsWith('/services/web%20api') && init?.method === 'PUT') {
        return new Response('{"type":"started","timestamp":1,"log_files":{"stdout":"/tmp/out"}}\n');
      }
      if (url.includes('/services/web%20api/start')) return new Response('{"type":"started","timestamp":2}\n');
      if (url.includes('/services/web%20api/stop')) return new Response('{"type":"stopped","timestamp":3,"exit_code":0}\n');
      if (url.includes('/services/web%20api/restart')) return new Response('{"type":"started","timestamp":4}\n');
      if (url.includes('/services/web%20api/logs')) return new Response('{"type":"stdout","data":"log","timestamp":5}\n');
      if (url.includes('/services/signal')) return new Response(null, { status: 204 });
      if (new URL(url).pathname.endsWith('/services/web%20api') && init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.endsWith('/policy/network') && init?.method === 'GET') return json({ rules: [{ action: 'allow', domain: 'example.com' }] });
      if (url.endsWith('/policy/network') && init?.method === 'POST') return new Response(null, { status: 204 });
      if (url.endsWith('/policy/privileges') && init?.method === 'GET') return json({ profile: 'standard', devices: ['null'], noNewPrivileges: true });
      if (url.endsWith('/policy/privileges')) return new Response(null, { status: 204 });
      if (url.endsWith('/policy/resources') && init?.method === 'GET') return json({ memory: { limit_mb: 512, autoscale: true } });
      if (url.endsWith('/policy/resources')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as typeof fetch;

    const client = new SpritesClient('token', { baseURL: 'https://example.test', controlMode: true });
    const sprite = client.sprite('demo/name');
    const services = await sprite.listServices();
    assert.equal(services[0].httpPort, 3000);
    assert.equal(services[0].state?.restartCount, 2);
    assert.equal((await sprite.getService('web api')).name, 'web api');
    const created = await sprite.createService('web api', { cmd: 'node', env: { MODE: 'test' }, dir: '/app', httpPort: 3000 }, '5s');
    assert.deepEqual(await created.next(), { type: 'started', data: undefined, exitCode: undefined, timestamp: 1, logFiles: { stdout: '/tmp/out' } });
    const createCall = calls.find(call => call.init?.method === 'PUT')!;
    assert.deepEqual(JSON.parse(createCall.init?.body as string), { cmd: 'node', env: { MODE: 'test' }, dir: '/app', http_port: 3000 });
    assert.equal((await (await sprite.startService('web api', '5s')).next())?.type, 'started');
    assert.equal((await (await sprite.stopService('web api', '10s')).next())?.exitCode, 0);
    assert.equal((await (await sprite.restartService('web api', '5s')).next())?.type, 'started');
    assert.equal((await (await sprite.getServiceLogs('web api', { lines: 10, duration: '1s' })).next())?.data, 'log');
    await sprite.signalService('web api', 'TERM');
    await sprite.deleteService('web api');
    assert.equal((await sprite.getNetworkPolicy()).rules[0].domain, 'example.com');
    await sprite.updateNetworkPolicy({ rules: [{ include: 'defaults' }] });
    assert.equal((await sprite.getPrivilegesPolicy()).profile, 'standard');
    await sprite.updatePrivilegesPolicy({ profile: 'minimal', noNewPrivileges: true });
    await sprite.deletePrivilegesPolicy();
    assert.equal((await sprite.getResourcesPolicy()).memory?.limitMB, 512);
    await sprite.updateResourcesPolicy({ memory: { limitMB: 1024, autoscale: false } });
    await sprite.deleteResourcesPolicy();

    assert.ok(sprite.filesystem('/app') instanceof SpriteFilesystem);
    assert.equal(sprite.useControlMode(), true);
    assert.equal(sprite.hasControlConnection(), false);
    sprite.closeControlConnection();
  });
});
