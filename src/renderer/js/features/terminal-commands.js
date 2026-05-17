// Command registry for the AI terminal slash commands.
// Each entry defines routing metadata and a handler that receives (args, ctx, cwd).
// ctx is the TerminalManager instance; cwd is provided only when requiresCwd is true.

const COMMAND_REGISTRY = [
  {
    name: '/new',
    description: 'Start a new conversation',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx) {
      window.vomit.claudeClearHistory();
      ctx.clearTerminal();
      ctx.appendTerminalOutput('New conversation started.', 'system');
    }
  },
  {
    name: '/write-new',
    description: 'Create new file with AI response',
    args: 'required',
    argsHint: '<prompt>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.executeWriteCommand(args, 'new', cwd);
    }
  },
  {
    name: '/write',
    description: 'Insert AI response at cursor position',
    args: 'required',
    argsHint: '<prompt>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.executeWriteCommand(args, 'cursor', cwd);
    }
  },
  {
    name: '/rewrite',
    description: 'Replace selection with AI response',
    args: 'required',
    argsHint: '<prompt>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.executeWriteCommand(args, 'replace', cwd);
    }
  },
  {
    name: '/append',
    description: 'Add AI response at end of document',
    args: 'required',
    argsHint: '<prompt>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.executeWriteCommand(args, 'append', cwd);
    }
  },
  {
    // Must be registered before /pseudo so the longer name matches first
    name: '/pseudo all',
    description: 'Pseudonymize all files',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.runPseudonymization(cwd);
    }
  },
  {
    name: '/pseudo',
    description: 'Pseudonymize current document',
    args: 'optional',
    argsHint: '',
    subcommands: ['doc'],
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.pseudonymizeCurrentDoc(cwd);
    }
  },
  {
    name: '/depseudo',
    description: 'Restore original document',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.depseudonymizeCurrentDoc();
    }
  },
  {
    name: '/index',
    description: 'Index folder for RAG search',
    args: 'optional',
    argsHint: '[folder]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const targetPath = args ? `${cwd}/${args}` : cwd;
      await ctx.indexFolderForRAG(cwd, targetPath, args || null);
    }
  },
  {
    name: '/rag',
    description: 'Search with RAG context',
    args: 'required',
    argsHint: '<query>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.searchWithRAG(args, cwd);
    }
  },
  {
    name: '/agent',
    description: 'Run in agent mode with tools',
    args: 'required',
    argsHint: '<prompt>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.executeAgentCommand(args, cwd);
    }
  },
  {
    name: '/presentation',
    description: 'Generate a presentation',
    args: 'required',
    argsHint: '<topic>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.generatePresentation(args, cwd);
    }
  },
  {
    name: '/doc',
    description: 'Ask AI about current document',
    args: 'required',
    argsHint: '<prompt>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const docContent = ctx.host.getContent();
      const finalCommand = `Here is the document I'm working on:\n\n---\n${docContent}\n---\n\nUser request: ${args}`;
      ctx.appendTerminalOutput(`❯ ${args} (with document context)`, 'input');
      ctx.state.isClaudeRunning = true;
      ctx.terminalStop.classList.remove('hidden');
      try {
        await window.vomit.claudeExecute(finalCommand, cwd);
      } catch (err) {
        ctx.appendTerminalOutput(`Error: ${err.message}`, 'error');
        ctx.state.isClaudeRunning = false;
        ctx.terminalStop.classList.add('hidden');
      }
    }
  },
];

// Sorted by name length descending so the most specific prefix always wins
// (e.g. /write-new before /write, /pseudo all before /pseudo).
const _sortedRegistry = [...COMMAND_REGISTRY].sort((a, b) => b.name.length - a.name.length);

/**
 * Parses a raw terminal input string into a { name, args } object.
 * Returns null when the input is not a recognized slash command.
 */
function parseCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  for (const cmd of _sortedRegistry) {
    if (trimmed === cmd.name) {
      return { name: cmd.name, args: '' };
    }
    if (trimmed.startsWith(cmd.name + ' ')) {
      return { name: cmd.name, args: trimmed.slice(cmd.name.length + 1).trim() };
    }
  }

  return null;
}

/**
 * Validates argument policy and dispatches to the matching command handler.
 * Returns true when the command was handled (even if it showed an error),
 * false when the input should fall through to plain AI execution.
 * ctx is the TerminalManager instance.
 */
async function dispatchCommand(parsed, ctx) {
  const cmd = COMMAND_REGISTRY.find(c => c.name === parsed.name);
  if (!cmd) return false;

  // Enforce args policy — preserve original fallthrough behavior for edge cases
  if (cmd.args === 'none' && parsed.args !== '') return false;
  if (cmd.args === 'required' && !parsed.args) return false;
  if (cmd.subcommands && parsed.args !== '' && !cmd.subcommands.includes(parsed.args)) return false;

  let cwd = null;
  if (cmd.requiresCwd !== false) {
    cwd = ctx.state.projectRoot || ctx.state.currentDirectory;
    if (!cwd) {
      ctx.appendTerminalOutput('Error: No project folder open. Open a folder first with Cmd+Alt+O.', 'error');
      return true;
    }
  }

  await cmd.handler(parsed.args, ctx, cwd);
  return true;
}

window.TerminalCommands = { COMMAND_REGISTRY, parseCommand, dispatchCommand };
