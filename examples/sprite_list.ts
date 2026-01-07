// Example: List Sprites
// Endpoint: GET /v1/sprites

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;

const client = new SpritesClient(token);

const sprites = await client.listSprites();

console.log(JSON.stringify(sprites, null, 2));
