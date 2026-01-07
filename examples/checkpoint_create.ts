// Example: Create Checkpoint
// Endpoint: POST /v1/sprites/{name}/checkpoint

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const stream = await sprite.createCheckpoint('my-checkpoint');

for await (const msg of stream) {
  console.log(JSON.stringify(msg));
}
