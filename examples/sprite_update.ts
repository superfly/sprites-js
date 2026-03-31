// Example: Update Sprite
// Endpoint: PUT /v1/sprites/{name}

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);

await client.updateSprite(spriteName, { urlSettings: { auth: 'public' }, labels: ['prod'] });

console.log('Sprite updated');
