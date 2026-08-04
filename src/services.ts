/**
 * Services API handlers
 */

import { authHeaders } from './client-signals.js';
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
          return this.parseEvent(line);
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
            return this.parseEvent(this.buffer.trim());
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

  private parseEvent(line: string): ServiceLogEvent {
    const data = JSON.parse(line);
    return {
      type: data.type,
      data: data.data,
      exitCode: data.exit_code,
      timestamp: data.timestamp,
      logFiles: data.log_files,
    };
  }
}

interface ClientInfo {
  baseURL: string;
  token: string;
}

function servicesURL(client: ClientInfo, spriteName: string, suffix = ''): string {
  return `${client.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/services${suffix}`;
}

function serviceFromAPI(data: any): ServiceWithState {
  return {
    name: data.name,
    cmd: data.cmd,
    args: data.args ?? [],
    env: data.env,
    dir: data.dir,
    needs: data.needs ?? [],
    httpPort: data.http_port,
    state: data.state ? {
      name: data.state.name,
      status: data.state.status,
      pid: data.state.pid,
      startedAt: data.state.started_at,
      error: data.state.error,
      restartCount: data.state.restart_count,
      nextRestartAt: data.state.next_restart_at,
    } : undefined,
  };
}

function serviceRequestToAPI(config: ServiceRequest): Record<string, unknown> {
  return {
    cmd: config.cmd,
    ...(config.args !== undefined && { args: config.args }),
    ...(config.env !== undefined && { env: config.env }),
    ...(config.dir !== undefined && { dir: config.dir }),
    ...(config.needs !== undefined && { needs: config.needs }),
    ...(config.httpPort !== undefined && { http_port: config.httpPort }),
  };
}

/**
 * List all services for a sprite
 */
export async function listServices(
  client: ClientInfo,
  spriteName: string
): Promise<ServiceWithState[]> {
  const response = await fetch(
    servicesURL(client, spriteName),
    {
      method: 'GET',
      headers: authHeaders(client.token),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to list services (status ${response.status}): ${body}`
    );
  }

  const data = await response.json() as any;
  const services = Array.isArray(data) ? data : data.services ?? [];
  return services.map(serviceFromAPI);
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
    servicesURL(client, spriteName, `/${encodeURIComponent(serviceName)}`),
    {
      method: 'GET',
      headers: authHeaders(client.token),
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

  return serviceFromAPI(await response.json());
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
  let url = servicesURL(client, spriteName, `/${encodeURIComponent(serviceName)}`);
  if (duration) {
    url += `?duration=${duration}`;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: authHeaders(client.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(serviceRequestToAPI(config)),
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
    servicesURL(client, spriteName, `/${encodeURIComponent(serviceName)}`),
    {
      method: 'DELETE',
      headers: authHeaders(client.token),
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
  let url = servicesURL(client, spriteName, `/${encodeURIComponent(serviceName)}/start`);
  if (duration) {
    url += `?duration=${duration}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(client.token),
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
  let url = servicesURL(client, spriteName, `/${encodeURIComponent(serviceName)}/stop`);
  if (timeout) {
    url += `?timeout=${timeout}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(client.token),
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

/** Restart a service and stream stop/start progress. */
export async function restartService(
  client: ClientInfo,
  spriteName: string,
  serviceName: string,
  duration?: string
): Promise<ServiceLogStream> {
  const url = new URL(servicesURL(client, spriteName, `/${encodeURIComponent(serviceName)}/restart`));
  if (duration) url.searchParams.set('duration', duration);
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(client.token),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to restart service (status ${response.status}): ${body}`);
  }
  return new ServiceLogStream(response);
}

/** Read buffered service logs and optionally follow new output. */
export async function getServiceLogs(
  client: ClientInfo,
  spriteName: string,
  serviceName: string,
  options: { lines?: number; duration?: string } = {}
): Promise<ServiceLogStream> {
  const url = new URL(servicesURL(client, spriteName, `/${encodeURIComponent(serviceName)}/logs`));
  if (options.lines !== undefined) url.searchParams.set('lines', options.lines.toString());
  if (options.duration) url.searchParams.set('duration', options.duration);
  const response = await fetch(url, {
    method: 'GET',
    headers: authHeaders(client.token),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to get service logs (status ${response.status}): ${body}`);
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
    servicesURL(client, spriteName, '/signal'),
    {
      method: 'POST',
      headers: authHeaders(client.token, { 'Content-Type': 'application/json' }),
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
