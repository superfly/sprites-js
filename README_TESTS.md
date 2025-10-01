# Sprites JavaScript SDK - Testing Guide

This SDK includes comprehensive tests that mirror the Go SDK test suite.

## Test Types

### 1. Unit Tests (`exec.test.ts`)

Unit tests verify core functionality without requiring a live sprite:
- WebSocket URL building
- Client initialization
- Error handling
- Type definitions

**Run unit tests:**
```bash
npm run test:unit
```

### 2. Integration Tests (`integration.test.ts`)

Integration tests verify the SDK against a real Sprites API endpoint. They test:
- Creating and destroying sprites
- Command execution (echo, pwd, env, etc.)
- TTY mode
- Pipes and streams
- Environment variables
- Working directory
- Exit codes
- Combined output

**Run integration tests:**
```bash
# Requires SPRITES_TEST_TOKEN
SPRITES_TEST_TOKEN=your_token npm run test:integration

# Or use the script
SPRITES_TEST_TOKEN=your_token ./run_integration_tests.sh
```

### 3. Using an Existing Sprite

To avoid creating/destroying sprites for each test run, you can use an existing sprite:

```bash
SPRITES_TEST_TOKEN=your_token SPRITE_TEST_NAME=my-existing-sprite npm run test:integration
```

When `SPRITE_TEST_NAME` is set:
- Tests will use the existing sprite instead of creating one
- The sprite will NOT be destroyed after tests
- Useful for faster test iterations during development

## Running All Tests

Run both unit and integration tests:

```bash
# Unit tests only (no token required)
npm run test:unit

# All tests (requires token)
SPRITES_TEST_TOKEN=your_token npm test
```

## Test Coverage

The integration tests cover all major SDK features:

### Exec Commands
- ✅ Basic echo command
- ✅ Working directory (pwd)
- ✅ Environment variables
- ✅ Custom working directory
- ✅ Non-zero exit codes
- ✅ Pipes and stdin/stdout
- ✅ TTY mode
- ✅ Non-TTY mode
- ✅ Interactive TTY (stty)
- ✅ Combined stdout/stderr
- ✅ execFile with arguments
- ✅ Event emitters

### Sprite Management
- ✅ Create sprite
- ✅ Get sprite info
- ✅ List sprites
- ✅ Delete sprite

## Compatibility with Go SDK

The JavaScript tests are designed to match the Go SDK test suite (`exec_test.go`):

| Go Test | JavaScript Test | Status |
|---------|----------------|--------|
| `TestCmdString` | Unit tests | ✅ |
| `TestCmdBuildWebSocketURL` | Unit tests | ✅ |
| `TestExitError` | Unit tests | ✅ |
| `TestSpriteLifecycle` | `integration.test.ts` | ✅ |
| - EchoCommand | ✅ | ✅ |
| - PwdCommand | ✅ | ✅ |
| - EnvCommand | ✅ | ✅ |
| - DirCommand | ✅ | ✅ |
| - ErrorCommand | ✅ | ✅ |
| - PipeCommand | ✅ | ✅ |
| - TTYCommand | ✅ | ✅ |
| - NonTTYCommand | ✅ | ✅ |
| - InteractiveCommand | ✅ | ✅ |

## Example Output

### Unit Tests
```
▶ SpriteCommand
  ✔ should build correct WebSocket URL for basic command (2.1ms)
  ✔ should build correct WebSocket URL with environment (0.5ms)
  ✔ should build correct WebSocket URL with working directory (0.4ms)
  ✔ should build correct WebSocket URL with TTY (0.4ms)
  ✔ should convert HTTPS to WSS (0.3ms)
▶ SpriteCommand (4.2ms)

▶ ExecError
  ✔ should have correct error message (0.3ms)
▶ ExecError (0.8ms)

▶ Client
  ✔ should create client with default options (0.2ms)
  ✔ should create client with custom base URL (0.2ms)
  ✔ should strip trailing slash from base URL (0.2ms)
▶ Client (1.0ms)
```

### Integration Tests
```
▶ Sprite Lifecycle
  Creating test sprite: test-sprite-1696186234567
  Successfully created sprite: test-sprite-1696186234567
  
  ▶ Exec Commands
    ✔ should execute echo command (234ms)
    ✔ should execute pwd command (156ms)
    ✔ should execute command with environment variables (198ms)
    ✔ should execute command with working directory (145ms)
    ✔ should handle command with non-zero exit code (123ms)
    ✔ should handle command with pipes (234ms)
    ✔ should handle TTY mode (189ms)
    ✔ should handle non-TTY mode (134ms)
    ✔ should handle interactive TTY command (201ms)
    ✔ should handle combined output (178ms)
    ✔ should handle execFile with arguments (145ms)
    ✔ should handle spawn with event emitter (156ms)
  ▶ Exec Commands (2.3s)
  
  ▶ Sprite Management
    ✔ should list sprites (234ms)
    ✔ should get sprite info (123ms)
  ▶ Sprite Management (367ms)
  
  Destroying test sprite: test-sprite-1696186234567
  Successfully destroyed sprite: test-sprite-1696186234567
▶ Sprite Lifecycle (3.1s)
```

## CI/CD Integration

The tests can be integrated into CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Run SDK Tests
  env:
    SPRITES_TEST_TOKEN: ${{ secrets.SPRITES_TEST_TOKEN }}
  run: |
    cd sdks/js
    npm install
    npm run test
```

## Troubleshooting

### "SPRITES_TEST_TOKEN not set"
Set the environment variable before running integration tests:
```bash
export SPRITES_TEST_TOKEN=your_token
npm run test:integration
```

### Tests timeout
Increase the timeout in the test file or use an existing sprite:
```bash
SPRITE_TEST_NAME=existing-sprite npm run test:integration
```

### Connection errors
Verify:
- Token is valid
- Network connectivity to Sprites API
- Firewall allows WebSocket connections

