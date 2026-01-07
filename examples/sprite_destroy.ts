// Example: Destroy Sprite
// Endpoint: DELETE /v1/sprites/{name}

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);

await client.deleteSprite(spriteName);

console.log(`Sprite '${spriteName}' destroyed`);
