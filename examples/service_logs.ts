// Example: Get Service Logs
// Endpoint: GET /v1/sprites/{name}/services/{service_name}/logs

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;
const serviceName = process.env.SERVICE_NAME || 'my-service';

const client = new SpritesClient(token);

// Service logs endpoint - fetch last 100 lines
const response = await fetch(
  `${client.baseURL}/v1/sprites/${spriteName}/services/${serviceName}/logs?lines=100`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Failed to get service logs (status ${response.status}): ${body}`);
}

const logs = await response.text();
console.log(logs);
