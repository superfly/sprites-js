// Example: Get Service
// Endpoint: GET /v1/sprites/{name}/services/{service_name}

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;
const serviceName = process.env.SERVICE_NAME || 'my-service';

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

const service = await sprite.getService(serviceName);
console.log(JSON.stringify(service, null, 2));
