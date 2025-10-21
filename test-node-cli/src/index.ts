#!/usr/bin/env node

/**
 * Test CLI for Sprites JavaScript SDK
 * Matches the interface of the Go test-cli for compatibility with the test harness
 */

import { createWriteStream } from 'node:fs';
import { WriteStream } from 'node:fs';
import { SpritesClient } from '../../dist/index.js';

interface CLIOptions {
  baseUrl: string;
  sprite?: string;
  dir?: string;
  env?: string;
  tty: boolean;
  ttyRows: number;
  ttyCols: number;
  detachable: boolean;
  sessionId?: string;
  timeout: number;
  output: 'stdout' | 'combined' | 'exit-code' | 'default';
  logTarget?: string;
  help: boolean;
}

class Logger {
  private stream?: WriteStream;

  constructor(path?: string) {
    if (path) {
      this.stream = createWriteStream(path, { flags: 'a' });
    }
  }

  logEvent(type: string, data: Record<string, any>): void {
    if (!this.stream) return;

    const event = {
      timestamp: new Date().toISOString(),
      type,
      data,
    };

    this.stream.write(JSON.stringify(event) + '\n');
  }

  close(): void {
    this.stream?.end();
  }
}

function parseArgs(argv: string[]): { options: CLIOptions; args: string[] } {
  const options: CLIOptions = {
    baseUrl: 'https://api.sprites.dev',
    tty: false,
    ttyRows: 24,
    ttyCols: 80,
    detachable: false,
    timeout: 0,
    output: 'default',
    help: false,
  };

  const args: string[] = [];
  let i = 2; // Skip node and script path

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '-base-url') {
      options.baseUrl = argv[++i];
    } else if (arg === '-sprite') {
      options.sprite = argv[++i];
    } else if (arg === '-dir') {
      options.dir = argv[++i];
    } else if (arg === '-env') {
      options.env = argv[++i];
    } else if (arg === '-tty') {
      options.tty = true;
    } else if (arg === '-tty-rows') {
      options.ttyRows = parseInt(argv[++i]);
    } else if (arg === '-tty-cols') {
      options.ttyCols = parseInt(argv[++i]);
    } else if (arg === '-detachable') {
      options.detachable = true;
    } else if (arg === '-session-id') {
      options.sessionId = argv[++i];
    } else if (arg === '-timeout') {
      const timeoutStr = argv[++i];
      // Parse Go duration format (e.g., "10s", "5m")
      const match = timeoutStr.match(/^(\d+)([smh]?)$/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2] || 's';
        const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000 };
        options.timeout = value * multipliers[unit];
      }
    } else if (arg === '-output') {
      options.output = argv[++i] as any;
    } else if (arg === '-log-target') {
      options.logTarget = argv[++i];
    } else if (arg === '-help' || arg === '--help') {
      options.help = true;
    } else if (!arg.startsWith('-')) {
      // Once we hit a non-flag argument, collect it and all remaining args as the command
      args.push(arg);
      i++;
      while (i < argv.length) {
        args.push(argv[i]);
        i++;
      }
      break;
    }

    i++;
  }

  return { options, args };
}

function parseEnv(envStr?: string): Record<string, string> | undefined {
  if (!envStr) return undefined;

  const env: Record<string, string> = {};
  for (const pair of envStr.split(',')) {
    const [key, ...valueParts] = pair.split('=');
    env[key] = valueParts.join('=');
  }
  return env;
}

async function createSprite(client: SpritesClient, name: string, logger: Logger): Promise<void> {
  logger.logEvent('sprite_create_start', {
    sprite_name: name,
  });

  try {
    const sprite = await client.createSprite(name);
    logger.logEvent('sprite_create_completed', {
      sprite_name: sprite.name,
    });
    console.log(`✅ Sprite '${sprite.name}' created successfully`);
  } catch (error) {
    logger.logEvent('sprite_create_failed', {
      sprite_name: name,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`Failed to create sprite: ${error}`);
    process.exit(1);
  }
}

async function destroySprite(client: SpritesClient, name: string, logger: Logger): Promise<void> {
  logger.logEvent('sprite_destroy_start', {
    sprite_name: name,
  });

  try {
    await client.deleteSprite(name);
    logger.logEvent('sprite_destroy_completed', {
      sprite_name: name,
    });
    console.log(`✅ Sprite '${name}' destroyed successfully`);
  } catch (error) {
    logger.logEvent('sprite_destroy_failed', {
      sprite_name: name,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`Failed to destroy sprite: ${error}`);
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`Sprite SDK CLI
==============

A command-line interface for executing commands on sprites using the Sprite SDK.
This tool allows you to test various exec functionality with different options.

Usage:
  test-cli [options] <command> [args...]
  test-cli create <sprite-name>
  test-cli destroy <sprite-name>

Required:
  SPRITES_TOKEN environment variable
        Authentication token (required)
  -sprite string
        Sprite name to execute command on (required for exec commands)

Optional Options:
  -base-url string
        Base URL for the sprite API (default: https://api.sprites.dev)
  -dir string
        Working directory for the command
  -env string
        Environment variables (comma-separated key=value pairs)
  -tty
        Enable TTY mode
  -tty-rows int
        TTY rows/height (default: 24)
  -tty-cols int
        TTY columns/width (default: 80)
  -detachable
        Create detachable tmux session
  -session-id string
        Attach to existing session ID
  -timeout duration
        Command timeout (0 = no timeout)
  -output string
        Output mode: stdout, combined, exit-code (default: stdout)
  -log-target string
        File path to write structured JSON logs
  -help
        Show this help message

Output Modes:
  stdout     - Capture and return stdout only
  combined   - Capture and return combined stdout/stderr
  exit-code  - Run command and exit with its exit code
  (default)  - Stream output directly to terminal`);
}

async function main(): Promise<void> {
  const { options, args } = parseArgs(process.argv);

  if (options.help) {
    showHelp();
    return;
  }

  const token = process.env.SPRITES_TOKEN;
  if (!token) {
    console.error('Error: SPRITES_TOKEN environment variable is required');
    process.exit(1);
  }

  const logger = new Logger(options.logTarget);

  try {
    const client = new SpritesClient(token, { baseURL: options.baseUrl });

    // Handle special commands
    if (args[0] === 'create') {
      if (!args[1]) {
        console.error('Error: sprite name is required for create command');
        process.exit(1);
      }
      await createSprite(client, args[1], logger);
      return;
    }

    if (args[0] === 'destroy') {
      if (!args[1]) {
        console.error('Error: sprite name is required for destroy command');
        process.exit(1);
      }
      await destroySprite(client, args[1], logger);
      return;
    }

    // Exec commands require sprite name
    if (!options.sprite) {
      console.error('Error: -sprite is required for exec commands');
      process.exit(1);
    }

    if (args.length === 0) {
      console.error('Error: command is required');
      process.exit(1);
    }

    const sprite = await client.sprite(options.sprite);

    logger.logEvent('command_start', {
      sprite: options.sprite,
      command: args[0],
      args: args.slice(1),
      base_url: options.baseUrl,
      tty: options.tty,
      detachable: options.detachable,
      session_id: options.sessionId || '',
      timeout: options.timeout.toString(),
      output: options.output,
    });

    // Create command based on mode
    let cmd;
    if (options.sessionId) {
      cmd = sprite.attachSession(options.sessionId);
      logger.logEvent('session_attach', {
        session_id: options.sessionId,
      });
    } else if (options.detachable) {
      cmd = sprite.createSession(args[0], args.slice(1), {
        cwd: options.dir,
        env: parseEnv(options.env),
        rows: options.ttyRows,
        cols: options.ttyCols,
      });
      logger.logEvent('detachable_session_create', {
        command: args[0],
        args: args.slice(1),
      });
    } else {
      cmd = sprite.spawn(args[0], args.slice(1), {
        cwd: options.dir,
        env: parseEnv(options.env),
        tty: options.tty,
        rows: options.ttyRows,
        cols: options.ttyCols,
      });
    }

    // Handle text messages
    cmd.on('message', (data) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        if (msg.type) {
          logger.logEvent('text_message', {
            message_type: msg.type,
            data: msg,
          });
        } else {
          logger.logEvent('text_message', {
            raw_data: typeof data === 'string' ? data : JSON.stringify(data),
          });
        }
      } catch {
        logger.logEvent('text_message', {
          raw_data: typeof data === 'string' ? data : JSON.stringify(data),
        });
      }
    });

    if (options.tty) {
      logger.logEvent('tty_configured', {
        rows: options.ttyRows,
        cols: options.ttyCols,
      });
    }

    // Set up timeout if specified
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (options.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        cmd.kill();
        logger.logEvent('command_timeout', { timeout: options.timeout });
        process.exit(124); // Timeout exit code
      }, options.timeout);
    }

    // Execute based on output mode
    switch (options.output) {
      case 'stdout': {
        const chunks: Buffer[] = [];
        cmd.stdout.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        const exitCode = await cmd.wait();
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (exitCode !== 0) {
          logger.logEvent('command_failed', {
            error: `exit code ${exitCode}`,
            exit_code: exitCode,
          });
          process.exit(exitCode);
        }

        process.stdout.write(Buffer.concat(chunks));
        logger.logEvent('command_completed', {
          exit_code: 0,
          output_length: Buffer.concat(chunks).length,
        });
        break;
      }

      case 'combined': {
        const chunks: Buffer[] = [];
        cmd.stdout.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        cmd.stderr.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        const exitCode = await cmd.wait();
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (exitCode !== 0) {
          logger.logEvent('command_failed', {
            error: `exit code ${exitCode}`,
            exit_code: exitCode,
          });
          process.exit(exitCode);
        }

        process.stdout.write(Buffer.concat(chunks));
        logger.logEvent('command_completed', {
          exit_code: 0,
          output_length: Buffer.concat(chunks).length,
        });
        break;
      }

      case 'exit-code': {
        const exitCode = await cmd.wait();
        if (timeoutHandle) clearTimeout(timeoutHandle);

        logger.logEvent('command_completed', {
          exit_code: exitCode,
        });
        process.exit(exitCode);
        break;
      }

      default: {
        // Stream directly
        cmd.stdout.pipe(process.stdout);
        cmd.stderr.pipe(process.stderr);
        process.stdin.pipe(cmd.stdin);

        const exitCode = await cmd.wait();
        if (timeoutHandle) clearTimeout(timeoutHandle);

        logger.logEvent('command_completed', {
          exit_code: exitCode,
        });
        process.exit(exitCode);
      }
    }
  } catch (error) {
    logger.logEvent('command_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`Command failed: ${error}`);
    process.exit(1);
  } finally {
    logger.close();
  }
}

main();

