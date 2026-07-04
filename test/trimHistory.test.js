'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { trimHistoryToTokenBudget, estimateTokens } = require('../src/main/services/agentTools');

function msg(role, chars) {
  return { role, content: 'x'.repeat(chars) };
}

test('history under budget is returned unchanged', () => {
  const history = [msg('user', 100), msg('assistant', 100)];
  const result = trimHistoryToTokenBudget(history, 1000);
  assert.deepStrictEqual(result, history);
});

test('oldest entries are dropped first', () => {
  const history = [msg('user', 4000), msg('assistant', 4000), msg('user', 4000)];
  // Budget of ~1100 tokens fits one 4000-char message (1000 tokens) only.
  const result = trimHistoryToTokenBudget(history, 1100);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], history[2]);
});

test('the newest entry always survives even over budget', () => {
  const history = [msg('user', 100000)];
  const result = trimHistoryToTokenBudget(history, 10);
  assert.strictEqual(result.length, 1);
});

test('result respects the estimated token budget', () => {
  const history = Array.from({ length: 50 }, () => msg('assistant', 2000));
  const budget = 5000;
  const result = trimHistoryToTokenBudget(history, budget);
  assert.ok(estimateTokens(result) <= budget);
  assert.ok(result.length > 0);
});

test('hard entry cap applies before token trimming', () => {
  const history = Array.from({ length: 500 }, () => msg('user', 4));
  const result = trimHistoryToTokenBudget(history, 1e9, 200);
  assert.strictEqual(result.length, 200);
});

test('tool_calls payloads count toward the estimate', () => {
  const withTools = [{ role: 'assistant', content: '', tool_calls: [{ function: { name: 'bash', arguments: { command: 'x'.repeat(4000) } } }] }];
  assert.ok(estimateTokens(withTools) > 900);
});

test('returns a new array and does not mutate the input', () => {
  const history = [msg('user', 4000), msg('user', 4000)];
  const copy = history.slice();
  trimHistoryToTokenBudget(history, 500);
  assert.deepStrictEqual(history, copy);
});
