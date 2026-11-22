import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../server.ts';
import { applyAntigravityDefaults } from '../host.ts';
import { experimental_acpLaunchSpecSchema } from '@get-bb/plugin-sdk/provider-bridge/acp';

test('registers a native ACP provider with per-session isolation and extended reasoning levels', async () => {
  const declarations = [];
  await plugin({
    settings: {
      define(descriptors) {
        assert.equal(descriptors.command.default, 'agy');
        assert.equal(descriptors.processPerSession.default, true);
        assert.equal(descriptors.agentTurnQuietSeconds.default, 30);
        assert.equal(descriptors.autoApprove.default, false);
        assert.equal(descriptors.sandbox.default, false);
        assert.equal(descriptors.subagentsDisabled.default, false);
        assert.equal(descriptors.commandDescriptionsEnabled.default, true);
        assert.equal(descriptors.enabled.default, true);
        return { get: async () => ({ enabled: true }), onChange() {} };
      },
    },
    providers: { register(value) { declarations.push(value); return { dispose() {} }; } },
  });
  assert.equal(declarations.length, 1);
  const provider = declarations[0];
  assert.equal(provider.id, 'antigravity-cli');
  assert.equal(provider.icon, './assets/provider.svg');
  assert.deepEqual(provider.composerActions, []);
  const spec = experimental_acpLaunchSpecSchema.parse(provider.experimental_bridgeOptions.acpLaunchSpec);
  assert.equal(spec.command, 'agy');
  assert.deepEqual(spec.args, ['acp', '--process-per-session', '--disable-telemetry']);
  assert.deepEqual(spec.env, {});
  assert.equal(spec.cwd, undefined);
  assert.equal(spec.permissionCli, undefined);
  assert.deepEqual(provider.capabilities.permissionModes, ['accept-edits', 'full']);
  assert.deepEqual(provider.capabilities.reasoningLevels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(provider.maintenance, { health: true, usage: true, installation: false });
  assert.equal(provider.experimental_bridgeOptions.acpDialect, 'antigravity');
});

test('deriveProviderOptions handles sandbox, processPerSession, custom command, and quiet timeout', async () => {
  let provider;
  await plugin({
    settings: { define() { return { get: async () => ({ enabled: true }), onChange() {} }; } },
    providers: { register(value) { provider = value; return { dispose() {} }; } },
  });
  for (const sandbox of [undefined, false, true, 'true']) {
    const options = provider.deriveProviderOptions({ settings: { sandbox } });
    const spec = experimental_acpLaunchSpecSchema.parse(options.acpLaunchSpec);
    assert.deepEqual(spec.args, [
      'acp',
      '--process-per-session',
      '--disable-telemetry',
      ...(sandbox === true ? ['--sandbox'] : []),
    ]);
    assert.equal(spec.command, 'agy');
    assert.deepEqual(spec.env, {});
    assert.equal(options.acpDialect, 'antigravity');
    assert.equal(options.agentTurnQuietSeconds, 30);
  }
  const custom = provider.deriveProviderOptions({
    settings: { command: ' /opt/bin/agy ', processPerSession: false, agentTurnQuietSeconds: 45, sandbox: true },
  });
  assert.equal(custom.acpLaunchSpec.command, '/opt/bin/agy');
  assert.deepEqual(custom.acpLaunchSpec.args, ['acp', '--disable-telemetry', '--sandbox']);
  assert.equal(custom.agentTurnQuietSeconds, 45);
  assert.equal(provider.deriveProviderOptions({ settings: { agentTurnQuietSeconds: 999 } }).agentTurnQuietSeconds, 300);
  assert.equal(provider.deriveProviderOptions({ settings: { agentTurnQuietSeconds: 1 } }).agentTurnQuietSeconds, 5);
  for (const autoApprove of [undefined, false, true, 'true']) {
    assert.equal(provider.deriveProviderOptions({ settings: { autoApprove } }).autoApprove, autoApprove === true);
  }
  for (const subagentsDisabled of [undefined, false, true, 'true']) {
    assert.equal(
      provider.deriveProviderOptions({ settings: { subagentsDisabled } }).providerSubagentsEnabled,
      subagentsDisabled !== true,
    );
  }
  for (const commandDescriptionsEnabled of [undefined, false, true, 'false']) {
    assert.equal(
      provider.deriveProviderOptions({ settings: { commandDescriptionsEnabled } }).commandDescriptionsEnabled,
      commandDescriptionsEnabled !== false,
    );
  }
  assert.ok(provider.experimental_nativeSkillRoots.user.includes('.gemini/antigravity-cli/skills'));
  assert.ok(provider.experimental_nativeSkillRoots.project.includes('.agents/skills'));
  assert.equal(provider.capabilities.fork, 'none');
  assert.equal(provider.capabilities.supportsManualCompaction, false);
});

test('applyAntigravityDefaults strips additionalWorkspaceWriteRoots and enforces antigravity dialect', () => {
  const input = {
    jsonrpc: '2.0',
    id: 1,
    method: 'thread/start',
    params: {
      threadId: 'thr_1',
      options: {
        providerOptions: {
          acpDialect: 'acp',
          additionalWorkspaceWriteRoots: ['/tmp/thread-storage'],
        },
      },
    },
  };
  const { parsed } = applyAntigravityDefaults(JSON.stringify(input), input);
  const providerOptions = parsed.params.options.providerOptions;
  assert.equal(providerOptions.acpDialect, 'antigravity');
  assert.equal('additionalWorkspaceWriteRoots' in providerOptions, false);
});
