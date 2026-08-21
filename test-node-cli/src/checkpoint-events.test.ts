import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { consumeCheckpointEvents } from './checkpoint-events.js';

async function* events(...items: Array<{ type: string; error?: string }>) {
  yield* items;
}

describe('consumeCheckpointEvents', () => {
  it('prints successful streams', async () => {
    const written: string[] = [];
    await consumeCheckpointEvents(
      events({ type: 'info' }, { type: 'complete' }),
      event => written.push(event.type),
    );
    assert.deepEqual(written, ['info', 'complete']);
  });

  it('rejects a terminal error after printing it', async () => {
    const written: string[] = [];
    await assert.rejects(
      consumeCheckpointEvents(
        events({ type: 'info' }, { type: 'error', error: 'rename failed' }),
        event => written.push(event.type),
      ),
      /rename failed/,
    );
    assert.deepEqual(written, ['info', 'error']);
  });

  it('does not treat a mid-stream error as terminal', async () => {
    await consumeCheckpointEvents(
      events({ type: 'error', error: 'advisory' }, { type: 'complete' }),
      () => {},
    );
  });
});
