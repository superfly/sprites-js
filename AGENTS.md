# AGENTS.md

`@fly/sprites` is the JavaScript and TypeScript SDK for Fly.io Sprites. Source is TypeScript in
`src/`, compiled by `tsc` to `dist/`. It needs Node.js 24 or later.

## Build and test

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm run build       # writes src/version.ts, then tsc
npm test            # build, then node --test dist/**/*.test.js
npm pack --dry-run  # check what would be published
```

CI runs all of these, with `npm test` on Linux, macOS and Windows.

Tests are `src/*.test.ts`, beside the code they test. `npm run test:unit` runs only
`exec.test.ts`.

## Integration tests

`src/integration.test.ts` skips itself unless `SPRITES_TEST_TOKEN` is set. With a token it creates
and destroys real Sprites in that token's organization, which costs money, so don't set it unless
asked. `npm run test:integration` or `./run_integration_tests.sh` runs only those tests.

## Notes

- `src/version.ts` is generated from `package.json` by `scripts/write-version.mjs` before every
  build. Don't edit it by hand.
- `@fly/client-signals` is vendored in `vendor/client-signals` and bundled into the package.
- `test-node-cli/` is a separate npm package for a test CLI with its own `package.json`.
- Releases publish to npm from a `v*.*.*` tag (`.github/workflows/publish.yml`). Don't tag unless
  asked.
