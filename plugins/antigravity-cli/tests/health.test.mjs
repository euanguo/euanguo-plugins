import assert from 'node:assert/strict';
import test from 'node:test';
import { authStatusFromUsage, createHealthChecker } from '../health.ts';

const exists = async () => '/usr/local/bin/agy';
const okExec = async (_cmd, args) => ({
  code: 0,
  stdout: args[0] === '--version' ? '1.5.14' : 'Start the Agent Client Protocol (ACP) stdio server',
  stderr: '',
});

test('health reports not_installed when CLI cannot be resolved', async () => {
  const checker = createHealthChecker({
    probe: async () => 'ready',
    exec: async () => {
      throw new Error('should not execute');
    },
    resolve: async () => null,
  });
  const res = await checker('missing-agy');
  assert.equal(res.supported, true);
  assert.equal(res.health.status, 'not_installed');
});

test('health reports unsupported_version when CLI lacks acp subcommand', async () => {
  const checker = createHealthChecker({
    probe: async () => {
      throw new Error('should not probe auth');
    },
    exec: async (_cmd, args) => ({
      code: args[0] === '--version' ? 0 : 1,
      stdout: args[0] === '--version' ? '1.0.0' : 'unknown subcommand acp',
      stderr: '',
    }),
    resolve: exists,
  });
  const res = await checker('agy');
  assert.equal(res.supported, true);
  assert.equal(res.health.status, 'unsupported_version');
  assert.equal(res.health.installedVersion, '1.0.0');
});

for (const status of ['ready', 'unauthenticated', 'expired', 'unknown']) {
  test(`health maps sign-in state ${status}`, async () => {
    const checker = createHealthChecker({
      probe: async () => status,
      exec: okExec,
      resolve: exists,
    });
    const res = await checker('custom-agy');
    assert.equal(res.supported, true);
    assert.equal(res.health.status, status);
    assert.equal(res.health.installedVersion, '1.5.14');
    assert.equal(res.health.loginCommand, 'custom-agy acp --login');
    if (status === 'unauthenticated' || status === 'expired') {
      assert.equal(res.health.statusMessage, 'Run custom-agy acp --login on this machine.');
    }
  });
}

test('health coalesces concurrent probes and caches for 30s', async () => {
  let calls = 0;
  let time = 1000;
  const checker = createHealthChecker({
    probe: async () => {
      calls += 1;
      return 'ready';
    },
    exec: okExec,
    resolve: exists,
    now: () => time,
  });
  await Promise.all([checker('agy'), checker('agy')]);
  await checker('agy');
  assert.equal(calls, 1);
  time += 30_001;
  await checker('agy');
  assert.equal(calls, 2);
});

test('authStatusFromUsage maps usage states cleanly', () => {
  const meta = { accountEmail: null, planLabel: null };
  assert.equal(authStatusFromUsage({ supported: true, usage: { status: 'ok', ...meta, windows: [] } }), 'ready');
  assert.equal(authStatusFromUsage({ supported: true, usage: { status: 'unauthenticated' } }), 'unauthenticated');
  assert.equal(authStatusFromUsage({ supported: true, usage: { status: 'expired' } }), 'expired');
  assert.equal(authStatusFromUsage({ supported: true, usage: { status: 'error', ...meta, message: 'err' } }), 'unknown');
  assert.equal(authStatusFromUsage({ supported: false }), 'unknown');
});
