// Example: Get Sprite
// Endpoint: GET /v1/sprites/{name}

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);

const sprite = await client.getSprite(spriteName);

console.log(JSON.stringify(sprite, null, 2));
