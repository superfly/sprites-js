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

async function handlePolicyCommand(
  client: SpritesClient,
  spriteName: string,
  args: string[],
  logger: Logger
): Promise<void> {
  if (args.length === 0) {
    console.error('Error: policy subcommand required (get, set)');
    process.exit(1);
  }

  const sprite = client.sprite(spriteName);
  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'get': {
        const policy = await sprite.getNetworkPolicy();
        console.log(JSON.stringify(policy, null, 2));
        break;
      }
      case 'set': {
        if (!args[1]) {
          console.error('Error: policy JSON required');
          process.exit(1);
        }
        const policy = JSON.parse(args[1]);
        await sprite.updateNetworkPolicy(policy);
        console.log(JSON.stringify({ status: 'updated' }));
        break;
      }
      default:
        console.error(`Error: unknown policy subcommand: ${subcommand}`);
        process.exit(1);
    }
  } catch (error) {
    logger.logEvent('policy_command_failed', {
      subcommand,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`Policy command failed: ${error}`);
    process.exit(1);
  }
}

async function handleCheckpointCommand(
  client: SpritesClient,
  spriteName: string,
  args: string[],
  logger: Logger
): Promise<void> {
  if (args.length === 0) {
    console.error('Error: checkpoint subcommand required (list, get, create, restore)');
    process.exit(1);
  }

  const sprite = client.sprite(spriteName);
  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'list': {
        const checkpoints = await sprite.listCheckpoints();
        console.log(JSON.stringify(checkpoints, null, 2));
        break;
      }
      case 'get': {
        if (!args[1]) {
          console.error('Error: checkpoint ID required');
          process.exit(1);
        }
        const checkpoint = await sprite.getCheckpoint(args[1]);
        console.log(JSON.stringify(checkpoint, null, 2));
        break;
      }
      case 'create': {
        if (!args[1]) {
          console.error('Error: checkpoint name required');
          process.exit(1);
        }
        const stream = await sprite.createCheckpoint(args[1]);
        for await (const event of stream) {
          console.log(JSON.stringify(event));
        }
        break;
      }
      case 'restore': {
        if (!args[1]) {
          console.error('Error: checkpoint ID required');
          process.exit(1);
        }
        const stream = await sprite.restoreCheckpoint(args[1]);
        for await (const event of stream) {
          console.log(JSON.stringify(event));
        }
        break;
      }
      default:
        console.error(`Error: unknown checkpoint subcommand: ${subcommand}`);
        process.exit(1);
    }
  } catch (error) {
    logger.logEvent('checkpoint_command_failed', {
      subcommand,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`Checkpoint command failed: ${error}`);
    process.exit(1);
  }
}

async function handleFilesystemCommand(
  client: SpritesClient,
  spriteName: string,
  args: string[],
  options: CLIOptions,
  logger: Logger
): Promise<void> {
  if (args.length === 0) {
    console.error('Error: filesystem subcommand required');
    process.exit(1);
  }

  const sprite = client.sprite(spriteName);
  const fs = sprite.filesystem(options.dir || '/');
  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'read': {
        if (!args[1]) {
          console.error('Error: path required');
          process.exit(1);
        }
        const content = await fs.readFile(args[1], 'utf8');
        process.stdout.write(content);
        break;
      }

      case 'write': {
        if (!args[1]) {
          console.error('Error: path required');
          process.exit(1);
        }
        // Read data from stdin or use provided content
        let data: string;
        if (args[2]) {
          data = args[2];
        } else {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          data = Buffer.concat(chunks).toString('utf8');
        }
        await fs.writeFile(args[1], data);
        console.log(JSON.stringify({ status: 'written', path: args[1] }));
        break;
      }

      case 'list': {
        const path = args[1] || '.';
        const entries = await fs.readdir(path, { withFileTypes: true });
        const result = entries.map((entry: any) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymbolicLink: entry.isSymbolicLink(),
        }));
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'stat': {
        if (!args[1]) {
          console.error('Error: path required');
          process.exit(1);
        }
        const stat = await fs.stat(args[1]);
        console.log(JSON.stringify({
          size: stat.size,
          mode: stat.mode.toString(8),
          mtime: stat.mtime.toISOString(),
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          isSymbolicLink: stat.isSymbolicLink(),
        }, null, 2));
        break;
      }

      case 'mkdir': {
        if (!args[1]) {
          console.error('Error: path required');
          process.exit(1);
        }
        const recursive = args.includes('-p') || args.includes('--recursive');
        await fs.mkdir(args[1], { recursive });
        console.log(JSON.stringify({ status: 'created', path: args[1] }));
        break;
      }

      case 'rm': {
        if (!args[1]) {
          console.error('Error: path required');
          process.exit(1);
        }
        const recursive = args.includes('-r') || args.includes('--recursive');
        const force = args.includes('-f') || args.includes('--force');
        await fs.rm(args[1], { recursive, force });
        console.log(JSON.stringify({ status: 'removed', path: args[1] }));
        break;
      }

      case 'rename': {
        if (!args[1] || !args[2]) {
          console.error('Error: source and destination paths required');
          process.exit(1);
        }
        await fs.rename(args[1], args[2]);
        console.log(JSON.stringify({ status: 'renamed', source: args[1], dest: args[2] }));
        break;
      }

      case 'copy': {
        if (!args[1] || !args[2]) {
          console.error('Error: source and destination paths required');
          process.exit(1);
        }
        const recursive = args.includes('-r') || args.includes('--recursive');
        await fs.copyFile(args[1], args[2], { recursive });
        console.log(JSON.stringify({ status: 'copied', source: args[1], dest: args[2] }));
        break;
      }

      case 'chmod': {
        if (!args[1] || !args[2]) {
          console.error('Error: path and mode required');
          process.exit(1);
        }
        const mode = parseInt(args[2], 8);
        const recursive = args.includes('-r') || args.includes('--recursive');
        await fs.chmod(args[1], mode, { recursive });
        console.log(JSON.stringify({ status: 'chmod', path: args[1], mode: args[2] }));
        break;
      }

      case 'exists': {
        if (!args[1]) {
          console.error('Error: path required');
          process.exit(1);
        }
        const exists = await fs.exists(args[1]);
        console.log(JSON.stringify({ exists }));
        break;
      }

      default:
        console.error(`Error: unknown filesystem subcommand: ${subcommand}`);
        console.error('Available: read, write, list, stat, mkdir, rm, rename, copy, chmod, exists');
        process.exit(1);
    }
  } catch (error: any) {
    logger.logEvent('fs_command_failed', {
      subcommand,
      error: error.message || String(error),
      code: error.code,
      path: error.path,
    });
    console.error(JSON.stringify({
      error: error.message || String(error),
      code: error.code,
      path: error.path,
    }));
    process.exit(1);
  }
}

// Parse flags from args array (Go-style flags like -path, -content, etc.)
function parseFsFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '-path') {
      flags.path = args[++i];
    } else if (arg === '-content') {
      flags.content = args[++i];
    } else if (arg === '-parents') {
      flags.parents = true;
    } else if (arg === '-recursive') {
      flags.recursive = true;
    } else if (arg === '-old') {
      flags.old = args[++i];
    } else if (arg === '-new') {
      flags.new = args[++i];
    } else if (arg === '-src') {
      flags.src = args[++i];
    } else if (arg === '-dst') {
      flags.dst = args[++i];
    } else if (arg === '-mode') {
      flags.mode = args[++i];
    }
    i++;
  }
  return flags;
}

async function handleHyphenatedFsCommand(
  client: SpritesClient,
  spriteName: string,
  args: string[],
  options: CLIOptions,
  logger: Logger
): Promise<void> {
  const command = args[0];
  const flags = parseFsFlags(args.slice(1));
  const sprite = client.sprite(spriteName);
  const fs = sprite.filesystem(options.dir || '/');

  try {
    switch (command) {
      case 'fs-write': {
        const path = flags.path as string;
        if (!path) {
          console.error('Error: -path is required for fs-write command');
          process.exit(1);
        }
        const content = (flags.content as string) || '';
        await fs.writeFile(path, content);
        console.log(JSON.stringify({ status: 'written', path }));
        break;
      }

      case 'fs-read': {
        const path = flags.path as string;
        if (!path) {
          console.error('Error: -path is required for fs-read command');
          process.exit(1);
        }
        const content = await fs.readFile(path, 'utf8');
        process.stdout.write(content);
        break;
      }

      case 'fs-list': {
        const path = (flags.path as string) || '.';
        const entries = await fs.readdir(path, { withFileTypes: true });
        const result = entries.map((entry: any) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymbolicLink: entry.isSymbolicLink(),
        }));
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'fs-stat': {
        const path = flags.path as string;
        if (!path) {
          console.error('Error: -path is required for fs-stat command');
          process.exit(1);
        }
        const stat = await fs.stat(path);
        console.log(JSON.stringify({
          size: stat.size,
          mode: stat.mode.toString(8),
          mtime: stat.mtime.toISOString(),
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          isSymbolicLink: stat.isSymbolicLink(),
        }, null, 2));
        break;
      }

      case 'fs-mkdir': {
        const path = flags.path as string;
        if (!path) {
          console.error('Error: -path is required for fs-mkdir command');
          process.exit(1);
        }
        await fs.mkdir(path, { recursive: !!flags.parents });
        console.log(JSON.stringify({ status: 'created', path }));
        break;
      }

      case 'fs-rm': {
        const path = flags.path as string;
        if (!path) {
          console.error('Error: -path is required for fs-rm command');
          process.exit(1);
        }
        await fs.rm(path, { recursive: !!flags.recursive, force: true });
        console.log(JSON.stringify({ status: 'removed', path }));
        break;
      }

      case 'fs-rename': {
        const oldPath = flags.old as string;
        const newPath = flags.new as string;
        if (!oldPath || !newPath) {
          console.error('Error: -old and -new are required for fs-rename command');
          process.exit(1);
        }
        await fs.rename(oldPath, newPath);
        console.log(JSON.stringify({ status: 'renamed', source: oldPath, dest: newPath }));
        break;
      }

      case 'fs-copy': {
        const src = flags.src as string;
        const dst = flags.dst as string;
        if (!src || !dst) {
          console.error('Error: -src and -dst are required for fs-copy command');
          process.exit(1);
        }
        await fs.copyFile(src, dst, { recursive: !!flags.recursive });
        console.log(JSON.stringify({ status: 'copied', source: src, dest: dst }));
        break;
      }

      case 'fs-chmod': {
        const path = flags.path as string;
        const modeStr = flags.mode as string;
        if (!path || !modeStr) {
          console.error('Error: -path and -mode are required for fs-chmod command');
          process.exit(1);
        }
        const mode = parseInt(modeStr, 8);
        await fs.chmod(path, mode, { recursive: !!flags.recursive });
        console.log(JSON.stringify({ status: 'chmod', path, mode: modeStr }));
        break;
      }

      default:
        console.error(`Error: unknown fs command: ${command}`);
        process.exit(1);
    }
  } catch (error: any) {
    logger.logEvent('fs_command_failed', {
      command,
      error: error.message || String(error),
      code: error.code,
      path: error.path,
    });
    console.error(JSON.stringify({
      error: error.message || String(error),
      code: error.code,
      path: error.path,
    }));
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
  test-cli -sprite <name> policy <subcommand> [args...]
  test-cli -sprite <name> checkpoint <subcommand> [args...]
  test-cli -sprite <name> fs <subcommand> [args...]

Required:
  SPRITES_TOKEN environment variable
        Authentication token (required)
  -sprite string
        Sprite name to execute command on (required for exec commands)

Optional Options:
  -base-url string
        Base URL for the sprite API (default: https://api.sprites.dev)
  -dir string
        Working directory for the command (also used for fs commands)
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

Policy Commands:
  policy get                       - Get network policy
  policy set <json>                - Set network policy

Checkpoint Commands:
  checkpoint list                  - List all checkpoints
  checkpoint get <id>              - Get a specific checkpoint
  checkpoint create <name>         - Create a checkpoint
  checkpoint restore <id>          - Restore to a checkpoint

Filesystem Commands (fs):
  fs read <path>                   - Read file contents
  fs write <path> [content]        - Write to file (reads stdin if no content)
  fs list [path]                   - List directory contents
  fs stat <path>                   - Get file/directory info
  fs mkdir <path> [-p]             - Create directory (-p for recursive)
  fs rm <path> [-r] [-f]           - Remove file/dir (-r recursive, -f force)
  fs rename <src> <dst>            - Rename/move file
  fs copy <src> <dst> [-r]         - Copy file/dir (-r for recursive)
  fs chmod <path> <mode> [-r]      - Change permissions (mode in octal)
  fs exists <path>                 - Check if path exists

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

    // Handle policy, checkpoint commands
    if (args[0] === 'policy') {
      if (!options.sprite) {
        console.error('Error: -sprite is required for policy command');
        process.exit(1);
      }
      await handlePolicyCommand(client, options.sprite, args.slice(1), logger);
      return;
    }

    if (args[0] === 'checkpoint') {
      if (!options.sprite) {
        console.error('Error: -sprite is required for checkpoint command');
        process.exit(1);
      }
      await handleCheckpointCommand(client, options.sprite, args.slice(1), logger);
      return;
    }

    if (args[0] === 'fs') {
      if (!options.sprite) {
        console.error('Error: -sprite is required for fs command');
        process.exit(1);
      }
      await handleFilesystemCommand(client, options.sprite, args.slice(1), options, logger);
      return;
    }

    // Handle hyphenated fs commands (fs-write, fs-read, etc.) for test harness compatibility
    if (args[0]?.startsWith('fs-')) {
      if (!options.sprite) {
        console.error(`Error: -sprite is required for ${args[0]} command`);
        process.exit(1);
      }
      await handleHyphenatedFsCommand(client, options.sprite, args, options, logger);
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

    const sprite = client.sprite(options.sprite);

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

    // Handle errors to prevent unhandled exceptions
    cmd.on('error', (error) => {
      logger.logEvent('command_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`Command error: ${error}`);
      process.exit(1);
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

