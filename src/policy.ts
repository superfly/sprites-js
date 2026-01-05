/**
 * Network policy API handlers
 */

import type { NetworkPolicy } from './types.js';

interface ClientInfo {
  baseURL: string;
  token: string;
}

/**
 * Get the current network policy for a sprite
 */
export async function getNetworkPolicy(
  client: ClientInfo,
  spriteName: string
): Promise<NetworkPolicy> {
  const response = await fetch(
    `${client.baseURL}/v1/sprites/${spriteName}/policy/network`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${client.token}`,
      },
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to get network policy (status ${response.status}): ${body}`
    );
  }

  return (await response.json()) as NetworkPolicy;
}

/**
 * Update the network policy for a sprite
 */
export async function updateNetworkPolicy(
  client: ClientInfo,
  spriteName: string,
  policy: NetworkPolicy
): Promise<void> {
  const response = await fetch(
    `${client.baseURL}/v1/sprites/${spriteName}/policy/network`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(policy),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (response.status === 400) {
    const body = await response.text();
    throw new Error(`Invalid policy: ${body}`);
  }

  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(
      `Failed to update network policy (status ${response.status}): ${body}`
    );
  }
}
