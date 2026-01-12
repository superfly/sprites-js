// Example: Execute Command
// Endpoint: WSS /v1/sprites/{name}/exec

import { SpritesClient } from '../dist/index.js';

const token = process.env.SPRITE_TOKEN!;
const spriteName = process.env.SPRITE_NAME!;

const client = new SpritesClient(token);
const sprite = client.sprite(spriteName);

// Start a command that runs for 30s (TTY sessions stay alive after disconnect)
const cmd = sprite.createSession('python', [
  '-c',
  "import time; print('Server ready on port 8080', flush=True); time.sleep(30)"
]);

cmd.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
});

// Exit after 2 seconds (session keeps running since it's detachable)
setTimeout(() => process.exit(0), 2000);
