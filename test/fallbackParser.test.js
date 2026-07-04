'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseFallbackToolCalls, TOOL_NAMES } = require('../src/main/services/agentTools');

test('parses a bare JSON tool call object', () => {
  const content = '{"name": "bash", "parameters": {"command": "ls -la"}}';
  const calls = parseFallbackToolCalls(content, TOOL_NAMES);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].function.name, 'bash');
  assert.strictEqual(calls[0].function.arguments.command, 'ls -la');
});

test('parses a tool call wrapped in prose', () => {
  const content = 'I will list the files now.\n{"name": "list_files", "parameters": {"path": "."}}\nLet me know.';
  const calls = parseFallbackToolCalls(content, TOOL_NAMES);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].function.name, 'list_files');
});

test('parses tool calls inside json fences', () => {
  const content = 'Here is my call:\n```json\n{"name": "read_file", "arguments": {"path": "notes.md"}}\n```';
  const calls = parseFallbackToolCalls(content, TOOL_NAMES);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].function.name, 'read_file');
  assert.strictEqual(calls[0].function.arguments.path, 'notes.md');
});

test('parses an array of tool calls', () => {
  const content = '[{"name": "bash", "parameters": {"command": "pwd"}}, {"name": "list_files", "parameters": {"path": "src"}}]';
  const calls = parseFallbackToolCalls(content, TOOL_NAMES);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls.map((c) => c.function.name), ['bash', 'list_files']);
});

test('ignores JSON with unknown tool names', () => {
  const content = '{"name": "delete_everything", "parameters": {}}';
  assert.deepStrictEqual(parseFallbackToolCalls(content, TOOL_NAMES), []);
});

test('ignores plain prose and garbage', () => {
  assert.deepStrictEqual(parseFallbackToolCalls('Just a normal answer.', TOOL_NAMES), []);
  assert.deepStrictEqual(parseFallbackToolCalls('{broken json "name"', TOOL_NAMES), []);
  assert.deepStrictEqual(parseFallbackToolCalls('', TOOL_NAMES), []);
});

test('handles braces inside string arguments', () => {
  const content = '{"name": "bash", "parameters": {"command": "echo \\"{not: json}\\""}}';
  const calls = parseFallbackToolCalls(content, TOOL_NAMES);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].function.arguments.command, 'echo "{not: json}"');
});

test('does not greedily swallow multiple separate objects', () => {
  const content = '{"name": "bash", "parameters": {"command": "pwd"}} and then {"name": "list_files", "parameters": {"path": "."}}';
  const calls = parseFallbackToolCalls(content, TOOL_NAMES);
  assert.strictEqual(calls.length, 2);
});

test('nested parameters objects survive parsing', () => {
  const content = '{"name": "search_files", "parameters": {"pattern": "TODO", "path": "src", "file_glob": "*.js"}}';
  const calls = parseFallbackToolCalls(content, TOOL_NAMES);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].function.arguments.file_glob, '*.js');
});
