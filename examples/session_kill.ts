// Example: Kill Session
// Endpoint: POST /v1/sprites/{name}/exec/{session_id}/kill

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

// Find a session to kill
const sessions = await sprite.listSessions();
const targetSession = sessions.find(s =>
  s.command.includes('sleep') || s.command.includes('bash') || s.command.includes('python')
);

if (!targetSession) {
  console.log('No running session found');
  process.exit(0);
}

const response = await fetch(
  `${client.baseURL}/v1/sprites/${spriteName}/exec/${targetSession.id}/kill`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Failed to kill session (status ${response.status}): ${body}`);
}

console.log(`Session ${targetSession.id} killed`);
