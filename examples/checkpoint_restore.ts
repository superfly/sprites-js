// Example: Restore Checkpoint
// Endpoint: POST /v1/sprites/{name}/checkpoints/{checkpoint_id}/restore

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;
const checkpointId = process.env.CHECKPOINT_ID || 'v1';

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const stream = await sprite.restoreCheckpoint(checkpointId);

try {
  for await (const msg of stream) {
    console.log(JSON.stringify(msg));
  }
} catch (err) {
  // The stream throws if the connection drops before the server sends its
  // terminal 'complete' or 'error' event: the restore's outcome is unknown,
  // so check the sprite's state before assuming the restore finished.
  console.error(`Restore outcome unknown: ${err}`);
  process.exit(1);
}
