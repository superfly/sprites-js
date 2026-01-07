// Example: Get Network Policy
// Endpoint: GET /v1/sprites/{name}/policy/network

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const policy = await sprite.getNetworkPolicy();

console.log(JSON.stringify(policy, null, 2));
