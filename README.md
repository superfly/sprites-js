# Sprites JavaScript/TypeScript SDK

Remote command execution for Sprites, with an API that mirrors Node.js `child_process`.

## Requirements

- Node.js 24.0.0 or later
- No external dependencies (uses only Node.js standard library)

## Installation

```bash
npm install @fly/sprites
```

## Quick Start

```typescript
import { SpritesClient } from '@fly/sprites';

const client = new SpritesClient(process.env.SPRITES_TOKEN!);
const sprite = client.sprite('my-sprite');

// Event-based API (most Node.js-like)
const cmd = sprite.spawn('ls', ['-la']);
cmd.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});
cmd.on('exit', (code) => {
  console.log(`Exited with code ${code}`);
});

// Promise-based API
const { stdout } = await sprite.exec('echo hello');
console.log(stdout); // 'hello\n'
```

## API Reference

### SpritesClient

Main client for interacting with the Sprites API.

```typescript
const client = new SpritesClient(token, options);
```

**Options:**
- `baseURL`: API base URL (default: https://api.sprites.dev)
- `timeout`: HTTP request timeout in ms (default: 30000)
- `controlMode`: use multiplexed control connections for supported operations (default: false)

**Methods:**
- `sprite(name: string): Sprite` - Get a handle to a sprite
- `createSprite(name: string, options?: CreateSpriteOptions): Promise<Sprite>` - Create a new sprite
- `createSprite(name: string, config?: SpriteConfig, options?: Omit<CreateSpriteOptions, 'config'>): Promise<Sprite>` - Backward-compatible creation form
- `getSprite(name: string): Promise<Sprite>` - Get sprite information
- `listSprites(options?: ListOptions): Promise<SpriteList>` - List sprites
- `watchSprites(options?): Promise<SpriteListStream>` - Stream live sprite state and organization counts
- `listAllSprites(prefix?: string): Promise<Sprite[]>` - List all sprites (handles pagination)
- `deleteSprite(name: string): Promise<void>` - Delete a sprite
- `upgradeSprite(name: string): Promise<void>` - Upgrade a sprite
- `restartSprite(name: string): Promise<RestartSpriteResult>` - Restart the backing machine
- `checkSprite(name: string): Promise<SpriteCheck>` - Check sprite health
- `updateSprite(name: string, options: UpdateSpriteOptions): Promise<Sprite>` - Update URL settings and/or labels
- `updateURLSettings(name: string, settings: URLSettings): Promise<void>` - Update only URL access settings
- `static createToken(flyMacaroon: string, orgSlug: string, inviteCode?: string): Promise<string>` - Create an access token

Creation options include `config`, `environment`, `urlSettings`, `labels`, `waitForCapacity`, and the `default` or `dev` `runtime`. List options include `prefix`, `maxResults`, `continuationToken`, and `bulkLoad`.

### Sprite

Represents a sprite instance.

```typescript
const sprite = client.sprite('my-sprite');
```

**Command Execution Methods:**

```typescript
// Event-based (mirrors child_process.spawn)
spawn(command: string, args?: string[], options?: SpawnOptions): SpriteCommand

// Promise-based (mirrors child_process.exec)
exec(command: string, options?: ExecOptions): Promise<ExecResult>

// Promise-based with separate args (mirrors child_process.execFile)
execFile(file: string, args?: string[], options?: ExecOptions): Promise<ExecResult>
```

**Session Methods:**
- `createSession(command: string, args?: string[], options?: SpawnOptions): SpriteCommand` - Create a detachable session
- `attachSession(sessionId: string, options?: SpawnOptions): SpriteCommand` - Attach to a session
- `listSessions(): Promise<Session[]>` - List active sessions

**Management Methods:**
- `delete(): Promise<void>` - Delete the sprite
- `destroy(): Promise<void>` - Alias for delete
- `upgrade(): Promise<void>` - Upgrade the sprite
- `restart(): Promise<RestartSpriteResult>` - Restart the backing machine
- `check(): Promise<SpriteCheck>` - Check sprite health
- `update(options: UpdateSpriteOptions): Promise<Sprite>` - Update URL settings and/or labels
- `updateURLSettings(settings: URLSettings): Promise<void>` - Update URL access settings

`Sprite` also exposes checkpoint, service, network-policy, filesystem, port-proxy, and control-connection methods. All resource names and IDs are safely path-encoded by the SDK.

Current environment APIs include:

- `execFileHTTP(...)` for non-TTY execution without WebSockets
- `killSession(...)` with an async iterable progress stream
- `watchPorts()` for snapshots and live port events
- `restartService(...)` and `getServiceLogs(...)`
- network, privileges, and resource policy get/update/delete operations
- filesystem ownership changes and live filesystem watching

> **HTTP exec protocol limitation:** The current `execFileHTTP` response format
> prefixes each frame with a type byte but does not include a frame length. HTTP
> intermediaries are allowed to split or combine transport chunks, so the SDK
> cannot reliably reconstruct large or high-volume output. The method rejects
> unrecognized frame types and supports `signal` and `timeout` cancellation, but
> combined frames can remain ambiguous. Prefer the WebSocket-based `exec` or
> `execFile` methods until the server protocol provides explicit frame lengths.

### SpriteCommand

Represents a running command. Extends EventEmitter.

**Properties:**
- `stdin: Writable` - Standard input stream
- `stdout: Readable` - Standard output stream
- `stderr: Readable` - Standard error stream

**Methods:**
- `wait(): Promise<number>` - Wait for exit and return exit code
- `kill(signal?: string): void` - Kill the command
- `resize(cols: number, rows: number): void` - Resize TTY (if TTY mode enabled)
- `exitCode(): number` - Get exit code (-1 if not exited)

**Events:**
- `exit` - `(code: number) => void` - Emitted when command exits
- `error` - `(error: Error) => void` - Emitted on error
- `message` - `(msg: any) => void` - Emitted for text messages (e.g., port notifications)

### Spawn Options

```typescript
interface SpawnOptions {
  cwd?: string;                    // Working directory
  env?: Record<string, string>;    // Environment variables
  tty?: boolean;                   // Enable TTY mode
  rows?: number;                   // TTY rows
  cols?: number;                   // TTY columns
  detachable?: boolean;            // Create detachable session
  sessionId?: string;              // Attach to existing session
  controlMode?: boolean;           // Enable control mode
}
```

### Exec Options

Extends SpawnOptions with:
- `encoding?: BufferEncoding` - Output encoding (default: 'utf8')
- `maxBuffer?: number` - Maximum buffer size (default: 10MB)

## Examples

### Basic Command Execution

```typescript
// Streaming output
const cmd = sprite.spawn('ls', ['-la']);
cmd.stdout.pipe(process.stdout);
cmd.stderr.pipe(process.stderr);
await cmd.wait();

// Capture output
const { stdout, stderr } = await sprite.exec('ls -la');
console.log(stdout);
```

### TTY Mode

```typescript
const cmd = sprite.spawn('bash', [], {
  tty: true,
  rows: 24,
  cols: 80,
});

process.stdin.pipe(cmd.stdin);
cmd.stdout.pipe(process.stdout);

// Resize terminal
cmd.resize(100, 30);
```

### Port Notifications

```typescript
const cmd = sprite.spawn('python', ['app.py']);

cmd.on('message', (msg) => {
  if (msg.type === 'port_opened') {
    console.log(`Port ${msg.port} opened by PID ${msg.pid}`);
    // Start local proxy, etc.
  }
});
```

### Detachable Sessions

```typescript
// Create a detachable session
const session = sprite.createSession('bash');
await session.wait();

// List sessions
const sessions = await sprite.listSessions();
console.log(sessions);

// Attach to a session
const attached = sprite.attachSession(sessions[0].id);
```

### Error Handling

```typescript
import { ExecError } from '@fly/sprites';

try {
  await sprite.exec('false');
} catch (error) {
  if (error instanceof ExecError) {
    console.log('Exit code:', error.exitCode);
    console.log('Stdout:', error.stdout);
    console.log('Stderr:', error.stderr);
  }
}
```

### Usage attribution

The SDK adds privacy-safe client signals to Sprites API requests and WebSocket
handshakes. These include coarse process context in `Fly-Client-*` headers and
the SDK version in `User-Agent`; they do not include command arguments or
environment values.

Set `SPRITES_CLIENT_SIGNALS=0` to disable client-signal detection and headers.
The SDK version remains in `User-Agent`. The values `off`, `false`, `no`, and
`disabled` are also accepted.

### Sprite Management

```typescript
// Create a sprite
const sprite = await client.createSprite('my-sprite', {
  config: {
    ramMB: 512,
    cpus: 1,
    region: 'ord',
  },
  urlSettings: { auth: 'sprite', privateAccess: 'admins' },
  labels: ['development'],
  waitForCapacity: true,
  runtime: 'dev',
});

// List sprites
const sprites = await client.listAllSprites();

// Update and inspect lifecycle state
await sprite.update({ labels: ['development', 'typescript'] });
const health = await sprite.check();
await sprite.restart();

// Delete a sprite
await sprite.delete();
```

## License

MIT
