import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../server.ts';
import { mapPromptMode } from '../prompt-mode.ts';

test('enable setting adds and removes the provider without reload', async () => {
  let change;
  let registered = 0;
  let disposed = 0;
  await plugin({
    settings: { define(descriptors) {
      assert.equal(descriptors.enabled.default, true);
      return { get: async () => ({ enabled: false }), onChange(fn) { change = fn; } };
    } },
    providers: { register() { registered++; return { dispose() { disposed++; } }; } },
  });
  assert.equal(registered, 0);
  change({ enabled: true });
  assert.equal(registered, 1);
  change({ enabled: false });
  assert.equal(disposed, 1);
});

test('Plan and Build override stale native modes and preserve other options', () => {
  for (const permissionMode of ['accept-edits', 'full']) {
    for (const promptMode of ['plan', undefined]) {
      const line = JSON.stringify({ method: 'turn/start', params: { options: {
        permissionMode, promptMode, sessionOptions: { mode: 'default', other: 'keep' },
      } } });
      const options = JSON.parse(mapPromptMode(line)).params.options;
      assert.equal(options.sessionOptions.mode, promptMode === 'plan' ? 'plan' : 'accept-edits');
      assert.equal(options.sessionOptions.other, 'keep');
      assert.equal(options.permissionMode, permissionMode);
    }
  }
  for (const line of ['invalid', 'null', '{"method":"initialize"}']) assert.equal(mapPromptMode(line), line);
});


test('native work-mode selection is honored independently of permissions', () => {
  for (const permissionMode of ['accept-edits', 'full']) {
    for (const mode of ['plan', 'accept-edits', 'default', undefined]) {
      const options = JSON.parse(mapPromptMode(JSON.stringify({method: 'turn/start', params: {options: {permissionMode, sessionOptions: {mode}}}}))).params.options;
      assert.equal(options.sessionOptions.mode, mode === 'plan' ? 'plan' : 'accept-edits');
      assert.equal(options.permissionMode, permissionMode);
    }
  }
});
