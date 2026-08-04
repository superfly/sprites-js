/**
 * Network policy API handlers
 */

import { signalHeaders } from './client-signals.js';
import type { NetworkPolicy, PrivilegesPolicy, ResourcesPolicy } from './types.js';

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
    `${client.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/policy/network`,
    {
      method: 'GET',
      headers: {
        ...signalHeaders(),
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
    `${client.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/policy/network`,
    {
      method: 'POST',
      headers: {
        ...signalHeaders(),
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

async function policyRequest<T>(
  client: ClientInfo,
  spriteName: string,
  kind: 'privileges' | 'resources',
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown
): Promise<T> {
  const response = await fetch(
    `${client.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/policy/${kind}`,
    {
      method,
      headers: {
        ...signalHeaders(),
        Authorization: `Bearer ${client.token}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to ${method.toLowerCase()} ${kind} policy (status ${response.status}): ${text}`);
  }
  if (method === 'GET') return response.json() as Promise<T>;
  return undefined as T;
}

export function getPrivilegesPolicy(client: ClientInfo, spriteName: string): Promise<PrivilegesPolicy> {
  return policyRequest(client, spriteName, 'privileges', 'GET');
}

export function updatePrivilegesPolicy(client: ClientInfo, spriteName: string, policy: PrivilegesPolicy): Promise<void> {
  return policyRequest(client, spriteName, 'privileges', 'POST', policy);
}

export function deletePrivilegesPolicy(client: ClientInfo, spriteName: string): Promise<void> {
  return policyRequest(client, spriteName, 'privileges', 'DELETE');
}

export async function getResourcesPolicy(client: ClientInfo, spriteName: string): Promise<ResourcesPolicy> {
  const data = await policyRequest<any>(client, spriteName, 'resources', 'GET');
  return { memory: data.memory ? { limitMB: data.memory.limit_mb, autoscale: data.memory.autoscale } : undefined };
}

export function updateResourcesPolicy(client: ClientInfo, spriteName: string, policy: ResourcesPolicy): Promise<void> {
  return policyRequest(client, spriteName, 'resources', 'POST', {
    ...(policy.memory && { memory: { limit_mb: policy.memory.limitMB, autoscale: policy.memory.autoscale } }),
  });
}

export function deleteResourcesPolicy(client: ClientInfo, spriteName: string): Promise<void> {
  return policyRequest(client, spriteName, 'resources', 'DELETE');
}
