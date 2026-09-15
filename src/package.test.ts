import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

it('loads the SDK and client signals without an installed helper package', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const destination = mkdtempSync(join(tmpdir(), 'sprites-package-'));

  try {
    // Copy the runtime files without node_modules, as a package manager may
    // omit or replace the bundled helper when restoring a consumer lockfile.
    for (const entry of ['dist', 'vendor', 'package.json']) {
      cpSync(join(root, entry), join(destination, entry), { recursive: true });
    }

    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { SpritesClient } from './dist/index.js';
      import { authHeaders } from './dist/client-signals.js';

      assert.ok(new SpritesClient('test-token'));
      const headers = authHeaders('test-token');
      assert.equal(headers.Authorization, 'Bearer test-token');
      assert.equal(headers['Fly-Client-Agent'], 'package-test');
      console.log('Package import and attribution OK');
    `], {
      cwd: destination,
      encoding: 'utf8',
      env: {
        ...process.env,
        FLY_INVOKED_BY: 'package-test',
        SPRITES_CLIENT_SIGNALS: '1',
      },
    });

    assert.match(output, /Package import and attribution OK/);
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});
