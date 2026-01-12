// Example: Create Service
// Endpoint: PUT /v1/sprites/{name}/services/{service_name}

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;
const serviceName = process.env.SERVICE_NAME || 'my-service';

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const stream = await sprite.createService(serviceName, {
  cmd: 'python',
  args: ['-m', 'http.server', '8000'],
  http_port: 8000,
});

for await (const event of stream) {
  console.log(JSON.stringify(event));
}
