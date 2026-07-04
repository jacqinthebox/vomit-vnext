'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createPermissionBroker } = require('../src/main/services/agentPermissions');

function makeBroker() {
  const sent = [];
  const state = { agentSessionAllowlist: new Set() };
  const broker = createPermissionBroker({
    sendOutput: (channel, payload) => sent.push({ channel, payload }),
    state
  });
  return { broker, state, sent };
}

const CONFIG = { getAgentPermissionMode: () => 'auto' };

// Answer the most recent permission request with the given token.
function answerLast(broker, sent, answer) {
  const req = [...sent].reverse().find((s) => s.channel === 'agent-permission-request');
  assert.ok(req, 'no permission request was sent');
  broker.resolveRequest(req.payload.id, answer);
  return req.payload;
}

const DIFF = { header: 'x.md | +1 -0', text: '@@ -0,0 +1 @@\n+hi', stats: { added: 1, removed: 0 }, truncated: false };

test('plain prompt: y allows, n denies, a allows and populates the allowlist', async () => {
  const { broker, state, sent } = makeBroker();

  let verdict = broker.gate('write_file', { path: 'x.md' }, CONFIG);
  answerLast(broker, sent, 'y');
  assert.strictEqual(await verdict, 'allow');

  verdict = broker.gate('write_file', { path: 'x.md' }, CONFIG);
  answerLast(broker, sent, 'n');
  assert.strictEqual(await verdict, 'deny');

  verdict = broker.gate('write_file', { path: 'x.md' }, CONFIG);
  answerLast(broker, sent, 'a');
  assert.strictEqual(await verdict, 'allow');
  assert.ok(state.agentSessionAllowlist.has('tool:write_file'));

  // Allowlisted now — no further prompt.
  const before = sent.length;
  assert.strictEqual(await broker.gate('write_file', { path: 'y.md' }, CONFIG), 'allow');
  assert.strictEqual(sent.length, before);
});

test('diff prompt payload carries kind and diff', async () => {
  const { broker, sent } = makeBroker();
  const verdict = broker.gate('write_file', { path: 'x.md' }, CONFIG, { diff: DIFF });
  const payload = answerLast(broker, sent, 'a');
  assert.strictEqual(payload.kind, 'diff');
  assert.deepStrictEqual(payload.diff, DIFF);
  assert.strictEqual(await verdict, 'allow');
});

test('diff prompt: a approves once without touching the allowlist', async () => {
  const { broker, state, sent } = makeBroker();
  const verdict = broker.gate('write_file', { path: 'x.md' }, CONFIG, { diff: DIFF });
  answerLast(broker, sent, 'a');
  assert.strictEqual(await verdict, 'allow');
  assert.strictEqual(state.agentSessionAllowlist.size, 0);
});

test('diff prompt: y approves, r and empty deny', async () => {
  const { broker, sent } = makeBroker();

  let verdict = broker.gate('edit_file', { path: 'x.md' }, CONFIG, { diff: DIFF });
  answerLast(broker, sent, 'y');
  assert.strictEqual(await verdict, 'allow');

  verdict = broker.gate('edit_file', { path: 'x.md' }, CONFIG, { diff: DIFF });
  answerLast(broker, sent, 'r');
  assert.strictEqual(await verdict, 'deny');

  verdict = broker.gate('edit_file', { path: 'x.md' }, CONFIG, { diff: DIFF });
  answerLast(broker, sent, '');
  assert.strictEqual(await verdict, 'deny');
});

test('diff prompt: s allows and adds the session allowlist entry', async () => {
  const { broker, state, sent } = makeBroker();
  const verdict = broker.gate('write_file', { path: 'x.md' }, CONFIG, { diff: DIFF });
  answerLast(broker, sent, 's');
  assert.strictEqual(await verdict, 'allow');
  assert.ok(state.agentSessionAllowlist.has('tool:write_file'));
});

test('abortAll denies pending diff prompts (abort → reject)', async () => {
  const { broker } = makeBroker();
  const verdict = broker.gate('write_file', { path: 'x.md' }, CONFIG, { diff: DIFF });
  broker.abortAll();
  assert.strictEqual(await verdict, 'deny');
  assert.strictEqual(broker.pendingCount(), 0);
});

test('mode never skips prompts entirely', async () => {
  const { broker, sent } = makeBroker();
  const verdict = await broker.gate('write_file', { path: 'x.md' }, { getAgentPermissionMode: () => 'never' }, { diff: DIFF });
  assert.strictEqual(verdict, 'allow');
  assert.strictEqual(sent.length, 0);
});
