import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAntigravityCommand, resolveAntigravityLaunchSpec } from '../cli.ts';
import { readAntigravityProviderUsage } from '../usage.ts';

test('Windows installer location works without agy on PATH for launch and usage', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-resolution-'));
  const env = { ...process.env, PATH: root, LOCALAPPDATA: root };
  const command = join(root, 'agy', 'bin', 'agy.exe');
  try {
    assert.equal(resolveAntigravityCommand('agy', { env }), null);
    mkdirSync(join(root, 'agy', 'bin'), { recursive: true });
    writeFileSync(command, 'fixture');
    assert.equal(resolveAntigravityCommand('agy', { env }), command);
    for (const nested of [false, true]) {
      const spec = { command: 'agy', args: ['acp'], env };
      const providerOptions = { acpLaunchSpec: spec };
      const request = { params: nested ? { options: { providerOptions } } : { providerOptions } };
      resolveAntigravityLaunchSpec(request);
      assert.equal(spec.command, command);
      assert.deepEqual(spec.args, ['acp']);
    }
    assert.equal(resolveAntigravityCommand('missing-custom-cli', { env }), null);
    let executed;
    await readAntigravityProviderUsage({ env, execFile: async executable => {
      executed = executable;
      return { stdout: '{}', stderr: '' };
    } });
    assert.equal(executed, command);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit executable paths are preserved', () => {
  const request = { params: { providerOptions: { acpLaunchSpec: { command: process.execPath } } } };
  resolveAntigravityLaunchSpec(request);
  assert.equal(request.params.providerOptions.acpLaunchSpec.command, process.execPath);
});
