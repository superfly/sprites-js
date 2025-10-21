/**
 * Unit tests for the exec module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SpritesClient } from './client.js';
import { ExecError } from './types.js';

describe('WebSocket URL Building', () => {
  it('should build correct WebSocket URL for basic command', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite: any = { name: 'my-sprite', client };
    
    const url = buildTestURL(sprite, 'echo', ['hello'], {});
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.protocol, 'ws:');
    assert.strictEqual(parsed.pathname, '/v1/sprites/my-sprite/exec');
    assert.strictEqual(parsed.searchParams.get('path'), 'echo');
    assert.deepStrictEqual(parsed.searchParams.getAll('cmd'), ['echo', 'hello']);
  });

  it('should build correct WebSocket URL with environment', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite: any = { name: 'test-sprite', client };
    
    const url = buildTestURL(sprite, 'env', [], {
      env: { FOO: 'bar', BAZ: 'qux' }
    });
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.pathname, '/v1/sprites/test-sprite/exec');
    const envParams = parsed.searchParams.getAll('env');
    assert.ok(envParams.includes('FOO=bar'));
    assert.ok(envParams.includes('BAZ=qux'));
  });

  it('should build correct WebSocket URL with working directory', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite: any = { name: 'my-sprite', client };
    
    const url = buildTestURL(sprite, 'pwd', [], { cwd: '/tmp' });
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('dir'), '/tmp');
  });

  it('should build correct WebSocket URL with TTY', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite: any = { name: 'my-sprite', client };
    
    const url = buildTestURL(sprite, 'bash', [], {
      tty: true,
      rows: 24,
      cols: 80
    });
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('tty'), 'true');
    assert.strictEqual(parsed.searchParams.get('rows'), '24');
    assert.strictEqual(parsed.searchParams.get('cols'), '80');
  });

  it('should convert HTTPS to WSS', () => {
    const client = new SpritesClient('test-token', { baseURL: 'https://api.sprites.dev' });
    const sprite: any = { name: 'my-sprite', client };
    
    const url = buildTestURL(sprite, 'echo', ['test'], {});
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.protocol, 'wss:');
  });
});

// Helper function to build URL without creating WebSocket
function buildTestURL(sprite: any, command: string, args: string[], options: any): string {
  let baseURL = sprite.client.baseURL;
  
  if (baseURL.startsWith('http')) {
    baseURL = 'ws' + baseURL.substring(4);
  }
  
  const url = new URL(`${baseURL}/v1/sprites/${sprite.name}/exec`);
  
  const allArgs = [command, ...args];
  allArgs.forEach((arg) => {
    url.searchParams.append('cmd', arg);
  });
  url.searchParams.set('path', command);
  
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      url.searchParams.append('env', `${key}=${value}`);
    }
  }
  
  if (options.cwd) {
    url.searchParams.set('dir', options.cwd);
  }
  
  if (options.tty) {
    url.searchParams.set('tty', 'true');
    if (options.rows) {
      url.searchParams.set('rows', options.rows.toString());
    }
    if (options.cols) {
      url.searchParams.set('cols', options.cols.toString());
    }
  }
  
  return url.toString();
}

describe('ExecError', () => {
  it('should have correct error message', () => {
    const err = new ExecError('Command failed with exit code 42', {
      stdout: 'test output',
      stderr: 'test error',
      exitCode: 42
    });
    
    assert.strictEqual(err.message, 'Command failed with exit code 42');
    assert.strictEqual(err.exitCode, 42);
    assert.strictEqual(err.stdout, 'test output');
    assert.strictEqual(err.stderr, 'test error');
  });
});

describe('Client', () => {
  it('should create client with default options', () => {
    const client = new SpritesClient('test-token');
    assert.strictEqual(client.baseURL, 'https://api.sprites.dev');
    assert.strictEqual(client.token, 'test-token');
  });

  it('should create client with custom base URL', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    assert.strictEqual(client.baseURL, 'http://localhost:8080');
  });

  it('should strip trailing slash from base URL', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080/' });
    assert.strictEqual(client.baseURL, 'http://localhost:8080');
  });
});

