/**
 * Tests for checkpoint/restore stream truncation detection
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CheckpointStream, RestoreStream } from './checkpoint.js';
import type { StreamMessage } from './types.js';

function responseFromLines(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

for (const [name, Ctor] of [
  ['CheckpointStream', CheckpointStream],
  ['RestoreStream', RestoreStream],
] as const) {
  describe(name, () => {
    test('yields all messages when stream ends with complete event', async () => {
      const stream = new Ctor(
        responseFromLines([
          JSON.stringify({ type: 'info', data: 'starting' }),
          JSON.stringify({ type: 'complete', data: 'done' }),
        ])
      );
      const messages: StreamMessage[] = [];
      await stream.processAll((msg) => {
        messages.push(msg);
      });
      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[1].type, 'complete');
    });

    test('accepts an error event as a terminal event', async () => {
      const stream = new Ctor(
        responseFromLines([
          JSON.stringify({ type: 'info', data: 'starting' }),
          JSON.stringify({ type: 'error', error: 'restore failed' }),
        ])
      );
      const messages: StreamMessage[] = [];
      await stream.processAll((msg) => {
        messages.push(msg);
      });
      assert.strictEqual(messages[1].type, 'error');
    });

    test('throws when the stream ends without a terminal event', async () => {
      const stream = new Ctor(
        responseFromLines([
          JSON.stringify({ type: 'info', data: 'starting' }),
          JSON.stringify({ type: 'info', data: 'still going' }),
        ])
      );
      await assert.rejects(
        stream.processAll(() => {}),
        /without a terminal/
      );
    });

    test('throws when the stream ends with no messages at all', async () => {
      const stream = new Ctor(responseFromLines([]));
      await assert.rejects(
        stream.processAll(() => {}),
        /without a terminal/
      );
    });

    test('handles a terminal event without a trailing newline', async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: 'complete', data: 'done' }))
          );
          controller.close();
        },
      });
      const stream = new Ctor(new Response(body));
      const messages: StreamMessage[] = [];
      await stream.processAll((msg) => {
        messages.push(msg);
      });
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].type, 'complete');
    });

    test('for-await iteration surfaces truncation', async () => {
      const stream = new Ctor(
        responseFromLines([JSON.stringify({ type: 'info', data: 'starting' })])
      );
      await assert.rejects(async () => {
        for await (const _msg of stream) {
          void _msg;
        }
      }, /without a terminal/);
    });

    test('close() before EOF does not throw on later next()', async () => {
      const stream = new Ctor(
        responseFromLines([JSON.stringify({ type: 'info', data: 'starting' })])
      );
      const first = await stream.next();
      assert.strictEqual(first?.type, 'info');
      stream.close();
      assert.strictEqual(await stream.next(), null);
    });
  });
}
