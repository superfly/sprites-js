/**
 * Every authenticated transport in the SDK must carry client-signal
 * attribution. These tests exercise one call per module so a new call site
 * that skips authHeaders() fails here instead of shipping unattributed.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { SpritesClient } from './client.js';
import { ControlConnection } from './control.js';
import { SpriteCommand } from './exec.js';
import { ProxySession } from './proxy.js';
import { PortWatcher } from './watch.js';

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

const TOKEN = 'attribution-token';

function client(): SpritesClient {
  return new SpritesClient(TOKEN, { baseURL: 'https://example.test' });
}

/** Assert a captured header bag carries signals, a user agent, and auth. */
function assertAttributed(headers: Record<string, string> | undefined, label: string): void {
  assert.ok(headers, `${label}: no headers captured`);
  assert.match(headers['User-Agent'], /^sprites-js\//, `${label}: User-Agent`);
  assert.match(headers['Fly-Client-Interactive'], /^(true|false)$/, `${label}: interactive`);
  assert.match(headers['Fly-Client-Parent'], /^(node|python|shell|other)$/, `${label}: parent`);
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`, `${label}: authorization`);
}

/** Capture headers from every fetch, answering with an empty JSON object. */
function captureFetchHeaders(): Array<Record<string, string>> {
  const captured: Array<Record<string, string>> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    captured.push((init?.headers ?? {}) as Record<string, string>);
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return captured;
}

/**
 * Capture headers from every WebSocket handshake, then open on the next tick.
 * `replyWith` is delivered as a text frame so callers that block on a server
 * reply can finish instead of leaving their timeout pending.
 */
function captureSocketHeaders(replyWith?: string): Array<Record<string, string>> {
  const captured: Array<Record<string, string>> = [];
  class FakeWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    readonly CONNECTING = 0;
    binaryType = 'blob';
    readyState = 0;

    constructor(_url: string, options?: { headers?: Record<string, string> }) {
      super();
      captured.push(options?.headers ?? {});
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      });
    }

    send(): void {
      if (replyWith === undefined) return;
      // Deferred a full turn so the caller has registered its message handler.
      setTimeout(() => {
        this.dispatchEvent(new MessageEvent('message', { data: replyWith }));
      }, 0);
    }

    close(): void {}
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  return captured;
}

/** REST paths, one per module that builds its own request headers. */
const restCases: Array<[string, (sprite: any, api: SpritesClient) => Promise<unknown>]> = [
  ['client.listSprites', (_sprite, api) => api.listSprites()],
  ['sprite.listSessions', sprite => sprite.listSessions()],
  ['sprite.listCheckpoints', sprite => sprite.listCheckpoints()],
  ['services.listServices', sprite => sprite.listServices()],
  ['services.restartService', sprite => sprite.restartService('web')],
  ['policy.getNetworkPolicy', sprite => sprite.getNetworkPolicy()],
  ['policy.getPrivilegesPolicy', sprite => sprite.getPrivilegesPolicy()],
  ['filesystem.readFile', sprite => sprite.filesystem().readFile('/etc/hostname')],
  ['exec.execFileHTTP', sprite => sprite.execFileHTTP('echo', ['hi'])],
  ['exec.killSession', sprite => sprite.killSession('session-1')],
];

describe('client signal attribution', () => {
  for (const [label, call] of restCases) {
    it(`attributes ${label}`, async () => {
      const captured = captureFetchHeaders();
      const api = client();
      // Response handling is out of scope here; only the request headers matter.
      await call(api.sprite('my-sprite'), api).catch(() => {});
      assertAttributed(captured[0], label);
    });
  }

  it('attributes command WebSocket handshakes', async () => {
    const captured = captureSocketHeaders();
    const command = new SpriteCommand(client().sprite('my-sprite'), 'echo', ['hello']);
    try {
      await command.start();
      assertAttributed(captured[0], 'exec.SpriteCommand');
    } finally {
      // start() opens a keepalive interval that would hold the test process open.
      (command as any).wsCmd.close();
    }
  });

  it('attributes port watch WebSocket handshakes', async () => {
    const captured = captureSocketHeaders();
    await new PortWatcher(client(), 'my-sprite').connect();
    assertAttributed(captured[0], 'watch.PortWatcher');
  });

  it('attributes control WebSocket handshakes', async () => {
    const captured = captureSocketHeaders();
    await new ControlConnection(client().sprite('my-sprite')).connect();
    assertAttributed(captured[0], 'control.ControlConnection');
  });

  it('attributes proxy WebSocket handshakes', async () => {
    // A refused response unwinds handleConnection right after the handshake.
    const captured = captureSocketHeaders(
      JSON.stringify({ status: 'refused', target: 'localhost:5678' })
    );
    const session = new ProxySession(client(), 'my-sprite', {
      localPort: 1234,
      remotePort: 5678,
    });
    const socket = { destroy() {}, on() {}, end() {}, write() {} };
    await (session as any).handleConnection(socket).catch(() => {});
    assertAttributed(captured[0], 'proxy.ProxySession');
  });

  it('leaves the credential exchange unattributed', async () => {
    const captured = captureFetchHeaders();
    await SpritesClient.createToken('macaroon', 'my-org').catch(() => {});
    const headers = captured[0] ?? {};
    assert.equal(
      Object.keys(headers).some(name => name.startsWith('Fly-Client-')),
      false
    );
  });
});
