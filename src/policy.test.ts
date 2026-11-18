import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { updateNetworkPolicy } from './policy.js';
import type { NetworkPolicy } from './types.js';

const originalFetch = globalThis.fetch;
const client = { baseURL: 'https://example.test', token: 'token' };
const policy: NetworkPolicy = { rules: [{ domain: '*', action: 'deny' }] };

function respondWith(response: () => Response): void {
  globalThis.fetch = (async () => response()) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('updateNetworkPolicy', () => {
  it('accepts a 204 with no body', async () => {
    respondWith(() => new Response(null, { status: 204 }));

    await updateNetworkPolicy(client, 'demo', policy);
  });

  it('accepts a 200 that returns the stored policy', async () => {
    respondWith(() => Response.json(policy, { status: 200 }));

    await updateNetworkPolicy(client, 'demo', policy);
  });

  it('reports a rejected policy', async () => {
    respondWith(() => new Response('unknown rule', { status: 400 }));

    await assert.rejects(updateNetworkPolicy(client, 'demo', policy), /Invalid policy: unknown rule/);
  });

  it('reports any other failure with its status', async () => {
    respondWith(() => new Response('boom', { status: 500 }));

    await assert.rejects(
      updateNetworkPolicy(client, 'demo', policy),
      /Failed to update network policy \(status 500\): boom/
    );
  });
});
