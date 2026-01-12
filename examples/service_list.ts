// Example: List Services
// Endpoint: GET /v1/sprites/{name}/services

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const services = await sprite.listServices();
console.log(JSON.stringify(services, null, 2));
