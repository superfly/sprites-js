import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { SpritesClient } from './client.js';
import { FilesystemError } from './types.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SpriteFilesystem public interface', () => {
  it('supports every filesystem operation and Node-like result objects', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      calls.push({ url: url.toString(), init });
      const endpoint = url.pathname.split('/fs/')[1];
      if (endpoint === 'read') {
        if (url.searchParams.get('path') === 'missing') {
          return new Response(JSON.stringify({ error: 'not found', code: 'ENOENT', path: 'missing' }), { status: 404 });
        }
        const content = url.searchParams.get('path')?.endsWith('.json') ? '{"ok":true}' : 'hello';
        return new Response(content);
      }
      if (endpoint === 'list') {
        return new Response(JSON.stringify({ path: '/app', count: 2, entries: [
          { name: 'file.txt', path: '/app/file.txt', type: 'file', size: 5, mode: '0644', modTime: '2026-07-20T10:00:00Z', isDir: false },
          { name: 'dir', path: '/app/dir', type: 'directory', size: 0, mode: '0755', modTime: '2026-07-20T10:00:00Z', isDir: true },
        ] }));
      }
      return new Response(null, { status: endpoint === 'delete' ? 204 : 200 });
    }) as typeof fetch;

    const fs = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo/name').filesystem('/app');
    assert.equal(await fs.readFile('file.txt', 'utf8'), 'hello');
    assert.deepEqual(await fs.readFile('file.txt', null), Buffer.from('hello'));
    await fs.writeFile('file.txt', 'data', { mode: 0o600 });
    assert.deepEqual(await fs.readdir('.'), ['file.txt', 'dir']);
    const entries = await fs.readdir('.', { withFileTypes: true });
    assert.equal(entries[0].isFile(), true);
    assert.equal(entries[0].isDirectory(), false);
    assert.equal(entries[0].isSymbolicLink(), false);
    assert.equal(entries[1].isDirectory(), true);
    assert.equal(entries[0].parentPath, '.');
    await fs.mkdir('nested/path', { recursive: true, mode: 0o755 });
    await fs.rm('old', { recursive: true });

    const stats = await fs.stat('file.txt');
    assert.equal(stats.size, 5);
    assert.equal(stats.mode, 0o644);
    assert.equal(stats.isFile(), true);
    assert.equal(stats.isDirectory(), false);
    assert.equal(stats.isSymbolicLink(), false);
    assert.equal(stats.mtime.toISOString(), '2026-07-20T10:00:00.000Z');

    await fs.rename('old', 'new');
    await fs.copyFile('source', 'dest', { recursive: true });
    await fs.chmod('script.sh', 0o755, { recursive: true });
    await fs.chown('script.sh', { uid: 'sprite', gid: 1000, recursive: true, asRoot: true });
    assert.equal(await fs.exists('file.txt'), true);
    await fs.appendFile('file.txt', ' world');
    assert.deepEqual(await fs.readJSON('data.json'), { ok: true });
    await fs.writeJSON('data.json', { ok: true }, { spaces: 2 });

    assert.ok(calls.every(call => call.url.includes('/sprites/demo%2Fname/fs/')));
    const write = calls.find(call => new URL(call.url).pathname.endsWith('/fs/write') && new URL(call.url).searchParams.get('path') === 'file.txt')!;
    assert.equal(new URL(write.url).searchParams.get('mode'), '0600');
    assert.deepEqual(Buffer.from(write.init?.body as Buffer), Buffer.from('data'));
    const rename = calls.find(call => new URL(call.url).pathname.endsWith('/fs/rename'))!;
    assert.deepEqual(JSON.parse(rename.init?.body as string), { source: 'old', dest: 'new', workingDir: '/app' });
    const chown = calls.find(call => new URL(call.url).pathname.endsWith('/fs/chown'))!;
    assert.deepEqual(JSON.parse(chown.init?.body as string), {
      path: 'script.sh', workingDir: '/app', uid: 'sprite', gid: 1000, recursive: true, asRoot: true,
    });
    await assert.rejects(() => fs.chown('script.sh', {}), /uid or gid is required/);
  });

  it('returns FilesystemError instances and honors force removal', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: 'not found', code: 'ENOENT', path: '/missing' }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
    const fs = new SpritesClient('token').sprite('demo').filesystem();

    await assert.rejects(
      () => fs.readFile('missing'),
      (error: unknown) => error instanceof FilesystemError && error.code === 'ENOENT' && error.syscall === 'read'
    );
    assert.equal(await fs.exists('missing'), false);
    await fs.rm('missing', { force: true });
  });

  it('maps a 404 without a structured code to ENOENT', async () => {
    // The server currently omits the `code` field on 404 responses, e.g.
    // reading a file that does not exist.
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: 'open /app/missing.txt: no such file or directory', path: '/app/missing.txt' }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
    const fs = new SpritesClient('token').sprite('demo').filesystem('/app');

    await assert.rejects(
      () => fs.readFile('missing.txt'),
      (error: unknown) => error instanceof FilesystemError && error.code === 'ENOENT' && error.syscall === 'read'
    );
  });

  it('maps a non-JSON 404 to ENOENT and other codeless failures to UNKNOWN', async () => {
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch;
    const fs = new SpritesClient('token').sprite('demo').filesystem('/app');
    await assert.rejects(
      () => fs.readFile('missing.txt'),
      (error: unknown) => error instanceof FilesystemError && error.code === 'ENOENT'
    );

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: 'boom', path: '/app/f' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
    await assert.rejects(
      () => fs.readFile('f'),
      (error: unknown) => error instanceof FilesystemError && error.code === 'UNKNOWN'
    );
  });
});
