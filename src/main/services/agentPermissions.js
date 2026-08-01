// @ts-check
'use strict';

/**
 * Permission broker for agent tool execution.
 *
 * Decides whether a tool call may run based on the configured permission mode
 * ('auto' | 'always' | 'never'), a per-session allowlist, and — when needed —
 * an interactive y/n/a prompt in the AI terminal. The prompt round-trips over
 * IPC: main sends 'agent-permission-request' (via syncTerminalOutput, so both
 * the attached and detached terminal see it) and the renderer answers through
 * the 'agent-permission-response' invoke channel. First answer wins; the
 * broker then broadcasts 'agent-permission-resolved' so the other window can
 * dismiss its prompt.
 *
 * No require('electron') — wiring happens in main.js / the IPC handlers.
 */

const { isReadOnlyToolCall } = require('./agentTools');

const PROMPT_TIMEOUT_MS = 120000;

/**
 * @param {{ sendOutput: (channel: string, ...args: any[]) => void,
 *           state: { agentSessionAllowlist: Set<string> } }} deps
 */
function createPermissionBroker({ sendOutput, state }) {
  /** @type {Map<string, {resolve: (answer: string) => void, timer: NodeJS.Timeout}>} */
  const pending = new Map();
  let counter = 0;

  // Session allowlist key: bash commands by their first token (so 'a' on
  // `npm test` allows npm for the rest of the session), other tools by name.
  function allowlistKey(toolName, args) {
    if (toolName === 'bash') {
      const first =
        String((args && args.command) || '')
          .trim()
          .split(/\s+/)[0] || '';
      return `bash:${first.toLowerCase()}`;
    }
    return `tool:${toolName}`;
  }

  function summarize(toolName, args) {
    let summary;
    if (toolName === 'bash') summary = String((args && args.command) || '');
    else if (toolName === 'edit_file') summary = `${(args && args.path) || ''} (replace snippet)`;
    else if (args && args.path) summary = String(args.path);
    else summary = JSON.stringify(args || {});
    return summary.length > 200 ? summary.slice(0, 200) + '…' : summary;
  }

  function prompt(toolName, args, extras) {
    return new Promise((resolve) => {
      const id = `perm-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          sendOutput('agent-permission-resolved', { id, answer: 'timeout' });
          resolve('');
        }
      }, PROMPT_TIMEOUT_MS);
      pending.set(id, { resolve, timer });
      sendOutput('agent-permission-request', {
        id,
        toolName,
        summary: summarize(toolName, args),
        ...(extras || {}),
      });
    });
  }

  return {
    /**
     * Decide whether a tool call may execute.
     *
     * With `opts.diff` the prompt is a diff approval: the payload carries the
     * rendered diff and the answer keys become a/approve/y = allow once,
     * s/always = allow + session allowlist (`a` cannot mean "always" here —
     * it approves). Without a diff the plain y/n/a mapping is unchanged.
     * @param {string} toolName
     * @param {object} args normalized tool arguments
     * @param {{ getAgentPermissionMode: () => string }} configStore
     * @param {{ diff?: {header: string, text: string, stats: object, truncated: boolean} }} [opts]
     * @returns {Promise<'allow' | 'deny'>}
     */
    async gate(toolName, args, configStore, opts = {}) {
      const mode = configStore.getAgentPermissionMode();
      if (mode === 'never') return 'allow';
      if (mode !== 'always' && isReadOnlyToolCall(toolName, args)) return 'allow';
      if (state.agentSessionAllowlist.has(allowlistKey(toolName, args))) return 'allow';

      if (opts.diff) {
        const answer = (await prompt(toolName, args, { kind: 'diff', diff: opts.diff }))
          .trim()
          .toLowerCase();
        if (answer === 's' || answer === 'always') {
          state.agentSessionAllowlist.add(allowlistKey(toolName, args));
          return 'allow';
        }
        if (answer === 'a' || answer === 'approve' || answer === 'y' || answer === 'yes')
          return 'allow';
        return 'deny';
      }

      const answer = (await prompt(toolName, args, { kind: 'plain' })).trim().toLowerCase();
      if (answer === 'a' || answer === 'always') {
        state.agentSessionAllowlist.add(allowlistKey(toolName, args));
        return 'allow';
      }
      if (answer === 'y' || answer === 'yes') return 'allow';
      return 'deny';
    },

    /**
     * Resolve a pending prompt from the renderer. First response wins.
     * @param {string} id
     * @param {string} answer
     */
    resolveRequest(id, answer) {
      const entry = pending.get(id);
      if (!entry) return false;
      pending.delete(id);
      clearTimeout(entry.timer);
      sendOutput('agent-permission-resolved', { id, answer: String(answer || '') });
      entry.resolve(String(answer || ''));
      return true;
    },

    /** Deny every pending prompt (called on claude-stop). */
    abortAll() {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        sendOutput('agent-permission-resolved', { id, answer: 'aborted' });
        entry.resolve('');
      }
      pending.clear();
    },

    /** Number of prompts currently awaiting an answer (for tests/debugging). */
    pendingCount() {
      return pending.size;
    },
  };
}

module.exports = { createPermissionBroker, PROMPT_TIMEOUT_MS };
