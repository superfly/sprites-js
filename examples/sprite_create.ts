// Example: Create Sprite
// Endpoint: POST /v1/sprites

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);

await client.createSprite(spriteName);

console.log(`Sprite '${spriteName}' created`);
