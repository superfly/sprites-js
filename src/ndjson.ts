/** Internal reusable reader for newline-delimited JSON responses. */
export class NDJSONStream<T> implements AsyncIterable<T> {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private done = false;

  constructor(response: Response, private readonly map: (data: any) => T = data => data as T) {
    if (!response.body) throw new Error('Response has no body');
    this.reader = response.body.getReader();
  }

  async next(): Promise<T | null> {
    if (this.done) return null;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        try { return this.map(JSON.parse(line)); } catch { continue; }
      }
      const chunk = await this.reader.read();
      if (chunk.done) {
        this.done = true;
        const line = this.buffer.trim();
        this.buffer = '';
        if (!line) return null;
        try { return this.map(JSON.parse(line)); } catch { return null; }
      }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async processAll(handler: (event: T) => void | Promise<void>): Promise<void> {
    try {
      let event: T | null;
      while ((event = await this.next()) !== null) await handler(event);
    } finally {
      this.close();
    }
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.reader.cancel().catch(() => {});
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    try {
      let event: T | null;
      while ((event = await this.next()) !== null) yield event;
    } finally {
      this.close();
    }
  }
}
