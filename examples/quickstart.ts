// Example: Quick Start
// Endpoint: quickstart

// step: Install
// npm install @fly/sprites

// step: Setup client
import { SpritesClient } from '../dist/index.js';
const client = new SpritesClient(process.env.SPRITE_TOKEN!);

// step: Create a sprite
await client.createSprite(process.env.SPRITE_NAME!);

// step: Run Python
const result = await client.sprite(process.env.SPRITE_NAME!).execFile('python', ['-c', 'print(2+2)']);
process.stdout.write(result.stdout);

// step: Clean up
await client.deleteSprite(process.env.SPRITE_NAME!);
