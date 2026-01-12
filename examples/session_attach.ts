// Example: Attach to Session
// Endpoint: WSS /v1/sprites/{name}/exec/{session_id}

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

// Find the session from exec example (look for sleep or bash commands)
const sessions = await sprite.listSessions();
const targetSession = sessions.find(s =>
  s.command.includes('sleep') || s.command.includes('bash') || s.command.includes('python')
);

if (!targetSession) {
  console.log('No running session found');
  process.exit(1);
}

console.log(`Attaching to session ${targetSession.id}...`);

// Attach and read buffered output using spawn with sessionId
const cmd = sprite.spawn('', [], { sessionId: targetSession.id, tty: true });

cmd.on('error', () => {
  // Ignore errors (connection close, etc.)
});

cmd.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
});

// Exit after 2 seconds
setTimeout(() => process.exit(0), 2000);
