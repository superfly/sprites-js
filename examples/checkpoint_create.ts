// Example: Create Checkpoint
// Endpoint: POST /v1/sprites/{name}/checkpoint

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const stream = await sprite.createCheckpoint('my-checkpoint');

try {
  for await (const msg of stream) {
    console.log(JSON.stringify(msg));
  }
} catch (err) {
  // The stream throws if the connection drops before the server sends its
  // terminal 'complete' or 'error' event: the checkpoint's outcome is
  // unknown, so re-check the sprite's checkpoint list before retrying.
  console.error(`Checkpoint outcome unknown: ${err}`);
  process.exit(1);
}
