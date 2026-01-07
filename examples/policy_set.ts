// Example: Set Network Policy
// Endpoint: POST /v1/sprites/{name}/policy/network

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

await sprite.updateNetworkPolicy({
  rules: [
    { domain: 'api.github.com', action: 'allow' },
    { domain: '*.npmjs.org', action: 'allow' },
  ],
});

console.log('Network policy updated');
