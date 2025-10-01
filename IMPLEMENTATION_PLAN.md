# Sprites JavaScript/TypeScript SDK Implementation Plan

## Overview

This document outlines the implementation plan for a JavaScript/TypeScript SDK for Sprites, designed to mirror the Go SDK's API while following Node.js conventions and patterns, particularly matching the `child_process` API for exec functionality.

**Target Environment:** Node.js 24+ (modern Node with native WebSocket support)
**Language:** TypeScript (idiomatic, modern)
**No external dependencies:** Use only Node.js standard library

## Repository Structure

```
sdks/js/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # Main exports
│   ├── client.ts             # Client class
│   ├── sprite.ts             # Sprite class
│   ├── exec.ts               # Command execution (mirroring child_process API)
│   ├── websocket.ts          # WebSocket communication layer
│   ├── management.ts         # Sprite management (create, list, delete)
│   ├── session.ts            # Session management
│   └── types.ts              # TypeScript type definitions
├── test-node-cli/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   └── index.ts          # CLI tool matching Go test-cli
│   └── bin/
│       └── test-cli          # Compiled executable
└── dist/                     # Compiled JavaScript output
```

## API Design - Mapping Go to TypeScript

### 1. Client Class

**Go SDK:**
```go
client := sprites.New(token, sprites.WithBaseURL(url))
sprite := client.Sprite(name)
```

**TypeScript SDK:**
```typescript
const client = new SpritesClient(token, { baseURL: url });
const sprite = client.sprite(name);
```

### 2. Exec API - Mirroring Node.js child_process

The Go SDK mirrors Go's `os/exec.Command`. Our TypeScript SDK should mirror Node.js `child_process`:

**Node.js child_process API:**
```typescript
const { spawn, exec, execFile } = require('child_process');
const child = spawn('ls', ['-la'], { cwd: '/tmp' });
child.stdout.on('data', (data) => { ... });
child.stderr.on('data', (data) => { ... });
child.on('exit', (code) => { ... });
```

**Our Sprite Exec API:**
```typescript
// Option 1: Event-based (most Node.js-like)
const cmd = sprite.spawn('ls', ['-la'], { cwd: '/tmp' });
cmd.stdout.on('data', (chunk: Buffer) => { ... });
cmd.stderr.on('data', (chunk: Buffer) => { ... });
cmd.on('exit', (code: number) => { ... });
await cmd.wait();

// Option 2: Promise-based convenience methods
const { stdout } = await sprite.exec('echo hello');
const { stdout, stderr } = await sprite.execWithStderr('ls -la');

// Option 3: Streaming with async iterators (modern Node.js)
const cmd = sprite.spawn('long-running-command');
for await (const chunk of cmd.stdout) {
  process.stdout.write(chunk);
}
```

### 3. Core Classes

#### SpritesClient
```typescript
class SpritesClient {
  constructor(token: string, options?: ClientOptions);
  
  // Sprite management
  sprite(name: string): Sprite;
  createSprite(name: string, config?: SpriteConfig): Promise<Sprite>;
  getSprite(name: string): Promise<Sprite>;
  listSprites(options?: ListOptions): Promise<SpriteList>;
  deleteSprite(name: string): Promise<void>;
  
  // Token management
  static createToken(flyMacaroon: string, orgSlug: string, inviteCode?: string): Promise<string>;
}
```

#### Sprite
```typescript
class Sprite {
  readonly name: string;
  
  // Command execution - mirrors child_process
  spawn(command: string, args?: string[], options?: SpawnOptions): SpriteCommand;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  execFile(file: string, args?: string[], options?: ExecOptions): Promise<ExecResult>;
  
  // Session management
  createSession(command: string, args?: string[], options?: SessionOptions): SpriteCommand;
  attachSession(sessionId: string, options?: AttachOptions): SpriteCommand;
  listSessions(): Promise<Session[]>;
  
  // Management
  delete(): Promise<void>;
  upgrade(): Promise<void>;
}
```

#### SpriteCommand (EventEmitter)
```typescript
class SpriteCommand extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  
  // Events: 'exit', 'error', 'message' (for text messages like port notifications)
  on(event: 'exit', listener: (code: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (message: any) => void): this;
  
  // Control
  wait(): Promise<number>; // Returns exit code
  kill(signal?: string): void;
  
  // TTY support
  setTTY(enable: boolean): void;
  resize(cols: number, rows: number): void;
}
```

### 4. WebSocket Protocol Implementation

The WebSocket protocol must match the Go SDK exactly:

**Stream IDs:**
```typescript
enum StreamID {
  Stdin = 0,
  Stdout = 1,
  Stderr = 2,
  Exit = 3,
  StdinEOF = 4,
}
```

**Binary Message Format (Non-TTY):**
- First byte: StreamID
- Remaining bytes: payload

**TTY Mode:**
- Binary messages: raw terminal data
- Text messages: control messages (JSON)

**Control Messages:**
```typescript
interface ControlMessage {
  type: 'resize';
  cols?: number;
  rows?: number;
}
```

### 5. TypeScript Types

```typescript
interface ClientOptions {
  baseURL?: string;
  timeout?: number;
  httpClient?: typeof fetch; // Allow custom fetch implementation
}

interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  tty?: boolean;
  rows?: number;
  cols?: number;
  detachable?: boolean;
  sessionId?: string;
  stdin?: Readable | 'pipe' | 'ignore';
  stdout?: Writable | 'pipe' | 'ignore';
  stderr?: Writable | 'pipe' | 'ignore';
}

interface ExecOptions extends SpawnOptions {
  encoding?: BufferEncoding;
  maxBuffer?: number;
}

interface ExecResult {
  stdout: string | Buffer;
  stderr: string | Buffer;
  exitCode: number;
}

interface SpriteConfig {
  ramMB?: number;
  cpus?: number;
  region?: string;
  storageGB?: number;
}

interface Session {
  id: string;
  command: string;
  created: Date;
  bytesPerSecond: number;
  isActive: boolean;
  lastActivity?: Date;
}

interface PortNotification {
  type: 'port_opened' | 'port_closed';
  port: number;
  address: string;
  pid: number;
}
```

## Implementation Details

### 1. WebSocket Communication (websocket.ts)

Use Node.js 24 native WebSocket:
```typescript
import { WebSocket } from 'ws'; // Actually, this is built-in now in Node 24

class WSCommand extends EventEmitter {
  private ws: WebSocket;
  private tty: boolean;
  private exitCode: number = -1;
  
  constructor(url: string, headers: Record<string, string>, options: WSCommandOptions) {
    super();
    this.ws = new WebSocket(url, { headers });
    this.setupWebSocket();
  }
  
  private setupWebSocket(): void {
    this.ws.onopen = () => this.handleOpen();
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onerror = (error) => this.handleError(error);
    this.ws.onclose = () => this.handleClose();
  }
  
  private handleMessage(event: MessageEvent): void {
    if (this.tty) {
      if (typeof event.data === 'string') {
        // Text message - control or notification
        this.emit('message', JSON.parse(event.data));
      } else {
        // Binary - raw terminal data
        this.stdout.write(event.data);
      }
    } else {
      // Non-TTY mode - stream-based protocol
      const data = Buffer.from(event.data);
      if (data.length === 0) return;
      
      const streamId = data[0];
      const payload = data.subarray(1);
      
      switch (streamId) {
        case StreamID.Stdout:
          this.stdout.write(payload);
          break;
        case StreamID.Stderr:
          this.stderr.write(payload);
          break;
        case StreamID.Exit:
          this.exitCode = payload.length > 0 ? payload[0] : 0;
          this.ws.close();
          break;
      }
    }
  }
  
  writeStdin(data: Buffer): void {
    if (this.tty) {
      this.ws.send(data);
    } else {
      const message = Buffer.allocUnsafe(data.length + 1);
      message[0] = StreamID.Stdin;
      data.copy(message, 1);
      this.ws.send(message);
    }
  }
  
  resize(cols: number, rows: number): void {
    if (!this.tty) return;
    const msg: ControlMessage = { type: 'resize', cols, rows };
    this.ws.send(JSON.stringify(msg));
  }
}
```

### 2. Command Execution (exec.ts)

```typescript
export class SpriteCommand extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  
  private ws: WSCommand;
  private exitPromise: Promise<number>;
  
  constructor(sprite: Sprite, command: string, args: string[], options: SpawnOptions) {
    super();
    
    // Create streams
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    
    // Build WebSocket URL
    const url = this.buildWebSocketURL(sprite, command, args, options);
    
    // Create WebSocket command
    this.ws = new WSCommand(url, {
      'Authorization': `Bearer ${sprite.client.token}`
    }, options);
    
    // Wire up streams
    this.setupStreams();
    
    // Create exit promise
    this.exitPromise = new Promise((resolve) => {
      this.once('exit', resolve);
    });
  }
  
  private setupStreams(): void {
    // Stdin: user -> WebSocket
    this.stdin.on('data', (chunk) => {
      this.ws.writeStdin(Buffer.from(chunk));
    });
    
    this.stdin.on('end', () => {
      this.ws.sendStdinEOF();
    });
    
    // Stdout/Stderr: WebSocket -> user
    this.ws.stdout.pipe(this.stdout);
    this.ws.stderr.pipe(this.stderr);
    
    // Exit handling
    this.ws.on('exit', (code) => {
      this.emit('exit', code);
    });
    
    // Message handling (port notifications, etc.)
    this.ws.on('message', (msg) => {
      this.emit('message', msg);
    });
  }
  
  async wait(): Promise<number> {
    return this.exitPromise;
  }
  
  kill(signal: string = 'SIGTERM'): void {
    this.ws.close();
  }
  
  resize(cols: number, rows: number): void {
    this.ws.resize(cols, rows);
  }
}
```

### 3. Convenience Methods

```typescript
// In Sprite class
async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
  const args = command.split(' ');
  const cmd = args.shift()!;
  
  return new Promise((resolve, reject) => {
    const proc = this.spawn(cmd, args, options);
    
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    
    proc.stdout.on('data', (chunk) => stdout.push(chunk));
    proc.stderr.on('data', (chunk) => stderr.push(chunk));
    
    proc.on('exit', (code) => {
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: code
      };
      
      if (code !== 0) {
        const error = new ExecError('Command failed', result);
        reject(error);
      } else {
        resolve(result);
      }
    });
    
    proc.on('error', reject);
  });
}
```

## Test CLI Implementation (test-node-cli)

The test CLI must accept the same arguments and produce the same output format as the Go test-cli:

```typescript
#!/usr/bin/env node

import { Command } from 'commander'; // Wait, no external deps!
// Actually, we'll use vanilla argument parsing

interface CLIOptions {
  baseUrl: string;
  sprite?: string;
  dir?: string;
  env?: string;
  tty: boolean;
  ttyRows: number;
  ttyCols: number;
  detachable: boolean;
  sessionId?: string;
  timeout: number;
  output: 'stdout' | 'combined' | 'exit-code' | 'default';
  logTarget?: string;
}

async function main() {
  const options = parseArgs(process.argv);
  const token = process.env.SPRITES_TOKEN;
  
  if (!token) {
    console.error('Error: SPRITES_TOKEN environment variable is required');
    process.exit(1);
  }
  
  const logger = options.logTarget ? new Logger(options.logTarget) : null;
  
  const client = new SpritesClient(token, { baseURL: options.baseUrl });
  
  // Handle special commands
  if (args[0] === 'create') {
    await createSprite(client, args[1], logger);
    return;
  }
  
  if (args[0] === 'destroy') {
    await destroySprite(client, args[1], logger);
    return;
  }
  
  // Execute command
  const sprite = client.sprite(options.sprite!);
  
  logger?.logEvent('command_start', {
    sprite: options.sprite,
    command: args[0],
    args: args.slice(1),
    // ... other options
  });
  
  const cmd = sprite.spawn(args[0], args.slice(1), {
    cwd: options.dir,
    env: parseEnv(options.env),
    tty: options.tty,
    rows: options.ttyRows,
    cols: options.ttyCols,
    detachable: options.detachable,
    sessionId: options.sessionId,
  });
  
  // Handle text messages (port notifications)
  cmd.on('message', (data) => {
    logger?.logEvent('text_message', { data });
  });
  
  // Execute based on output mode
  switch (options.output) {
    case 'stdout': {
      const chunks: Buffer[] = [];
      cmd.stdout.on('data', (chunk) => chunks.push(chunk));
      const exitCode = await cmd.wait();
      if (exitCode !== 0) {
        logger?.logEvent('command_failed', { exit_code: exitCode });
        process.exit(exitCode);
      }
      process.stdout.write(Buffer.concat(chunks));
      logger?.logEvent('command_completed', { exit_code: 0 });
      break;
    }
    
    case 'combined': {
      const chunks: Buffer[] = [];
      cmd.stdout.on('data', (chunk) => chunks.push(chunk));
      cmd.stderr.on('data', (chunk) => chunks.push(chunk));
      const exitCode = await cmd.wait();
      if (exitCode !== 0) {
        logger?.logEvent('command_failed', { exit_code: exitCode });
        process.exit(exitCode);
      }
      process.stdout.write(Buffer.concat(chunks));
      logger?.logEvent('command_completed', { exit_code: 0 });
      break;
    }
    
    case 'exit-code': {
      const exitCode = await cmd.wait();
      logger?.logEvent('command_completed', { exit_code: exitCode });
      process.exit(exitCode);
      break;
    }
    
    default: {
      // Stream directly
      cmd.stdout.pipe(process.stdout);
      cmd.stderr.pipe(process.stderr);
      process.stdin.pipe(cmd.stdin);
      const exitCode = await cmd.wait();
      logger?.logEvent('command_completed', { exit_code: exitCode });
      process.exit(exitCode);
    }
  }
}

class Logger {
  private stream: WriteStream;
  
  constructor(path: string) {
    this.stream = createWriteStream(path, { flags: 'a' });
  }
  
  logEvent(type: string, data: any): void {
    const event = {
      timestamp: new Date().toISOString(),
      type,
      data,
    };
    this.stream.write(JSON.stringify(event) + '\n');
  }
}
```

## Test Harness Compatibility

The JavaScript SDK's test-node-cli must be compatible with the existing test harness in `sdks/test/`:

1. **Accept the same command-line arguments** - All flags must work identically
2. **Produce identical output format** - Stdout, stderr, and log files must match
3. **Same exit codes** - Exit with the same codes for success/failure
4. **Same structured logging** - JSON events in log files must match

This allows us to run:
```bash
SDK_TEST_COMMAND=../js/test-node-cli/bin/test-cli make test
```

And all existing tests should pass!

## Package Configuration

### package.json
```json
{
  "name": "@superfly/sprites",
  "version": "0.1.0",
  "description": "JavaScript/TypeScript SDK for Sprites",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "test": "node --test",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["sprites", "exec", "remote", "command"],
  "author": "Fly.io",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.6.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "lib": ["ES2022"],
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test-node-cli"]
}
```

## Implementation Order

1. **Setup repository structure** - package.json, tsconfig.json, directory structure
2. **Implement types** (types.ts) - All TypeScript interfaces and types
3. **Implement Client class** (client.ts) - Authentication, configuration, HTTP calls
4. **Implement WebSocket layer** (websocket.ts) - Core WebSocket protocol handling
5. **Implement Sprite and exec** (sprite.ts, exec.ts) - Command execution with child_process-like API
6. **Implement management API** (management.ts) - Create, list, delete sprites
7. **Implement session management** (session.ts) - Detachable sessions, attach
8. **Create test-node-cli** - CLI tool matching Go test-cli
9. **Test with existing harness** - Verify compatibility with sdks/test/
10. **Documentation** - README with examples

## Key Differences from Go SDK

1. **Event-based streams** - Node.js uses EventEmitter and streams, not channels
2. **Promises instead of errors** - JavaScript uses Promise rejection for async errors
3. **Async/await** - Modern async patterns instead of goroutines
4. **Buffer vs []byte** - Node.js Buffer type for binary data
5. **EventEmitter** - For handling multiple event types (exit, message, error)
6. **Stream API** - Readable/Writable streams instead of io.Reader/Writer

## Modern Node.js Features to Use

1. **Native WebSocket** - No 'ws' package needed in Node 24
2. **Native fetch** - No need for http/https modules or axios
3. **AbortController** - For cancellation and timeouts
4. **AsyncIterator** - For modern streaming patterns
5. **ESM** - Use ES modules, not CommonJS
6. **Node test runner** - Native test framework (`node --test`)

## Success Criteria

1. All existing tests in `sdks/test/` pass with test-node-cli
2. API mirrors Node.js child_process patterns
3. Zero external dependencies (only Node.js stdlib)
4. Full TypeScript type safety
5. Idiomatic modern JavaScript/TypeScript
6. Works on Node.js 24+

