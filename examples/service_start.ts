// Example: Start Service
// Endpoint: POST /v1/sprites/{name}/services/{service_name}/start

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;
const serviceName = process.env.SERVICE_NAME || 'my-service';

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const stream = await sprite.startService(serviceName);

for await (const event of stream) {
  console.log(JSON.stringify(event));
}
