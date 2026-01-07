// Example: Get Checkpoint
// Endpoint: GET /v1/sprites/{name}/checkpoints/{checkpoint_id}

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;
const checkpointId = process.env.CHECKPOINT_ID || 'v1';

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const checkpoint = await sprite.getCheckpoint(checkpointId);

console.log(JSON.stringify(checkpoint, null, 2));
