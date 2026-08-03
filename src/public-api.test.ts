import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as api from './index.js';
import { SpritesClient } from './client.js';
import { ControlConnection, OpConn } from './control.js';
import { SpriteCommand } from './exec.js';
import { APIError, StreamID } from './types.js';

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;

type Listener = (event: any) => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static failNextConnection: string | undefined;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = 'blob';
  sent: unknown[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL) {
    this.url = url.toString();
    MockWebSocket.instances.push(this);
    const connectionError = MockWebSocket.failNextConnection;
    MockWebSocket.failNextConnection = undefined;
    queueMicrotask(() => {
      if (connectionError) {
        this.dispatch('error', { message: connectionError });
        return;
      }
      this.readyState = MockWebSocket.OPEN;
      this.dispatch('open', {});
    });
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch('close', { code, reason });
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function installWebSocket(): void {
  MockWebSocket.instances = [];
  MockWebSocket.failNextConnection = undefined;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
}

function binary(...bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
});

describe('package exports', () => {
  it('exports the complete supported runtime surface', () => {
    assert.deepEqual(Object.keys(api).sort(), [
      'APIError', 'CheckpointStream', 'ControlConnection',
      'ERR_CODE_CONCURRENT_LIMIT_EXCEEDED', 'ERR_CODE_CREATION_RATE_LIMITED',
      'ExecError', 'FilesystemError', 'FilesystemWatcher', 'OpConn', 'PortWatcher',
      'ProxyManager', 'ProxySession', 'RestoreStream', 'ServiceLogStream', 'SessionKillStream', 'Sprite', 'SpriteCommand',
      'SpriteFilesystem', 'SpriteListStream', 'SpritesClient', 'StreamID', 'parseAPIError',
      'proxyPort', 'proxyPorts',
    ]);
  });
});

describe('SpriteCommand and Sprite execution interfaces', () => {
  it('starts, streams, signals, resizes, reports exit, and waits', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo/name');
    const command = new SpriteCommand(sprite, 'printf', ['hello'], { tty: false });
    assert.ok(command.stdin.writable);
    assert.ok(command.stdout.readable);
    assert.ok(command.stderr.readable);
    await command.start();
    await assert.rejects(() => command.start(), /already started/);

    const ws = MockWebSocket.instances[0];
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    command.stdout.on('data', chunk => stdout.push(chunk));
    command.stderr.on('data', chunk => stderr.push(chunk));
    command.stdin.write('input');
    command.stdin.end();
    command.signal('HUP');
    command.kill();
    command.resize(80, 24);
    ws.dispatch('message', { data: binary(StreamID.Stdout, ...Buffer.from('out')) });
    ws.dispatch('message', { data: binary(StreamID.Stderr, ...Buffer.from('err')) });
    const waited = command.wait();
    ws.dispatch('message', { data: binary(StreamID.Exit, 0) });
    assert.equal(await waited, 0);
    assert.equal(command.exitCode(), 0);
    assert.equal(Buffer.concat(stdout).toString(), 'out');
    assert.equal(Buffer.concat(stderr).toString(), 'err');
    assert.match(ws.url, /sprites\/demo%2Fname\/exec/);
    assert.ok(ws.sent.some(value => typeof value === 'string' && value.includes('signal')));
  });

  it('covers Sprite spawn, session, exec, and execFile convenience methods', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    const spawned = sprite.spawn('true');
    const session = sprite.createSession('bash');
    const attached = sprite.attachSession('session/id');
    assert.ok(spawned instanceof SpriteCommand);
    assert.ok(session instanceof SpriteCommand);
    assert.ok(attached instanceof SpriteCommand);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(MockWebSocket.instances[2].url, /exec\/session%2Fid/);
    MockWebSocket.instances[2].dispatch('message', { data: '{"type":"session_info","tty":true}' });
    await new Promise(resolve => setImmediate(resolve));
    for (const ws of MockWebSocket.instances.slice(0, 3)) ws.close();

    const execPromise = sprite.exec('echo hello');
    await new Promise(resolve => setImmediate(resolve));
    let ws = MockWebSocket.instances.at(-1)!;
    ws.dispatch('message', { data: binary(StreamID.Stdout, ...Buffer.from('hello\n')) });
    ws.dispatch('message', { data: binary(StreamID.Exit, 0) });
    assert.equal((await execPromise).stdout, 'hello\n');

    const filePromise = sprite.execFile('false', [], { encoding: 'buffer' as BufferEncoding });
    await new Promise(resolve => setImmediate(resolve));
    ws = MockWebSocket.instances.at(-1)!;
    ws.dispatch('message', { data: binary(StreamID.Stderr, ...Buffer.from('failed')) });
    ws.dispatch('message', { data: binary(StreamID.Exit, 2) });
    await assert.rejects(filePromise, (error: any) => error.exitCode === 2 && Buffer.isBuffer(error.stderr));
  });

  it('closes the exec WebSocket when execution fails', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    const execution = sprite.execFile('command');
    await new Promise(resolve => setImmediate(resolve));

    const ws = MockWebSocket.instances[0];
    ws.dispatch('error', { message: 'connection failed' });

    await assert.rejects(execution, /connection failed/);
    assert.equal(ws.readyState, MockWebSocket.CLOSED);
  });

  it('closes the exec WebSocket when maxBuffer is exceeded', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    const execution = sprite.execFile('printf', [], { maxBuffer: 3 });
    await new Promise(resolve => setImmediate(resolve));

    const ws = MockWebSocket.instances[0];
    ws.dispatch('message', { data: binary(StreamID.Stdout, ...Buffer.from('large')) });

    await assert.rejects(execution, /stdout maxBuffer exceeded/);
    assert.equal(ws.readyState, MockWebSocket.CLOSED);
  });

  it('closes the exec WebSocket when execution times out', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    const execution = sprite.execFile('sleep', ['120'], { timeout: 50 });
    await new Promise(resolve => setImmediate(resolve));

    const ws = MockWebSocket.instances[0];
    t.mock.timers.tick(50);

    await assert.rejects(execution, /timed out after 50 ms/);
    assert.equal(ws.readyState, MockWebSocket.CLOSED);
  });

  it('closes a connecting exec WebSocket when execution is aborted', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    const abort = new AbortController();
    const execution = sprite.execFile('sleep', ['120'], { signal: abort.signal });

    abort.abort();

    await assert.rejects(execution, (error: any) => error.name === 'AbortError');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(MockWebSocket.instances[0].readyState, MockWebSocket.CLOSED);
  });

  it('ends streams and wait() when SpriteCommand.close() is called', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    const command = new SpriteCommand(sprite, 'sleep', ['120']);
    command.stdout.resume();
    command.stderr.resume();
    const stdoutEnded = new Promise(resolve => command.stdout.once('end', resolve));
    const stderrEnded = new Promise(resolve => command.stderr.once('end', resolve));
    await command.start();

    command.close();

    assert.equal(await command.wait(), -1);
    await Promise.all([stdoutEnded, stderrEnded]);
    assert.equal(MockWebSocket.instances[0].readyState, MockWebSocket.CLOSED);
  });

  it('validates exec timeout, treats zero as disabled, and removes abort listeners', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    await assert.rejects(() => sprite.execFile('true', [], { timeout: -1 }), TypeError);
    await assert.rejects(() => sprite.execFile('true', [], { timeout: Number.NaN }), TypeError);
    assert.equal(MockWebSocket.instances.length, 0);

    let removeCount = 0;
    const listeners = new Set<unknown>();
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: unknown) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: unknown) => {
        removeCount++;
        listeners.delete(listener);
      },
    } as unknown as AbortSignal;
    const execution = sprite.execFile('true', [], { signal, timeout: 0 });
    await new Promise(resolve => setImmediate(resolve));
    const ws = MockWebSocket.instances[0];
    ws.dispatch('message', { data: binary(StreamID.Exit, 0) });

    assert.equal((await execution).exitCode, 0);
    assert.equal(removeCount, 1);
    assert.equal(listeners.size, 0);
    assert.equal(ws.readyState, MockWebSocket.CLOSED);
  });

  it('does not retry an aborted control operation and uses control mode again', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', {
      baseURL: 'https://example.test', controlMode: true,
    }).sprite('demo');
    const abort = new AbortController();
    const execution = sprite.execFile('sleep', ['120'], { signal: abort.signal });
    await new Promise(resolve => setImmediate(resolve));

    abort.abort();

    await assert.rejects(execution, (error: any) => error.name === 'AbortError');
    assert.equal(MockWebSocket.instances.length, 1);
    assert.match(MockWebSocket.instances[0].url, /\/control$/);
    assert.equal(MockWebSocket.instances[0].readyState, MockWebSocket.CLOSED);

    const nextExecution = sprite.execFile('echo', ['hi']);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(MockWebSocket.instances.length, 2);
    const nextControl = MockWebSocket.instances[1];
    assert.match(nextControl.url, /\/control$/);
    nextControl.dispatch('message', {
      data: binary(StreamID.Stdout, ...Buffer.from('hi\n')),
    });
    nextControl.dispatch('message', {
      data: 'control:{"type":"op.complete","args":{"exitCode":0}}',
    });
    assert.deepEqual(await nextExecution, { stdout: 'hi\n', stderr: '', exitCode: 0 });
  });

  it('does not retry a timed-out control operation', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    installWebSocket();
    const sprite = new SpritesClient('token', {
      baseURL: 'https://example.test', controlMode: true,
    }).sprite('demo');
    const execution = sprite.execFile('sleep', ['120'], { timeout: 50 });
    await new Promise(resolve => setImmediate(resolve));

    t.mock.timers.tick(50);

    await assert.rejects(execution, /timed out after 50 ms/);
    assert.equal(MockWebSocket.instances.length, 1);
    assert.match(MockWebSocket.instances[0].url, /\/control$/);
    assert.equal(MockWebSocket.instances[0].readyState, MockWebSocket.CLOSED);
  });

  it('falls back only when the control connection cannot be established', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', {
      baseURL: 'https://example.test', controlMode: true,
    }).sprite('demo');
    MockWebSocket.failNextConnection = 'control unsupported';

    const execution = sprite.execFile('echo', ['fallback']);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(MockWebSocket.instances.length, 2);
    assert.match(MockWebSocket.instances[0].url, /\/control$/);
    assert.match(MockWebSocket.instances[1].url, /\/exec\?/);
    MockWebSocket.instances[1].dispatch('message', { data: binary(StreamID.Exit, 0) });
    assert.equal((await execution).exitCode, 0);
  });

  it('does not fall back after a control operation has started', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', {
      baseURL: 'https://example.test', controlMode: true,
    }).sprite('demo');
    const execution = sprite.execFile('false');
    await new Promise(resolve => setImmediate(resolve));

    MockWebSocket.instances[0].dispatch('message', {
      data: 'control:{"type":"op.error","args":{"error":"failed"}}',
    });

    await assert.rejects(execution, /failed/);
    assert.equal(MockWebSocket.instances.length, 1);
  });

  it('executes over HTTP and streams session-kill progress', async () => {
    const encoder = new TextEncoder();
    const responses = [
      new Response(new ReadableStream({ start(controller) {
        controller.enqueue(Uint8Array.from([StreamID.Stdout, ...Buffer.from('out')]));
        controller.enqueue(Uint8Array.from([StreamID.Stderr, ...Buffer.from('err')]));
        controller.enqueue(Uint8Array.from([StreamID.Exit, 0]));
        controller.close();
      } })),
      new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('{"type":"signal","message":"sent","signal":"SIGTERM","pid":2}\n'));
        controller.enqueue(encoder.encode('{"type":"complete","exit_code":0}\n'));
        controller.close();
      } })),
    ];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: input.toString(), init });
      return responses.shift()!;
    }) as typeof fetch;
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo/name');
    const abort = new AbortController();
    const result = await sprite.execFileHTTP('cat', [], {
      input: 'hello', env: { MODE: 'test' }, cwd: '/app', signal: abort.signal, timeout: 60_000,
    });
    assert.deepEqual(result, { stdout: 'out', stderr: 'err', exitCode: 0 });
    assert.equal(new URL(calls[0].url).searchParams.get('stdin'), 'true');
    assert.deepEqual(Buffer.from(calls[0].init?.body as Buffer), Buffer.from('hello'));
    assert.ok(calls[0].init?.signal instanceof AbortSignal);
    const kill = await sprite.killSession('session/id', 'TERM', '5s');
    assert.equal((await kill.next())?.pid, 2);
    assert.equal((await kill.next())?.exitCode, 0);
    assert.match(calls[1].url, /exec\/session%2Fid\/kill/);
  });

  it('rejects invalid HTTP frames and cancels the response stream on early failure', async () => {
    let invalidFrameCancelled = false;
    let maxBufferCancelled = false;
    const responses = [
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([0x7f, ...Buffer.from('continued output')]));
        },
        cancel() { invalidFrameCancelled = true; },
      })),
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([StreamID.Stdout, ...Buffer.from('too large')]));
        },
        cancel() { maxBufferCancelled = true; },
      })),
    ];
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch;
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');

    await assert.rejects(
      () => sprite.execFileHTTP('cat'),
      /Unsupported HTTP exec frame type 0x7f/
    );
    assert.equal(invalidFrameCancelled, true);
    await assert.rejects(
      () => sprite.execFileHTTP('cat', [], { maxBuffer: 2 }),
      /stdout maxBuffer exceeded/
    );
    assert.equal(maxBufferCancelled, true);
    await assert.rejects(
      () => sprite.execFileHTTP('cat', [], { timeout: -1 }),
      /timeout must be a non-negative finite number/
    );
  });

  it('uses structured API errors for session-kill failures', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: 'too many requests', error_code: 'concurrent_limit_exceeded' }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    await assert.rejects(() => sprite.killSession('session'), APIError);
  });

  it('watches ports and filesystem events', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo/name');
    const ports = await sprite.watchPorts();
    let ws = MockWebSocket.instances[0];
    ws.dispatch('message', { data: '{"type":"port_list","ports":[]}' });
    assert.deepEqual(await ports.next(), { type: 'port_list', ports: [] });
    const nextPort = ports.next();
    ws.dispatch('error', { message: 'connection lost' });
    await assert.rejects(nextPort, /connection lost/);
    await assert.rejects(() => ports.next(), /connection lost/);
    assert.equal(ports.isClosed(), true);

    const watcher = await sprite.filesystem('/app').watch(['src', 'test'], { recursive: true });
    ws = MockWebSocket.instances[1];
    assert.deepEqual(JSON.parse(ws.sent[0] as string), {
      type: 'subscribe', paths: ['src', 'test'], recursive: true, workingDir: '/app',
    });
    ws.dispatch('message', { data: '{"type":"event","path":"src/a.ts","event":"write","isDir":false}' });
    assert.equal((await watcher.next())?.event, 'write');
    const iteration = (async () => {
      for await (const _event of watcher) {
        // Wait for a terminal watcher error.
        void _event;
      }
    })();
    await new Promise(resolve => setImmediate(resolve));
    ws.dispatch('error', { message: 'filesystem watch failed' });
    await assert.rejects(iteration, /filesystem watch failed/);
  });
});

describe('control interfaces', () => {
  it('covers OpConn I/O, messages, completion, closing, and state', async () => {
    const sent: Buffer[] = [];
    const fakeConnection = {
      sendData: (data: Buffer) => { sent.push(data); },
    } as unknown as ControlConnection;
    const op = new OpConn(fakeConnection, false);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const messages: unknown[] = [];
    op.on('stdout', value => stdout.push(value));
    op.on('stderr', value => stderr.push(value));
    op.on('message', value => messages.push(value));
    op.write(Buffer.from('in'));
    op.sendEOF();
    op.resize(80, 24);
    op.signal('TERM');
    op.handleData(Buffer.from([StreamID.Stdout, ...Buffer.from('out')]));
    op.handleData(Buffer.from([StreamID.Stderr, ...Buffer.from('err')]));
    op.handleData(Buffer.from([StreamID.Exit, 7]));
    op.handleText('{"type":"port_opened","port":3000}');
    const waited = op.wait();
    op.complete();
    assert.equal(await waited, 7);
    assert.equal(op.getExitCode(), 7);
    assert.equal(op.isClosed(), true);
    assert.equal(Buffer.concat(stdout).toString(), 'out');
    assert.equal(Buffer.concat(stderr).toString(), 'err');
    assert.equal((messages[0] as any).port, 3000);
    assert.equal(sent[0][0], StreamID.Stdin);
    assert.equal(sent[1][0], StreamID.StdinEOF);
    assert.throws(() => op.write(Buffer.from('late')), /Operation closed/);
    op.close();
  });

  it('connects ControlConnection, starts operations, sends data, and closes', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo/name');
    const connection = new ControlConnection(sprite);
    assert.equal(connection.isActive(), false);
    connection.setActive(true);
    assert.equal(connection.isActive(), true);
    await connection.connect();
    await assert.rejects(() => connection.connect(), /Already connected/);
    const op = await connection.startOp('exec', { cmd: ['echo'], env: ['A=1'], dir: '/app', tty: true, rows: 24, cols: 80, stdin: true });
    const ws = MockWebSocket.instances[0];
    assert.match(ws.url, /sprites\/demo%2Fname\/control$/);
    assert.ok(String(ws.sent[0]).startsWith('control:'));
    connection.sendData(Buffer.from('raw'));
    const waited = op.wait();
    ws.dispatch('message', { data: 'control:{"type":"op.complete","args":{"exitCode":4}}' });
    assert.equal(await waited, 4);
    connection.clearOpConn();
    connection.close();
    assert.equal(connection.isClosed(), true);
    await assert.rejects(() => connection.startOp('exec'), /closed/);

    const pooled = await sprite.getControlConnection();
    assert.equal(sprite.hasControlConnection(), true);
    assert.ok(pooled instanceof ControlConnection);
    sprite.closeControlConnection();
    assert.equal(sprite.hasControlConnection(), false);
  });

  it('clears operation state when an OpConn is closed early', async () => {
    installWebSocket();
    const sprite = new SpritesClient('token', { baseURL: 'https://example.test' }).sprite('demo');
    const connection = new ControlConnection(sprite);
    await connection.connect();

    const first = await connection.startOp('exec', { cmd: ['sleep', '120'] });
    first.close();
    const second = await connection.startOp('exec', { cmd: ['echo', 'hi'] });

    const waited = second.wait();
    MockWebSocket.instances[0].dispatch('message', {
      data: 'control:{"type":"op.complete","args":{"exitCode":0}}',
    });
    assert.equal(await waited, 0);
    connection.close();
  });
});
