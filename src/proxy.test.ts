import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProxyManager, ProxySession, proxyPort, proxyPorts } from './proxy.js';
import { SpritesClient } from './client.js';

const client = { baseURL: 'https://example.test', token: 'token' };

describe('proxy public interface', () => {
  it('starts, reports, waits for, and closes ProxySession listeners', async () => {
    const session = new ProxySession(client, 'demo', { localPort: 0, remotePort: 3000 });
    assert.equal(session.localAddr(), null);
    assert.equal(session.remoteHost, 'localhost');
    await session.start();
    assert.match(session.localAddr()!, /^localhost:\d+$/);
    const waited = session.wait();
    session.close();
    await waited;
    session.close();
    assert.equal(session.localAddr(), null);
  });

  it('creates one or multiple proxy listeners with convenience functions', async () => {
    const single = await proxyPort(client, 'demo', 0, 3000, '127.0.0.1');
    assert.equal(single.remoteHost, '127.0.0.1');
    single.close();

    const many = await proxyPorts(client, 'demo', [
      { localPort: 0, remotePort: 3001 },
      { localPort: 0, remotePort: 3002 },
    ]);
    assert.equal(many.length, 2);
    many.forEach(session => session.close());

    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    const spriteSingle = await sprite.proxyPort(0, 4000);
    const spriteMany = await sprite.proxyPorts([{ localPort: 0, remotePort: 4001 }]);
    spriteSingle.close();
    spriteMany.forEach(session => session.close());
  });

  it('manages groups of sessions', async () => {
    const first = new ProxySession(client, 'demo', { localPort: 0, remotePort: 3000 });
    const second = new ProxySession(client, 'demo', { localPort: 0, remotePort: 3001 });
    await Promise.all([first.start(), second.start()]);
    const manager = new ProxyManager();
    manager.addSession(first);
    manager.addSession(second);
    manager.closeAll();
    await manager.waitAll();
  });
});
