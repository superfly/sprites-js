// Example: Execute Command
// Endpoint: WSS /v1/sprites/{name}/exec

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const result = await sprite.exec('echo', ['hello', 'world']);

process.stdout.write(result.stdout);
