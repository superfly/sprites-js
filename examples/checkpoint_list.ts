// Example: List Checkpoints
// Endpoint: GET /v1/sprites/{name}/checkpoints

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const checkpoints = await sprite.listCheckpoints();

console.log(JSON.stringify(checkpoints, null, 2));
