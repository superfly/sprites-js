import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resetCachedForTest } from '@fly/client-signals';
import { authHeaders, resetSignalHeadersForTest, signalHeaders } from './client-signals.js';

const originalSignalsSetting = process.env.SPRITES_CLIENT_SIGNALS;
const originalInvokedBy = process.env.FLY_INVOKED_BY;

afterEach(() => {
  if (originalSignalsSetting === undefined) {
    delete process.env.SPRITES_CLIENT_SIGNALS;
  } else {
    process.env.SPRITES_CLIENT_SIGNALS = originalSignalsSetting;
  }
  if (originalInvokedBy === undefined) {
    delete process.env.FLY_INVOKED_BY;
  } else {
    process.env.FLY_INVOKED_BY = originalInvokedBy;
  }
  resetCachedForTest();
  resetSignalHeadersForTest();
});

describe('client signals', () => {
  it('adds Fly attribution headers and a signals-aware user agent', () => {
    delete process.env.SPRITES_CLIENT_SIGNALS;
    process.env.FLY_INVOKED_BY = 'sdk-test';
    resetCachedForTest();
    resetSignalHeadersForTest();

    const headers = signalHeaders();
    assert.equal(headers['Fly-Client-Agent'], 'sdk-test');
    assert.equal(headers['Fly-Client-Agent-Source'], 'env:FLY_INVOKED_BY');
    assert.match(headers['Fly-Client-Interactive'], /^(true|false)$/);
    assert.match(headers['Fly-Client-Parent'], /^(node|python|shell|other)$/);
    assert.match(headers['User-Agent'], /^sprites-js\/[^ ]+ \(.+agent=sdk-test\)$/);
  });

  it('computes signals once and returns a fresh header object', () => {
    process.env.FLY_INVOKED_BY = 'first-agent';
    resetCachedForTest();
    resetSignalHeadersForTest();

    const first = signalHeaders();
    process.env.FLY_INVOKED_BY = 'second-agent';
    first['Fly-Client-Agent'] = 'mutated';

    assert.equal(signalHeaders()['Fly-Client-Agent'], 'first-agent');
  });

  for (const setting of ['0', 'off', 'false', 'no', 'disabled']) {
    it(`supports the ${setting} opt-out value`, () => {
      process.env.SPRITES_CLIENT_SIGNALS = setting;
      process.env.FLY_INVOKED_BY = 'should-not-appear';
      resetCachedForTest();
      resetSignalHeadersForTest();

      const headers = signalHeaders();
      assert.deepEqual(Object.keys(headers), ['User-Agent']);
      assert.match(headers['User-Agent'], /^sprites-js\/[^ ]+$/);
    });
  }
});

describe('authHeaders', () => {
  it('combines signals, bearer auth, and request-specific extras', () => {
    delete process.env.SPRITES_CLIENT_SIGNALS;
    resetCachedForTest();
    resetSignalHeadersForTest();

    const headers = authHeaders('secret', { 'Content-Type': 'application/json' });
    assert.equal(headers.Authorization, 'Bearer secret');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.match(headers['User-Agent'], /^sprites-js\//);
    assert.match(headers['Fly-Client-Interactive'], /^(true|false)$/);
    assert.match(headers['Fly-Client-Parent'], /^(node|python|shell|other)$/);
  });

  it('still authenticates when signals are disabled', () => {
    process.env.SPRITES_CLIENT_SIGNALS = '0';
    resetCachedForTest();
    resetSignalHeadersForTest();

    const headers = authHeaders('secret');
    assert.equal(headers.Authorization, 'Bearer secret');
    assert.deepEqual(Object.keys(headers).sort(), ['Authorization', 'User-Agent']);
  });
});
