import test from 'node:test';
import assert from 'node:assert/strict';
import { presentModeControls, modeControlOutput } from '../mode-controls.ts';
import { mapPromptMode } from '../prompt-mode.ts';

const mode = { id: 'mode', type: 'select', label: 'Mode', value: 'default', values: [
  { id: 'default', label: 'Default' }, { id: 'accept-edits', label: 'Accept edits' }, { id: 'plan', label: 'Plan' },
] };
const other = { id: 'other', type: 'boolean', label: 'Other', value: true };

test('catalog and live session updates present exactly Build and Plan', () => {
  for (const value of ['default', 'accept-edits', 'plan']) {
    const message = { result: {models: [{sessionOptions: [{...mode, value}, other]}], selectedOnlyModels: [{sessionOptions: [mode]}]}, params: {deltas: [
      {kind: 'extension.state', extensionKind: 'bb/session-options', payload: {options: [{...mode, value}, other]}},
      {kind: 'text', text: 'Default and Accept edits are words in a reply'},
    ]}};
    const result = JSON.parse(presentModeControls(JSON.stringify(message)));
    for (const options of [result.result.models[0].sessionOptions, result.params.deltas[0].payload.options]) {
      assert.deepEqual(options[0].values.map(v => v.label), ['Build', 'Plan']);
      assert.equal(options[0].value, value === 'plan' ? 'plan' : 'accept-edits');
      assert.deepEqual(options[1], other);
    }
    assert.deepEqual(result.params.deltas[1], message.params.deltas[1]);
  }
});

test('transport handles split lines, UTF-8, and unrelated messages', async () => {
  const output = modeControlOutput();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  const line = JSON.stringify({ result: { models: [{displayName: 'caf\u00e9', sessionOptions: [mode]}] } });
  const bytes = Buffer.from(line + '\nnull\ninvalid\n');
  for (const byte of bytes) output.write(Buffer.from([byte]));
  output.end();
  await new Promise(resolve => output.on('end', resolve));
  const lines = Buffer.concat(chunks).toString().trim().split('\n');
  assert.equal(JSON.parse(lines[0]).result.models[0].displayName, 'caf\u00e9');
  assert.deepEqual(lines.slice(1), ['null', 'invalid']);
});

test('transport transforms a trailing line without a newline', async () => {
  const output = modeControlOutput();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  output.end(JSON.stringify({result: {models: [{sessionOptions: [mode]}]}}));
  await new Promise(resolve => output.on('end', resolve));
  const result = JSON.parse(Buffer.concat(chunks).toString());
  assert.deepEqual(result.result.models[0].sessionOptions[0].values.map(v => v.label), ['Build', 'Plan']);
});

test('Build exits a previous BB plan action', () => {
  const options = JSON.parse(mapPromptMode(JSON.stringify({method: 'turn/start', params: {options: {promptMode: 'plan', sessionOptions: {mode: 'accept-edits'}}}}))).params.options;
  assert.equal(options.sessionOptions.mode, 'accept-edits');
});
