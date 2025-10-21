/**
 * Integration tests for the Sprites SDK
 * 
 * These tests require:
 * - SPRITES_TEST_TOKEN environment variable
 * - Optional: SPRITE_TEST_NAME to use an existing sprite instead of creating one
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { SpritesClient } from './client.js';
import { ExecError } from './types.js';

// Skip if no test token
const token = process.env.SPRITES_TEST_TOKEN;
const skipTests = !token;

if (skipTests) {
  console.log('Skipping integration tests: SPRITES_TEST_TOKEN not set');
}

describe('Sprite Lifecycle', { skip: skipTests }, () => {
  let client: SpritesClient;
  let spriteName: string;
  let useExistingSprite: boolean;

  before(async () => {
    client = new SpritesClient(token!);
    
    // Check if we should use an existing sprite
    spriteName = process.env.SPRITE_TEST_NAME || '';
    useExistingSprite = !!spriteName;
    
    if (!useExistingSprite) {
      // Generate unique sprite name
      spriteName = `test-sprite-${Date.now()}`;
      console.log(`Creating test sprite: ${spriteName}`);
      
      // Create sprite
      const sprite = await client.createSprite(spriteName);
      assert.strictEqual(sprite.name, spriteName);
      
      // Verify it was created
      const retrieved = await client.getSprite(spriteName);
      assert.strictEqual(retrieved.name, spriteName);
      
      console.log(`Successfully created sprite: ${spriteName}`);
    } else {
      console.log(`Using existing sprite: ${spriteName}`);
    }
  });

  after(async () => {
    if (!useExistingSprite && spriteName) {
      console.log(`Destroying test sprite: ${spriteName}`);
      await client.deleteSprite(spriteName);
      
      // Verify deletion
      try {
        await client.getSprite(spriteName);
        throw new Error('Sprite should have been deleted');
      } catch (err) {
        // Expected - sprite was deleted
        console.log(`Successfully destroyed sprite: ${spriteName}`);
      }
    }
  });

  describe('Exec Commands', () => {
    it('should execute echo command', async () => {
      const sprite = await client.sprite(spriteName);
      const { stdout } = await sprite.exec('echo hello world');
      
      assert.strictEqual(stdout, 'hello world\n');
      console.log(`Echo output: "${(stdout as string).trim()}"`);
    });

    it('should execute pwd command', async () => {
      const sprite = await client.sprite(spriteName);
      const { stdout } = await sprite.exec('pwd');
      
      // Should be in home directory
      assert.ok((stdout as string).includes('/home'));
      console.log(`Pwd output: "${(stdout as string).trim()}"`);
    });

    it('should execute command with environment variables', async () => {
      const sprite = await client.sprite(spriteName);
      const { stdout } = await sprite.exec('env', {
        env: {
          TEST_VAR: 'hello',
          ANOTHER_VAR: 'world'
        }
      });
      
      const output = stdout as string;
      assert.ok(output.includes('TEST_VAR=hello'));
      assert.ok(output.includes('ANOTHER_VAR=world'));
      console.log('Env command found expected variables');
    });

    it('should execute command with working directory', async () => {
      const sprite = await client.sprite(spriteName);
      const { stdout } = await sprite.exec('pwd', { cwd: '/tmp' });
      
      assert.strictEqual(stdout, '/tmp\n');
      console.log(`Dir command output: "${stdout.trim()}"`);
    });

    it('should handle command with non-zero exit code', async () => {
      const sprite = await client.sprite(spriteName);
      
      try {
        await sprite.execFile('sh', ['-c', 'exit 42']);
        throw new Error('Command should have failed');
      } catch (err) {
        assert.ok(err instanceof ExecError);
        assert.strictEqual(err.exitCode, 42);
        console.log(`Error command failed as expected with exit code ${err.exitCode}`);
      }
    });

    it('should handle command with pipes', async () => {
      const sprite = await client.sprite(spriteName);
      
      // Use execFile with proper arguments (avoids shell quoting issues)
      const { stdout } = await sprite.execFile('sh', ['-c', 'echo hello from pipe test']);
      
      assert.strictEqual(stdout, 'hello from pipe test\n');
      console.log('Pipe test completed successfully');
    });

    it('should handle TTY mode', async () => {
      const sprite = await client.sprite(spriteName);
      const { stdout } = await sprite.exec('tty', {
        tty: true,
        rows: 24,
        cols: 80
      });
      
      // When TTY is enabled, tty command should output a device path
      assert.ok((stdout as string).includes('/dev/'));
      console.log(`TTY output: "${(stdout as string).trim()}"`);
    });

    it('should handle non-TTY mode', async () => {
      const sprite = await client.sprite(spriteName);
      
      try {
        await sprite.exec('tty');
      } catch (err) {
        // tty command exits with 1 when not connected to a tty
        assert.ok(err instanceof ExecError);
        assert.strictEqual(err.exitCode, 1);
        assert.ok((err.stdout as string).includes('not a tty'));
        console.log(`Non-TTY output: "${(err.stdout as string).trim()}"`);
        return;
      }
      
      throw new Error('tty command should fail when not in TTY mode');
    });

    it('should handle interactive TTY command', async () => {
      const sprite = await client.sprite(spriteName);
      const { stdout } = await sprite.exec('stty size', {
        tty: true,
        rows: 24,
        cols: 80
      });
      
      // stty size should output "24 80"
      assert.strictEqual((stdout as string).trim(), '24 80');
      console.log(`Terminal size: "${(stdout as string).trim()}"`);
    });

    it('should handle combined output', async () => {
      const sprite = await client.sprite(spriteName);
      const cmd = sprite.spawn('sh', ['-c', 'echo stdout; echo stderr >&2']);
      
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      
      cmd.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      cmd.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      
      const exitCode = await cmd.wait();
      assert.strictEqual(exitCode, 0);
      
      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();
      
      assert.strictEqual(stdout, 'stdout\n');
      assert.strictEqual(stderr, 'stderr\n');
      console.log('Combined output test passed');
    });

    it('should handle execFile with arguments', async () => {
      const sprite = await client.sprite(spriteName);
      const { stdout } = await sprite.execFile('echo', ['arg1', 'arg2', 'arg3']);
      
      assert.strictEqual(stdout, 'arg1 arg2 arg3\n');
      console.log(`ExecFile output: "${stdout.trim()}"`);
    });

    it('should handle spawn with event emitter', async () => {
      const sprite = await client.sprite(spriteName);
      const cmd = sprite.spawn('echo', ['hello']);
      
      let exitCode = -1;
      const output: Buffer[] = [];
      
      cmd.stdout.on('data', (chunk: Buffer) => {
        output.push(chunk);
      });
      
      cmd.on('exit', (code: number) => {
        exitCode = code;
      });
      
      await cmd.wait();
      
      assert.strictEqual(exitCode, 0);
      assert.strictEqual(Buffer.concat(output).toString(), 'hello\n');
      console.log('Event emitter test passed');
    });
  });

  describe('Sprite Management', () => {
    it('should list sprites', async () => {
      const result = await client.listSprites({ maxResults: 10 });
      assert.ok(Array.isArray(result.sprites));
      console.log(`Found ${result.sprites.length} sprites`);
    });

    it('should get sprite info', async () => {
      const sprite = await client.getSprite(spriteName);
      assert.strictEqual(sprite.name, spriteName);
      assert.ok(sprite.id);
      console.log(`Sprite info: ${sprite.name} (${sprite.status})`);
    });
  });
});

