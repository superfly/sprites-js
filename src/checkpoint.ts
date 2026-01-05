/**
 * Checkpoint and restore streaming handlers
 */

import type { StreamMessage } from './types.js';

/**
 * Stream handler for checkpoint operations
 */
export class CheckpointStream {
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
   * Read the next message from the stream
   * @returns The next message, or null if the stream is complete
   */
  async next(): Promise<StreamMessage | null> {
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
          return JSON.parse(line) as StreamMessage;
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
            return JSON.parse(this.buffer.trim()) as StreamMessage;
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
   * Process all messages in the stream
   * @param handler Function to call for each message
   */
  async processAll(handler: (msg: StreamMessage) => void | Promise<void>): Promise<void> {
    try {
      let msg: StreamMessage | null;
      while ((msg = await this.next()) !== null) {
        await handler(msg);
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
}

/**
 * Stream handler for restore operations
 */
export class RestoreStream {
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
   * Read the next message from the stream
   * @returns The next message, or null if the stream is complete
   */
  async next(): Promise<StreamMessage | null> {
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
          return JSON.parse(line) as StreamMessage;
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
            return JSON.parse(this.buffer.trim()) as StreamMessage;
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
   * Process all messages in the stream
   * @param handler Function to call for each message
   */
  async processAll(handler: (msg: StreamMessage) => void | Promise<void>): Promise<void> {
    try {
      let msg: StreamMessage | null;
      while ((msg = await this.next()) !== null) {
        await handler(msg);
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
}
