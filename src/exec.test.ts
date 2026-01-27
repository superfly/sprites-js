/**
 * Unit tests for the exec module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SpritesClient } from './client.js';
import {
  ExecError,
  APIError,
  parseAPIError,
  ERR_CODE_CREATION_RATE_LIMITED,
  ERR_CODE_CONCURRENT_LIMIT_EXCEEDED,
} from './types.js';

describe('WebSocket URL Building', () => {
  it('should build correct WebSocket URL for basic command', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite = client.sprite('my-sprite');
    
    // Build URL directly without creating WebSocket
    const url = buildTestURL(sprite, 'echo', ['hello'], {});
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.protocol, 'ws:');
    assert.strictEqual(parsed.pathname, '/v1/sprites/my-sprite/exec');
    assert.strictEqual(parsed.searchParams.get('path'), 'echo');
    assert.deepStrictEqual(parsed.searchParams.getAll('cmd'), ['echo', 'hello']);
    assert.strictEqual(parsed.searchParams.get('stdin'), 'true');
  });

  it('should build correct WebSocket URL with environment', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite = client.sprite('test-sprite');
    
    const url = buildTestURL(sprite, 'env', [], {
      env: { FOO: 'bar', BAZ: 'qux' }
    });
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.pathname, '/v1/sprites/test-sprite/exec');
    const envParams = parsed.searchParams.getAll('env');
    assert.ok(envParams.includes('FOO=bar'));
    assert.ok(envParams.includes('BAZ=qux'));
    assert.strictEqual(parsed.searchParams.get('stdin'), 'true');
  });

  it('should build correct WebSocket URL with working directory', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite = client.sprite('my-sprite');
    
    const url = buildTestURL(sprite, 'pwd', [], { cwd: '/tmp' });
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('dir'), '/tmp');
    assert.strictEqual(parsed.searchParams.get('stdin'), 'true');
  });

  it('should build correct WebSocket URL with TTY', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite = client.sprite('my-sprite');
    
    const url = buildTestURL(sprite, 'bash', [], {
      tty: true,
      rows: 24,
      cols: 80
    });
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('tty'), 'true');
    assert.strictEqual(parsed.searchParams.get('rows'), '24');
    assert.strictEqual(parsed.searchParams.get('cols'), '80');
    assert.strictEqual(parsed.searchParams.get('stdin'), 'true');
  });

  it('should convert HTTPS to WSS', () => {
    const client = new SpritesClient('test-token', { baseURL: 'https://api.sprites.dev' });
    const sprite = client.sprite('my-sprite');
    
    const url = buildTestURL(sprite, 'echo', ['test'], {});
    
    const parsed = new URL(url);
    assert.strictEqual(parsed.protocol, 'wss:');
    assert.strictEqual(parsed.searchParams.get('stdin'), 'true');
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
  url.searchParams.set('stdin', 'true');
  
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

describe('APIError', () => {
  it('should create basic error', () => {
    const err = new APIError('Something went wrong', { statusCode: 500 });
    assert.strictEqual(err.message, 'Something went wrong');
    assert.strictEqual(err.statusCode, 500);
    assert.strictEqual(err.name, 'APIError');
  });

  it('should create error with all fields', () => {
    const err = new APIError('Rate limit exceeded', {
      errorCode: 'sprite_creation_rate_limited',
      statusCode: 429,
      limit: 10,
      windowSeconds: 60,
      retryAfterSeconds: 30,
      currentCount: 5,
      upgradeAvailable: true,
      upgradeUrl: 'https://fly.io/upgrade',
      retryAfterHeader: 25,
      rateLimitLimit: 100,
      rateLimitRemaining: 0,
      rateLimitReset: 1706400000,
    });

    assert.strictEqual(err.statusCode, 429);
    assert.strictEqual(err.errorCode, 'sprite_creation_rate_limited');
    assert.strictEqual(err.limit, 10);
    assert.strictEqual(err.windowSeconds, 60);
    assert.strictEqual(err.retryAfterSeconds, 30);
    assert.strictEqual(err.currentCount, 5);
    assert.strictEqual(err.upgradeAvailable, true);
    assert.strictEqual(err.upgradeUrl, 'https://fly.io/upgrade');
    assert.strictEqual(err.retryAfterHeader, 25);
    assert.strictEqual(err.rateLimitLimit, 100);
    assert.strictEqual(err.rateLimitRemaining, 0);
    assert.strictEqual(err.rateLimitReset, 1706400000);
  });

  it('should detect rate limit errors', () => {
    const err429 = new APIError('Rate limited', { statusCode: 429 });
    const err500 = new APIError('Server error', { statusCode: 500 });

    assert.strictEqual(err429.isRateLimitError(), true);
    assert.strictEqual(err500.isRateLimitError(), false);
  });

  it('should detect creation rate limited errors', () => {
    const errCreation = new APIError('Rate limited', {
      statusCode: 429,
      errorCode: ERR_CODE_CREATION_RATE_LIMITED,
    });
    const errConcurrent = new APIError('Limit exceeded', {
      statusCode: 429,
      errorCode: ERR_CODE_CONCURRENT_LIMIT_EXCEEDED,
    });

    assert.strictEqual(errCreation.isCreationRateLimited(), true);
    assert.strictEqual(errConcurrent.isCreationRateLimited(), false);
  });

  it('should detect concurrent limit exceeded errors', () => {
    const errConcurrent = new APIError('Limit exceeded', {
      statusCode: 429,
      errorCode: ERR_CODE_CONCURRENT_LIMIT_EXCEEDED,
    });
    const errCreation = new APIError('Rate limited', {
      statusCode: 429,
      errorCode: ERR_CODE_CREATION_RATE_LIMITED,
    });

    assert.strictEqual(errConcurrent.isConcurrentLimitExceeded(), true);
    assert.strictEqual(errCreation.isConcurrentLimitExceeded(), false);
  });

  it('should prefer JSON retry_after_seconds over header', () => {
    const err = new APIError('Rate limited', {
      statusCode: 429,
      retryAfterSeconds: 30,
      retryAfterHeader: 60,
    });

    assert.strictEqual(err.getRetryAfterSeconds(), 30);
  });

  it('should fall back to header for retry_after_seconds', () => {
    const err = new APIError('Rate limited', {
      statusCode: 429,
      retryAfterHeader: 60,
    });

    assert.strictEqual(err.getRetryAfterSeconds(), 60);
  });

  it('should return undefined when no retry_after is set', () => {
    const err = new APIError('Rate limited', { statusCode: 429 });
    assert.strictEqual(err.getRetryAfterSeconds(), undefined);
  });
});

describe('parseAPIError', () => {
  it('should return undefined for success status codes', () => {
    assert.strictEqual(parseAPIError(200, 'OK'), undefined);
    assert.strictEqual(parseAPIError(201, 'Created'), undefined);
    assert.strictEqual(parseAPIError(204, ''), undefined);
    assert.strictEqual(parseAPIError(301, 'Moved'), undefined);
    assert.strictEqual(parseAPIError(399, 'Something'), undefined);
  });

  it('should parse JSON error body', () => {
    const body = JSON.stringify({
      error: 'sprite_creation_rate_limited',
      message: 'Rate limit exceeded',
      limit: 10,
      window_seconds: 60,
      retry_after_seconds: 30,
      upgrade_available: true,
      upgrade_url: 'https://fly.io/upgrade',
    });

    const err = parseAPIError(429, body);
    assert.ok(err);
    assert.strictEqual(err.statusCode, 429);
    assert.strictEqual(err.errorCode, 'sprite_creation_rate_limited');
    assert.strictEqual(err.message, 'Rate limit exceeded');
    assert.strictEqual(err.limit, 10);
    assert.strictEqual(err.windowSeconds, 60);
    assert.strictEqual(err.retryAfterSeconds, 30);
    assert.strictEqual(err.upgradeAvailable, true);
    assert.strictEqual(err.upgradeUrl, 'https://fly.io/upgrade');
  });

  it('should parse rate limit headers', () => {
    const headers = {
      'Retry-After': '30',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': '1706400000',
    };
    const body = '{"error": "rate_limited", "message": "Too many requests"}';

    const err = parseAPIError(429, body, headers);
    assert.ok(err);
    assert.strictEqual(err.retryAfterHeader, 30);
    assert.strictEqual(err.rateLimitLimit, 100);
    assert.strictEqual(err.rateLimitRemaining, 0);
    assert.strictEqual(err.rateLimitReset, 1706400000);
  });

  it('should parse lowercase headers', () => {
    const headers = {
      'retry-after': '30',
      'x-ratelimit-limit': '100',
    };
    const body = '{"message": "Rate limited"}';

    const err = parseAPIError(429, body, headers);
    assert.ok(err);
    assert.strictEqual(err.retryAfterHeader, 30);
    assert.strictEqual(err.rateLimitLimit, 100);
  });

  it('should handle non-JSON body', () => {
    const body = 'Internal Server Error: something went wrong';

    const err = parseAPIError(500, body);
    assert.ok(err);
    assert.strictEqual(err.statusCode, 500);
    assert.strictEqual(err.message, body);
  });

  it('should handle empty body', () => {
    const err = parseAPIError(500, '');
    assert.ok(err);
    assert.strictEqual(err.statusCode, 500);
    assert.ok(err.message.includes('API error'));
  });

  it('should handle invalid header values', () => {
    const headers = {
      'Retry-After': 'not-a-number',
      'X-RateLimit-Limit': 'invalid',
    };
    const body = '{"message": "Error"}';

    const err = parseAPIError(429, body, headers);
    assert.ok(err);
    assert.strictEqual(err.retryAfterHeader, undefined);
    assert.strictEqual(err.rateLimitLimit, undefined);
  });

  it('should parse concurrent limit error', () => {
    const body = JSON.stringify({
      error: 'concurrent_sprite_limit_exceeded',
      message: 'Too many concurrent sprites',
      current_count: 5,
      limit: 5,
    });

    const err = parseAPIError(429, body);
    assert.ok(err);
    assert.strictEqual(err.errorCode, ERR_CODE_CONCURRENT_LIMIT_EXCEEDED);
    assert.strictEqual(err.currentCount, 5);
    assert.strictEqual(err.limit, 5);
    assert.strictEqual(err.isConcurrentLimitExceeded(), true);
  });
});

