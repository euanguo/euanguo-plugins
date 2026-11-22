import assert from 'node:assert/strict';
import test from 'node:test';
import { createTurnStabilityController } from '../turn-stability.ts';

function deltaLine(threadId, deltas) {
  return JSON.stringify({ jsonrpc: '2.0', method: 'thread/delta', params: { threadId, deltas } });
}

test('normal synchronous user turn emits turn.boundary immediately without holding', () => {
  const flushed = [];
  const controller = createTurnStabilityController({
    onFlushBoundary: (threadId, boundary) => flushed.push({ threadId, boundary }),
  });
  controller.handleInboundRequest({
    method: 'thread/start',
    params: { threadId: 'thr_sync', options: { providerOptions: { agentTurnQuietSeconds: 30 } } },
  });
  controller.handleInboundRequest({
    method: 'turn/start',
    params: { threadId: 'thr_sync', options: { providerOptions: { agentTurnQuietSeconds: 30 } } },
  });
  const out = controller.processStdoutLine(
    deltaLine('thr_sync', [
      { kind: 'turn.open' },
      { kind: 'item.textDelta', channel: 'agentMessage', text: 'Done.' },
      { kind: 'turn.boundary', status: 'completed' },
    ]),
  );
  assert.equal(out.length, 1);
  const parsed = JSON.parse(out[0]);
  assert.equal(parsed.params.deltas.at(-1).kind, 'turn.boundary');
  assert.equal(controller.hasHeldBoundary('thr_sync'), false);
  assert.equal(flushed.length, 0);
  controller.dispose();
});

test('interrupted in-progress run_command promotes to backgroundTask and settles late tool_call_update without provider/unhandled', async () => {
  const flushed = [];
  const controller = createTurnStabilityController({
    onFlushBoundary: (threadId, boundary) => flushed.push({ threadId, boundary }),
  });

  controller.handleInboundRequest({
    method: 'thread/start',
    params: { threadId: 'thr_bg', options: { providerOptions: { agentTurnQuietSeconds: 6 } } },
  });
  controller.handleInboundRequest({
    method: 'turn/start',
    params: { threadId: 'thr_bg', options: { providerOptions: { agentTurnQuietSeconds: 6 } } },
  });

  // ACP reports run_command started in_progress
  controller.noteToolUpdate({
    toolCallId: 'call_bg_1',
    title: 'run_command',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { CommandLine: 'node verify-h5.mjs', toolSummary: 'Verify H5 E2E' },
  });

  // 1) item.open flows out
  controller.processStdoutLine(
    deltaLine('thr_bg', [
      { kind: 'turn.open' },
      {
        kind: 'item.open',
        key: { providerItemId: 'call_bg_1' },
        item: { type: 'command', command: 'node verify-h5.mjs' },
        presentation: { title: 'Verify H5 E2E' },
      },
    ]),
  );

  // 2) session/prompt exits early -> SDK closeUnfinishedToolCalls("cancelled") emits item.close(interrupted) + turn.boundary
  const earlyClose = controller.processStdoutLine(
    deltaLine('thr_bg', [
      {
        kind: 'item.close',
        key: { providerItemId: 'call_bg_1' },
        status: 'interrupted',
        item: { type: 'command', command: 'node verify-h5.mjs' },
        presentation: { title: 'Verify H5 E2E' },
      },
      { kind: 'turn.boundary', status: 'completed' },
    ]),
  );
  assert.equal(earlyClose.length, 1);
  const earlyDeltas = JSON.parse(earlyClose[0]).params.deltas;
  // Must have promoted backgroundTask item.open and held turn.boundary
  const promotedOpen = earlyDeltas.find((d) => d.kind === 'item.open' && d.item?.type === 'backgroundTask');
  assert.ok(promotedOpen);
  assert.equal(promotedOpen.key.providerItemId, 'bg-tool:call_bg_1');
  assert.equal(promotedOpen.item.description, 'Verify H5 E2E');
  assert.equal(earlyDeltas.some((d) => d.kind === 'turn.boundary'), false);
  assert.equal(controller.getPromotedToolCount('thr_bg'), 1);
  assert.equal(controller.hasHeldBoundary('thr_bg'), true);

  // 3) 10s later, late terminal tool_call_update arrives with noTurnFallback
  const lateUpdate = controller.processStdoutLine(
    deltaLine('thr_bg', [
      {
        kind: 'item.close',
        key: { providerItemId: 'call_bg_1' },
        status: 'completed',
        item: { type: 'command', command: 'node verify-h5.mjs' },
        noTurnFallback: {
          rawType: 'acp/update:tool_call_update',
          raw: {
            params: {
              update: {
                toolCallId: 'call_bg_1',
                status: 'completed',
                content: [{ type: 'content', content: { type: 'text', text: 'Command exited with code 0.\n\nCommand output:\nall green' } }],
              },
            },
          },
        },
      },
    ]),
  );
  const lateDeltas = JSON.parse(lateUpdate[0]).params.deltas;
  assert.equal(lateDeltas.length, 1);
  assert.equal(lateDeltas[0].kind, 'item.close');
  assert.equal(lateDeltas[0].key.providerItemId, 'bg-tool:call_bg_1');
  assert.equal(lateDeltas[0].status, 'completed');
  assert.equal(lateDeltas[0].item.taskStatus, 'completed');
  assert.equal(lateDeltas[0].item.summary, 'all green');
  assert.equal('noTurnFallback' in lateDeltas[0], false);
  assert.equal(controller.getPromotedToolCount('thr_bg'), 0);

  // 4) Agent wakes up (openAgentTurn -> turn.open); duplicate turn.open must be coalesced
  const wakeUp = controller.processStdoutLine(
    deltaLine('thr_bg', [
      { kind: 'turn.open' },
      { kind: 'item.textDelta', channel: 'agentMessage', text: 'Verification succeeded.' },
    ]),
  );
  const wakeDeltas = JSON.parse(wakeUp[0]).params.deltas;
  assert.equal(wakeDeltas.some((d) => d.kind === 'turn.open'), false);
  assert.equal(wakeDeltas[0].text, 'Verification succeeded.');
  assert.equal(controller.hasHeldBoundary('thr_bg'), false);

  // 5) Boundary on async wakeup turn is held past 5s SDK quiet cutoff, then flushes when quiet elapses
  const quietClose = controller.processStdoutLine(
    deltaLine('thr_bg', [{ kind: 'turn.boundary', status: 'completed' }]),
  );
  assert.deepEqual(quietClose, []);
  assert.equal(controller.hasHeldBoundary('thr_bg'), true);

  await new Promise((r) => setTimeout(r, 1150));
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].threadId, 'thr_bg');
  assert.equal(flushed[0].boundary.kind, 'turn.boundary');
  assert.equal(flushed[0].boundary.status, 'completed');
  controller.dispose();
});

test('turn/steer and thread/stop flush or cancel held boundary cleanly', () => {
  const controller = createTurnStabilityController();
  controller.handleInboundRequest({
    method: 'thread/start',
    params: { threadId: 'thr_ctrl', options: { providerOptions: { agentTurnQuietSeconds: 30 } } },
  });
  // Unsolicited openAgentTurn
  controller.processStdoutLine(deltaLine('thr_ctrl', [{ kind: 'turn.open' }]));
  controller.processStdoutLine(deltaLine('thr_ctrl', [{ kind: 'turn.boundary', status: 'completed' }]));
  assert.equal(controller.hasHeldBoundary('thr_ctrl'), true);

  const steerRes = controller.handleInboundRequest({
    method: 'turn/steer',
    params: { threadId: 'thr_ctrl' },
  });
  assert.equal(steerRes.flushDeltas.length, 1);
  assert.equal(steerRes.flushDeltas[0].deltas[0].kind, 'turn.boundary');
  assert.equal(steerRes.flushDeltas[0].deltas[0].status, 'completed');
  assert.equal(controller.hasHeldBoundary('thr_ctrl'), false);

  // Another held boundary stopped explicitly
  controller.processStdoutLine(deltaLine('thr_ctrl', [{ kind: 'turn.open' }]));
  controller.processStdoutLine(deltaLine('thr_ctrl', [{ kind: 'turn.boundary', status: 'completed' }]));
  assert.equal(controller.hasHeldBoundary('thr_ctrl'), true);

  const stopRes = controller.handleInboundRequest({
    method: 'thread/stop',
    params: { threadId: 'thr_ctrl', intent: 'stop' },
  });
  assert.equal(stopRes.flushDeltas.length, 1);
  assert.equal(stopRes.flushDeltas[0].deltas[0].status, 'interrupted');
  assert.equal(controller.hasHeldBoundary('thr_ctrl'), false);
  controller.dispose();
});
