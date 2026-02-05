/**
 * Unit tests for the control connection module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SpritesClient } from './client.js';

describe('Control Mode Client Options', () => {
  it('should have controlMode true by default for efficient connection reuse', () => {
    const client = new SpritesClient('test-token');
    assert.strictEqual(client.controlMode, true);
  });

  it('should enable controlMode when explicitly specified', () => {
    const client = new SpritesClient('test-token', { controlMode: true });
    assert.strictEqual(client.controlMode, true);
  });

  it('should disable controlMode when explicitly set to false', () => {
    const client = new SpritesClient('test-token', { controlMode: false });
    assert.strictEqual(client.controlMode, false);
  });
});

describe('Sprite Control Mode', () => {
  it('should reflect client controlMode setting when enabled', () => {
    const client = new SpritesClient('test-token', { controlMode: true });
    const sprite = client.sprite('test-sprite');
    assert.strictEqual(sprite.useControlMode(), true);
  });

  it('should reflect client controlMode setting when disabled', () => {
    const client = new SpritesClient('test-token', { controlMode: false });
    const sprite = client.sprite('test-sprite');
    assert.strictEqual(sprite.useControlMode(), false);
  });

  it('should return true when controlMode is not specified (enabled by default)', () => {
    const client = new SpritesClient('test-token');
    const sprite = client.sprite('test-sprite');
    assert.strictEqual(sprite.useControlMode(), true);
  });
});

describe('Control URL Building', () => {
  it('should build correct control endpoint URL', () => {
    const client = new SpritesClient('test-token', { baseURL: 'http://localhost:8080' });
    const sprite = client.sprite('my-sprite');

    // Build expected URL
    const expectedURL = 'ws://localhost:8080/v1/sprites/my-sprite/control';

    // Build actual URL (simulating what ControlConnection does)
    let baseURL = sprite.client.baseURL;
    if (baseURL.startsWith('http')) {
      baseURL = 'ws' + baseURL.substring(4);
    }
    const actualURL = `${baseURL}/v1/sprites/${sprite.name}/control`;

    assert.strictEqual(actualURL, expectedURL);
  });

  it('should convert HTTPS to WSS for control endpoint', () => {
    const client = new SpritesClient('test-token', { baseURL: 'https://api.sprites.dev' });
    const sprite = client.sprite('my-sprite');

    let baseURL = sprite.client.baseURL;
    if (baseURL.startsWith('http')) {
      baseURL = 'ws' + baseURL.substring(4);
    }
    const actualURL = `${baseURL}/v1/sprites/${sprite.name}/control`;

    assert.ok(actualURL.startsWith('wss://'));
  });
});
