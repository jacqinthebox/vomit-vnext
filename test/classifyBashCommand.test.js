'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classifyBashCommand, isReadOnlyToolCall } = require('../src/main/services/agentTools');

test('allowlisted read-only commands classify as readonly', () => {
  for (const cmd of ['ls -la', 'pwd', 'cat package.json', 'grep -r foo src', 'find . -name "*.md"', 'wc -l file.txt', 'head -20 notes.md']) {
    assert.strictEqual(classifyBashCommand(cmd), 'readonly', cmd);
  }
});

test('windows read-only commands classify as readonly', () => {
  for (const cmd of ['dir', 'type notes.md', 'findstr /s TODO *.js', 'where node', 'tasklist']) {
    assert.strictEqual(classifyBashCommand(cmd), 'readonly', cmd);
  }
});

test('path prefixes and .exe suffixes are stripped before matching', () => {
  assert.strictEqual(classifyBashCommand('/usr/bin/grep foo bar.txt'), 'readonly');
  assert.strictEqual(classifyBashCommand('findstr.exe TODO app.js'), 'readonly');
});

test('mutating commands need permission', () => {
  for (const cmd of ['rm -rf /', 'npm install', 'node script.js', 'curl https://example.com', 'sed -i s/a/b/ file', 'mkdir foo', 'del notes.md']) {
    assert.strictEqual(classifyBashCommand(cmd), 'needs-permission', cmd);
  }
});

test('shell metacharacters force permission even for read-only commands', () => {
  for (const cmd of ['ls > out.txt', 'cat a; rm b', 'echo `whoami`', 'echo $(rm -rf .)', 'ls && rm x', 'cat < inject', 'ls\nrm -rf .']) {
    assert.strictEqual(classifyBashCommand(cmd), 'needs-permission', JSON.stringify(cmd));
  }
});

test('pipes are allowed only when every segment is read-only', () => {
  assert.strictEqual(classifyBashCommand('cat file.txt | grep foo | wc -l'), 'readonly');
  assert.strictEqual(classifyBashCommand('cat file.txt | xargs rm'), 'needs-permission');
});

test('git read-only subcommands are allowed', () => {
  for (const cmd of ['git status', 'git log --oneline -5', 'git diff HEAD~1', 'git show abc123', 'git blame file.js']) {
    assert.strictEqual(classifyBashCommand(cmd), 'readonly', cmd);
  }
});

test('git list-only subcommands allow list form but not mutations', () => {
  assert.strictEqual(classifyBashCommand('git branch'), 'readonly');
  assert.strictEqual(classifyBashCommand('git branch -a'), 'readonly');
  assert.strictEqual(classifyBashCommand('git stash list'), 'readonly');
  assert.strictEqual(classifyBashCommand('git branch new-feature'), 'needs-permission');
  assert.strictEqual(classifyBashCommand('git stash pop'), 'needs-permission');
  assert.strictEqual(classifyBashCommand('git remote add origin x'), 'needs-permission');
});

test('git config only allows get/list forms', () => {
  assert.strictEqual(classifyBashCommand('git config --get user.name'), 'readonly');
  assert.strictEqual(classifyBashCommand('git config --list'), 'readonly');
  assert.strictEqual(classifyBashCommand('git config user.name Foo'), 'needs-permission');
});

test('git mutating subcommands need permission', () => {
  for (const cmd of ['git push', 'git commit -m x', 'git checkout -b foo', 'git reset --hard', 'git rebase main']) {
    assert.strictEqual(classifyBashCommand(cmd), 'needs-permission', cmd);
  }
});

test('empty or missing command needs permission', () => {
  assert.strictEqual(classifyBashCommand(''), 'needs-permission');
  assert.strictEqual(classifyBashCommand(null), 'needs-permission');
});

test('isReadOnlyToolCall covers read-only tools, bash, writes, and unknown tools', () => {
  assert.strictEqual(isReadOnlyToolCall('read_file', { path: 'a.md' }), true);
  assert.strictEqual(isReadOnlyToolCall('search_files', { pattern: 'x' }), true);
  assert.strictEqual(isReadOnlyToolCall('fetch_url', { url: 'https://x' }), true);
  assert.strictEqual(isReadOnlyToolCall('tavily_search', { query: 'x' }), true);
  assert.strictEqual(isReadOnlyToolCall('bash', { command: 'ls' }), true);
  assert.strictEqual(isReadOnlyToolCall('bash', { command: 'rm -rf .' }), false);
  assert.strictEqual(isReadOnlyToolCall('write_file', { path: 'a' }), false);
  assert.strictEqual(isReadOnlyToolCall('edit_file', { path: 'a' }), false);
  assert.strictEqual(isReadOnlyToolCall('some_future_tool', {}), false);
});
