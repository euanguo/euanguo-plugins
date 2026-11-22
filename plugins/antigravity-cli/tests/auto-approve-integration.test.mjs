import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('ACP bridge delivers opt-in approval and forwards requests when disabled', async () => {
  const run = promisify(execFile);
  for (const enabled of ['true', 'false']) {
    const result = await run(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./bridge-fixture.mjs', import.meta.url)), enabled], { timeout: 15000 });
    assert.match(result.stdout, /verified/);
  }
});
