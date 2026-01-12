// Example: List Sessions
// Endpoint: GET /v1/sprites/{name}/exec

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const sessions = await sprite.listSessions();
console.log(JSON.stringify(sessions, null, 2));
