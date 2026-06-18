// Command registry for the AI terminal slash commands.
// Each entry defines routing metadata and a handler that receives (args, ctx, cwd).
// ctx is the TerminalManager instance; cwd is provided only when requiresCwd is true.

const COMMAND_REGISTRY = [
  {
    name: '/new',
    description: 'Start a new conversation',
    args: 'none',
    argsHint: '',
    requiresCwd: false,
    async handler(args, ctx) {
      window.vomit.claudeClearHistory();
      await window.vomit.agentClearHistory();
      ctx.clearTerminal();
      ctx.appendTerminalOutput('New conversation started.', 'system');
      ctx.updateContextBar();
    }
  },
  {
    name: '/clear',
    description: 'Clear conversation history',
    args: 'none',
    argsHint: '',
    requiresCwd: false,
    async handler(args, ctx) {
      window.vomit.claudeClearHistory();
      await window.vomit.agentClearHistory();
      ctx.clearTerminal();
      ctx.appendTerminalOutput('Conversation cleared.', 'system');
      ctx.updateContextBar();
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
    name: '/pseudo deterministic',
    description: 'Fast deterministic repo/folder pseudonymization',
    args: 'optional',
    argsHint: '[folder-name]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.runPseudoRepo(cwd, args.trim() || null, 'deterministic', '/pseudo deterministic');
    }
  },
  {
    // Must be registered before /pseudo so the longer name matches first
    name: '/pseudo ai',
    description: 'Hybrid deterministic + AI repo/folder pseudonymization',
    args: 'optional',
    argsHint: '[folder-name]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.runPseudoRepo(cwd, args.trim() || null, 'ai', '/pseudo ai');
    }
  },
  {
    // Must be registered before /pseudo so the longer name matches first
    name: '/pseudo run',
    description: 'Pseudonymize repos in bucket (alias for deterministic)',
    args: 'optional',
    argsHint: '[folder-name]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.runPseudoRepo(cwd, args.trim() || null, 'deterministic', '/pseudo run');
    }
  },
  {
    // Must be registered before /pseudo so the longer name matches first
    name: '/pseudo all',
    description: 'Pseudonymize all files (legacy)',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.runPseudonymization(cwd);
    }
  },
  {
    name: '/pseudo map',
    description: 'Show current entity mapping',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.showPseudoMapping(cwd);
    }
  },
  {
    name: '/pseudo',
    description: 'Pseudonymize current document',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.pseudonymizeCurrentDoc(cwd);
    }
  },
  {
    name: '/depseudo',
    description: 'Reverse-map pseudo repo changes to real repo',
    args: 'optional',
    argsHint: '[repo-name]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      if (args.trim()) {
        await ctx.depseudoRepo(args.trim(), cwd);
      } else {
        await ctx.depseudonymizeCurrentDoc();
      }
    }
  },
  {
    name: '/index',
    description: 'Index bucket for RAG search',
    args: 'optional',
    argsHint: '[folder]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const targetPath = args ? `${cwd}/${args.replace(/^\//, '')}` : cwd;
      await ctx.indexFolderForRAG(cwd, targetPath, args || null);
    }
  },
  {
    name: '/reindex',
    description: 'Clear and rebuild bucket RAG index',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.reindexRAG(cwd);
    }
  },
  {
    name: '/rag',
    description: 'Search bucket RAG context',
    args: 'required',
    argsHint: '<query>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.searchWithRAG(args, cwd);
    }
  },
  {
    name: '/wiki',
    description: 'Wikilink commands (reindex, graph)',
    args: 'optional',
    argsHint: '[reindex|graph]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const sub = (args || '').trim().toLowerCase();
      if (sub === '' || sub === 'reindex' || sub === 'index') {
        await ctx.reindexWiki(cwd);
      } else if (sub === 'graph') {
        ctx.appendTerminalOutput('❯ /wiki graph', 'input');
        window.dispatchEvent(new CustomEvent('vomit:toggle-wiki-graph'));
      } else {
        ctx.appendTerminalOutput(`❯ /wiki ${args}`, 'input');
        ctx.appendTerminalOutput(`Unknown /wiki subcommand: ${sub}. Try: /wiki reindex | /wiki graph`, 'error');
      }
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
      await ctx.executeDocCommand(args, cwd);
    }
  },
  {
    name: '/help',
    description: 'Show available commands',
    args: 'none',
    argsHint: '',
    requiresCwd: false,
    async handler(args, ctx) {
      ctx.appendTerminalOutput('❯ /help', 'input');
      ctx.showAvailableCommands();
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

  // Enforce args policy — surface violations as terminal errors
  if (cmd.args === 'none' && parsed.args !== '') {
    ctx.appendTerminalOutput(`Error: Command ${cmd.name} does not accept arguments.`, 'error');
    return true;
  }
  if (cmd.args === 'required' && !parsed.args) {
    ctx.appendTerminalOutput(`Error: Command ${cmd.name} requires an argument. Usage: ${cmd.name} ${cmd.argsHint}.`, 'error');
    return true;
  }
  if (cmd.subcommands && parsed.args !== '' && !cmd.subcommands.includes(parsed.args)) {
    ctx.appendTerminalOutput(`Error: Unknown subcommand '${parsed.args}' for ${cmd.name}. Valid: ${cmd.subcommands.join(', ')}.`, 'error');
    return true;
  }

  let cwd = null;
  if (cmd.requiresCwd !== false) {
    cwd = ctx.state.projectRoot || ctx.state.currentDirectory;
    if (!cwd) {
      ctx.appendTerminalOutput('Error: No project folder open. Add or select a bucket from the Buckets menu first.', 'error');
      return true;
    }
  }

  await cmd.handler(parsed.args, ctx, cwd);
  return true;
}

window.TerminalCommands = { COMMAND_REGISTRY, parseCommand, dispatchCommand };
