/**
 * Services API handlers
 */

import type {
  ServiceWithState,
  ServiceRequest,
  ServiceLogEvent,
} from './types.js';

/**
 * Stream handler for service operations (start/stop/create)
 */
export class ServiceLogStream {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private buffer = '';
  private done = false;

  constructor(response: Response) {
    if (!response.body) {
      throw new Error('Response has no body');
    }
    this.reader = response.body.getReader();
  }

  /**
   * Read the next log event from the stream
   * @returns The next event, or null if the stream is complete
   */
  async next(): Promise<ServiceLogEvent | null> {
    if (this.done) {
      return null;
    }

    while (true) {
      // Check if we have a complete line in the buffer
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);

        // Skip empty lines
        if (!line) {
          continue;
        }

        try {
          return JSON.parse(line) as ServiceLogEvent;
        } catch {
          // Skip malformed JSON lines
          continue;
        }
      }

      // Read more data
      if (!this.reader) {
        this.done = true;
        return null;
      }

      const { value, done } = await this.reader.read();
      if (done) {
        this.done = true;
        // Process any remaining buffer content
        if (this.buffer.trim()) {
          try {
            return JSON.parse(this.buffer.trim()) as ServiceLogEvent;
          } catch {
            return null;
          }
        }
        return null;
      }

      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  /**
   * Process all events in the stream
   * @param handler Function to call for each event
   */
  async processAll(
    handler: (event: ServiceLogEvent) => void | Promise<void>
  ): Promise<void> {
    try {
      let event: ServiceLogEvent | null;
      while ((event = await this.next()) !== null) {
        await handler(event);
      }
    } finally {
      this.close();
    }
  }

  /**
   * Close the stream
   */
  close(): void {
    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader = null;
    }
    this.done = true;
  }

  /**
   * Async iterator implementation for for-await-of loops
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<ServiceLogEvent> {
    try {
      let event: ServiceLogEvent | null;
      while ((event = await this.next()) !== null) {
        yield event;
      }
    } finally {
      this.close();
    }
  }
}

interface ClientInfo {
  baseURL: string;
  token: string;
}

/**
 * List all services for a sprite
 */
export async function listServices(
  client: ClientInfo,
  spriteName: string
): Promise<ServiceWithState[]> {
  const response = await fetch(
    `${client.baseURL}/v1/sprites/${spriteName}/services`,
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
      `Failed to list services (status ${response.status}): ${body}`
    );
  }

  return (await response.json()) as ServiceWithState[];
}

/**
 * Get a specific service
 */
export async function getService(
  client: ClientInfo,
  spriteName: string,
  serviceName: string
): Promise<ServiceWithState> {
  const response = await fetch(
    `${client.baseURL}/v1/sprites/${spriteName}/services/${serviceName}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${client.token}`,
      },
      signal: AbortSignal.timeout(30000),
    }
  );

  if (response.status === 404) {
    const body = await response.text();
    throw new Error(`Service not found: ${body}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to get service (status ${response.status}): ${body}`
    );
  }

  return (await response.json()) as ServiceWithState;
}

/**
 * Create or update a service
 * @returns Stream of log events during startup
 */
export async function createService(
  client: ClientInfo,
  spriteName: string,
  serviceName: string,
  config: ServiceRequest,
  duration?: string
): Promise<ServiceLogStream> {
  let url = `${client.baseURL}/v1/sprites/${spriteName}/services/${serviceName}`;
  if (duration) {
    url += `?duration=${duration}`;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${client.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });

  if (response.status === 409) {
    const body = await response.text();
    throw new Error(`Service conflict: ${body}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to create service (status ${response.status}): ${body}`
    );
  }

  return new ServiceLogStream(response);
}

/**
 * Delete a service
 */
export async function deleteService(
  client: ClientInfo,
  spriteName: string,
  serviceName: string
): Promise<void> {
  const response = await fetch(
    `${client.baseURL}/v1/sprites/${spriteName}/services/${serviceName}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${client.token}`,
      },
      signal: AbortSignal.timeout(30000),
    }
  );

  if (response.status === 404) {
    const body = await response.text();
    throw new Error(`Service not found: ${body}`);
  }

  if (response.status === 409) {
    const body = await response.text();
    throw new Error(`Service conflict: ${body}`);
  }

  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(
      `Failed to delete service (status ${response.status}): ${body}`
    );
  }
}

/**
 * Start a service
 * @returns Stream of log events
 */
export async function startService(
  client: ClientInfo,
  spriteName: string,
  serviceName: string,
  duration?: string
): Promise<ServiceLogStream> {
  let url = `${client.baseURL}/v1/sprites/${spriteName}/services/${serviceName}/start`;
  if (duration) {
    url += `?duration=${duration}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${client.token}`,
    },
  });

  if (response.status === 404) {
    const body = await response.text();
    throw new Error(`Service not found: ${body}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to start service (status ${response.status}): ${body}`
    );
  }

  return new ServiceLogStream(response);
}

/**
 * Stop a service
 * @returns Stream of log events
 */
export async function stopService(
  client: ClientInfo,
  spriteName: string,
  serviceName: string,
  timeout?: string
): Promise<ServiceLogStream> {
  let url = `${client.baseURL}/v1/sprites/${spriteName}/services/${serviceName}/stop`;
  if (timeout) {
    url += `?timeout=${timeout}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${client.token}`,
    },
  });

  if (response.status === 404) {
    const body = await response.text();
    throw new Error(`Service not found: ${body}`);
  }

  if (response.status === 409) {
    const body = await response.text();
    throw new Error(`Service not running: ${body}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to stop service (status ${response.status}): ${body}`
    );
  }

  return new ServiceLogStream(response);
}

/**
 * Send a signal to a service
 */
export async function signalService(
  client: ClientInfo,
  spriteName: string,
  serviceName: string,
  signal: string
): Promise<void> {
  const response = await fetch(
    `${client.baseURL}/v1/sprites/${spriteName}/services/signal`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: serviceName, signal }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (response.status === 404) {
    const body = await response.text();
    throw new Error(`Service not found: ${body}`);
  }

  if (response.status === 409) {
    const body = await response.text();
    throw new Error(`Service not running: ${body}`);
  }

  if (response.status === 400) {
    const body = await response.text();
    throw new Error(`Invalid signal: ${body}`);
  }

  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(
      `Failed to signal service (status ${response.status}): ${body}`
    );
  }
}
