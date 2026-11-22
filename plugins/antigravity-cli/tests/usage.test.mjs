import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBucketWindowLabel,
  normalizeAntigravityUsageOutput,
  readAntigravityProviderUsage,
  registerAntigravityUsageSource,
} from '../usage.ts';
import { experimental_providerBridge } from '../host.ts';
import { providerUsageResultSchema } from '@get-bb/plugin-sdk/provider-bridge';

const SAMPLE_USAGE_JSON = JSON.stringify({
  conversation_id: '',
  status: 'SUCCESS',
  response: '',
  command: {
    name: 'usage',
    data: {
      description: 'Within each group, models share a weekly limit and a 5-hour limit.',
      groups: [
        {
          name: 'Gemini Models',
          description: 'Models within this group: Gemini Flash, Gemini Pro',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 0.9584503769874573,
              reset_time: '2026-11-11T18:50:51Z',
            },
            {
              id: 'gemini-5h',
              name: 'Five Hour Limit Remaining',
              window: '5h',
              remaining_fraction: 0.9029293060302734,
              reset_time: '2026-11-05T15:30:15Z',
            },
          ],
        },
        {
          name: 'Claude and GPT models',
          description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
          buckets: [
            {
              id: '3p-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 0.16722920536994934,
              reset_time: '2026-11-11T22:11:24Z',
            },
            {
              id: '3p-5h',
              name: 'Five Hour Limit Remaining',
              window: '5h',
              remaining_fraction: 0.4976448118686676,
              reset_time: '2026-11-05T16:20:13Z',
            },
          ],
        },
        {
          name: 'Gemini 4 Argon',
          description: 'For paid Pro plans, Argon quota is separate.',
          buckets: [
            {
              id: 'gemini-argon-wtu-weekly',
              name: 'Gemini 4 Argon Weekly Limit',
              window: 'weekly',
              remaining_fraction: 0.6540166735649109,
              reset_time: '2026-11-11T20:39:54Z',
            },
          ],
        },
      ],
    },
  },
});

test('normalizes Antigravity per-model quota groups into BB usage windows', () => {
  const result = normalizeAntigravityUsageOutput(SAMPLE_USAGE_JSON);
  const parsed = providerUsageResultSchema.parse(result);
  assert.equal(parsed.supported, true);
  assert.equal(parsed.usage.status, 'ok');
  assert.deepEqual(parsed.usage.windows, [
    {
      label: 'Gemini 7d',
      usedPercent: 4,
      resetsAt: '2026-11-11T18:50:51.000Z',
      kind: 'custom',
      model: null,
    },
    {
      label: 'Gemini 5h',
      usedPercent: 10,
      resetsAt: '2026-11-05T15:30:15.000Z',
      kind: 'custom',
      model: null,
    },
    {
      label: 'Claude/GPT 7d',
      usedPercent: 83,
      resetsAt: '2026-11-11T22:11:24.000Z',
      kind: 'custom',
      model: null,
    },
    {
      label: 'Claude/GPT 5h',
      usedPercent: 50,
      resetsAt: '2026-11-05T16:20:13.000Z',
      kind: 'custom',
      model: null,
    },
    {
      label: 'Argon 7d',
      usedPercent: 35,
      resetsAt: '2026-11-11T20:39:54.000Z',
      kind: 'custom',
      model: null,
    },
  ]);
});

test('formats bucket window labels concisely', () => {
  assert.equal(formatBucketWindowLabel('Gemini Models', { name: 'Weekly Limit Remaining', window: 'weekly' }), 'Gemini 7d');
  assert.equal(formatBucketWindowLabel('Claude and GPT models', { name: 'Five Hour Limit Remaining', window: '5h' }), 'Claude/GPT 5h');
  assert.equal(formatBucketWindowLabel('Gemini 4 Argon', { name: 'Gemini 4 Argon Weekly Limit', window: 'weekly' }), 'Argon 7d');
  assert.equal(formatBucketWindowLabel(null, { name: 'Daily Limit', window: 'daily' }), '1d');
});

test('skips disabled buckets and treats omitted remaining_fraction on active buckets as 100% used', () => {
  const json = JSON.stringify({
    status: 'SUCCESS',
    command: {
      name: 'usage',
      data: {
        groups: [
          {
            name: 'Claude and GPT models',
            buckets: [
              {
                id: '3p-weekly',
                name: 'Weekly Limit Remaining',
                window: 'weekly',
                reset_time: '2026-11-11T22:11:24Z',
              },
              {
                id: '3p-5h',
                name: 'Five Hour Limit Remaining',
                window: '5h',
                disabled: true,
                remaining_fraction: 0.14,
              },
            ],
          },
        ],
      },
    },
  });
  const result = normalizeAntigravityUsageOutput(json);
  assert.equal(result.usage.status, 'ok');
  assert.deepEqual(result.usage.windows, [
    {
      label: 'Claude/GPT 7d',
      usedPercent: 100,
      resetsAt: '2026-11-11T22:11:24.000Z',
      kind: 'custom',
      model: null,
    },
  ]);
});

test('handles missing executable, unauthenticated, expired, and malformed usage responses', async () => {
  const notInstalled = await readAntigravityProviderUsage({
    resolveCommand: () => null,
  });
  assert.deepEqual(notInstalled, { supported: true, usage: { status: 'not_installed' } });

  const unauth = await readAntigravityProviderUsage({
    resolveCommand: () => '/usr/bin/agy',
    execFile: async () => {
      throw Object.assign(new Error('You are currently not signed in.'), { stdout: '', stderr: '' });
    },
  });
  assert.deepEqual(unauth, { supported: true, usage: { status: 'unauthenticated' } });

  const expired = await readAntigravityProviderUsage({
    resolveCommand: () => '/usr/bin/agy',
    execFile: async () => {
      throw Object.assign(new Error('OAuth session expired: invalid_grant'), { stdout: '', stderr: '' });
    },
  });
  assert.deepEqual(expired, { supported: true, usage: { status: 'expired' } });

  const malformed = normalizeAntigravityUsageOutput('not json');
  assert.equal(malformed.supported, true);
  assert.equal(malformed.usage.status, 'error');
});

test('recognizes authentication failures in usage output', () => {
  assert.equal(normalizeAntigravityUsageOutput('Not signed in').usage.status, 'unauthenticated');
  assert.equal(normalizeAntigravityUsageOutput(JSON.stringify({ status: 'ERROR', error: 'token expired' })).usage.status, 'expired');
});

test('returns error when command resolution throws', async () => {
  const result = await readAntigravityProviderUsage({
    resolveCommand: () => { throw new Error('resolution failed'); },
  });
  assert.equal(result.usage.status, 'error');
});

test('responds to provider/usage JSON-RPC requests', async () => {
  const originalWrite = process.stdout.write;
  try {
    experimental_providerBridge.start();
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No usage response')), 5000);
      process.stdout.write = chunk => {
        clearTimeout(timer);
        resolve(String(chunk));
        return true;
      };
      experimental_providerBridge.handleLine(JSON.stringify({
        jsonrpc: '2.0', id: 42, method: 'provider/usage',
        params: { providerOptions: { acpLaunchSpec: { displayName: 'Missing', command: 'missing-antigravity-test-command', args: [], env: {} } } },
      }));
    });
    const parsed = JSON.parse(await response);
    assert.equal(parsed.jsonrpc, '2.0');
    assert.equal(parsed.id, 42);
    assert.deepEqual(providerUsageResultSchema.parse(parsed.result), { supported: true, usage: { status: 'not_installed' } });
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('registers discoverable provider-usage.v1 RPC handlers and returns host usage', async () => {
  let registeredContract;
  let registeredHandlers;
  let registeredOptions;

  const mockBb = {
    pluginId: 'antigravity-cli',
    rpc: {
      register(contract, handlers, options) {
        registeredContract = contract;
        registeredHandlers = handlers;
        registeredOptions = options;
      },
    },
    sdk: {
      hosts: {
        list: async () => [{ id: 'host_1', name: 'Primary Machine', status: 'connected' }],
        get: async ({ hostId }) => ({ id: hostId, name: 'Primary Machine', status: 'connected' }),
      },
      providers: {
        list: async () => [
          {
            id: 'antigravity-cli',
            pluginId: 'antigravity-cli',
            displayName: 'Antigravity CLI',
          },
        ],
      },
      system: {
        usageLimits: async () => ({
          'antigravity-cli': normalizeAntigravityUsageOutput(SAMPLE_USAGE_JSON).usage,
        }),
      },
    },
  };

  registerAntigravityUsageSource(mockBb);
  assert.ok(registeredContract);
  assert.equal(registeredOptions?.experimental_discoverable, true);

  const listResult = await registeredHandlers['provider-usage.v1.listResources']({});
  assert.equal(listResult.resources.length, 1);
  assert.equal(listResult.resources[0].providerId, 'antigravity-cli');
  assert.equal(listResult.resources[0].scope.kind, 'host');

  const getResult = await registeredHandlers['provider-usage.v1.getResource']({
    resourceId: listResult.resources[0].id,
    refresh: true,
  });
  assert.equal(getResult.usage.status, 'ok');
  assert.equal(getResult.usage.windows.length, 5);
  assert.equal(getResult.usage.windows[0].label, 'Gemini 7d');
});

test('evicts cached usage when the provider is removed', async () => {
  let handlers;
  let enabled = true;
  let collections = 0;
  const bb = {
    pluginId: 'antigravity-cli',
    rpc: { register(_contract, registered) { handlers = registered; } },
    sdk: {
      hosts: { get: async () => ({ id: 'host_1', name: 'Machine', status: 'connected' }) },
      providers: { list: async () => enabled ? [{ id: 'antigravity-cli', pluginId: 'antigravity-cli' }] : [] },
      system: { usageLimits: async () => {
        collections++;
        return { 'antigravity-cli': normalizeAntigravityUsageOutput(SAMPLE_USAGE_JSON).usage };
      } },
    },
  };
  registerAntigravityUsageSource(bb);
  const getResource = handlers['provider-usage.v1.getResource'];
  const resourceId = JSON.stringify(['host_1', 'antigravity-cli']);
  assert.equal((await getResource({ resourceId, refresh: true })).usage.status, 'ok');
  enabled = false;
  await assert.rejects(getResource({ resourceId, refresh: true }), /no longer exists/);
  enabled = true;
  await getResource({ resourceId, refresh: false });
  assert.equal(collections, 2);
});
