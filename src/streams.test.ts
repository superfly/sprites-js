import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CheckpointStream, RestoreStream } from './checkpoint.js';
import { ServiceLogStream } from './services.js';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

describe('checkpoint and restore streams', () => {
  for (const [name, Stream] of [['CheckpointStream', CheckpointStream], ['RestoreStream', RestoreStream]] as const) {
    it(`${name} reads chunked NDJSON, skips malformed lines, and iterates`, async () => {
      const stream = new Stream(streamResponse(['bad\n{"type":"info",', '"data":"one"}\n\n{"type":"error","error":"two"}']));
      assert.deepEqual(await stream.next(), { type: 'info', data: 'one' });
      const rest = [];
      for await (const message of stream) rest.push(message);
      assert.deepEqual(rest, [{ type: 'error', error: 'two' }]);
      assert.equal(await stream.next(), null);
    });

    it(`${name} processes all messages and can be closed`, async () => {
      const stream = new Stream(streamResponse(['{"type":"info","data":"one"}\n{"type":"complete","data":"two"}\n']));
      const messages: string[] = [];
      await stream.processAll(message => { messages.push(message.data!); });
      assert.deepEqual(messages, ['one', 'two']);
      stream.close();
      assert.equal(await stream.next(), null);
    });

    it(`${name} rejects responses without a body`, () => {
      assert.throws(() => new Stream(new Response(null)), /Response has no body/);
    });

    it(`${name} accepts a terminal event without a trailing newline`, async () => {
      const stream = new Stream(streamResponse(['{"type":"info","data":"one"}\n{"type":"complete","data":"done"}']));
      const messages: string[] = [];
      await stream.processAll(message => { messages.push(message.type); });
      assert.deepEqual(messages, ['info', 'complete']);
    });

    it(`${name} throws when the stream ends without a terminal event`, async () => {
      const stream = new Stream(streamResponse(['{"type":"info","data":"one"}\n{"type":"info","data":"two"}\n']));
      await assert.rejects(stream.processAll(() => {}), /without a terminal/);
    });

    it(`${name} throws when an empty stream ends`, async () => {
      const stream = new Stream(streamResponse([]));
      await assert.rejects(stream.processAll(() => {}), /without a terminal/);
    });

    it(`${name} throws when the stream ends with a malformed tail`, async () => {
      const stream = new Stream(streamResponse(['{"type":"info","data":"one"}\n{"type":"comp']));
      await assert.rejects(stream.processAll(() => {}), /without a terminal/);
    });

    it(`${name} surfaces truncation through async iteration`, async () => {
      const stream = new Stream(streamResponse(['{"type":"info","data":"one"}\n']));
      await assert.rejects(async () => {
        for await (const message of stream) void message;
      }, /without a terminal/);
    });

    it(`${name} does not treat a mid-stream error event as terminal`, async () => {
      const stream = new Stream(streamResponse(['{"type":"error","error":"advisory"}\n{"type":"info","data":"still going"}\n']));
      await assert.rejects(stream.processAll(() => {}), /without a terminal/);
    });

    it(`${name} throws the truncation error only once, then returns null`, async () => {
      const stream = new Stream(streamResponse(['{"type":"info","data":"one"}\n']));
      assert.equal((await stream.next())?.type, 'info');
      await assert.rejects(stream.next(), /without a terminal/);
      assert.equal(await stream.next(), null);
    });

    it(`${name} does not throw after close() between reads`, async () => {
      const stream = new Stream(streamResponse(['{"type":"info","data":"one"}\n']));
      assert.equal((await stream.next())?.type, 'info');
      stream.close();
      assert.equal(await stream.next(), null);
    });

    it(`${name} does not throw when close() cancels a pending next()`, async () => {
      const stream = new Stream(new Response(new ReadableStream({ start() {} })));
      const pending = stream.next();
      stream.close();
      assert.equal(await pending, null);
    });
  }
});

describe('ServiceLogStream', () => {
  it('maps snake_case events through next, processAll, and async iteration', async () => {
    const stream = new ServiceLogStream(streamResponse([
      'malformed\n{"type":"stdout","data":"one","timestamp":1}\n',
      '{"type":"exit","exit_code":3,"timestamp":2,"log_files":{"stderr":"err.log"}}',
    ]));
    assert.equal((await stream.next())?.data, 'one');
    const events = [];
    for await (const event of stream) events.push(event);
    assert.equal(events[0].exitCode, 3);
    assert.deepEqual(events[0].logFiles, { stderr: 'err.log' });

    const processed: string[] = [];
    const second = new ServiceLogStream(streamResponse(['{"type":"stopped","timestamp":3}\n']));
    await second.processAll(event => { processed.push(event.type); });
    assert.deepEqual(processed, ['stopped']);
    second.close();
  });

  it('rejects responses without a body', () => {
    assert.throws(() => new ServiceLogStream(new Response(null)), /Response has no body/);
  });
});
