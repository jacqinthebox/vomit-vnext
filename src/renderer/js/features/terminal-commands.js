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
    },
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
    },
  },
  // ---- Pseudonymization -------------------------------------------------
  // Commands are named by SCOPE: /pseudo (current document), /pseudo-selection
  // (selected text), /pseudo-repo (repos/folders in the bucket). The engine is
  // chosen with the --ai flag (default is the fast, offline deterministic scan).
  // Reverse anything with /pseudo-restore. Legacy names are kept as hidden
  // aliases further down so existing muscle memory and scripts keep working.
  {
    name: '/pseudo-selection',
    description:
      'Pseudonymize the selection (whole doc if none). Prints to the terminal only, disk untouched. --ai = smart scan',
    args: 'optional',
    argsHint: '[--ai]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const { ai } = ctx.parsePseudoArgs(args);
      await ctx.pseudonymizeSelection(cwd, ai ? 'ai' : 'deterministic');
    },
  },
  {
    name: '/pseudo-restore',
    description:
      'Undo pseudonymization: a pseudo repo if named, else the current document/selection',
    args: 'optional',
    argsHint: '[repo-name]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const { folder } = ctx.parsePseudoArgs(args);
      if (folder) {
        await ctx.depseudoRepo(folder, cwd);
        return;
      }
      // No folder: restore the open *-pseudo file if that's what's open,
      // otherwise fall back to the session/selection text restore.
      const cf = ctx.state.currentFilePath;
      const base = cf ? window.PathUtils.basename(cf).replace(/\.[^.]*$/, '') : '';
      if (base.endsWith('-pseudo')) {
        await ctx.depseudonymizeCurrentDoc();
      } else {
        await ctx.depseudonymizeSelection();
      }
    },
  },
  {
    name: '/pseudo-repo',
    description:
      'Pseudonymize repos/folders into pseudo/<name>/. Bare = all git repos, --all = every folder, --ai = smart scan',
    args: 'optional',
    argsHint: '[folder] [--all] [--ai] [--customer "Name[=Replacement]"]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const { folder, customers, ai, all } = ctx.parsePseudoArgs(args);
      await ctx.runPseudoRepo(cwd, folder, ai ? 'ai' : 'deterministic', '/pseudo-repo', customers, {
        all,
      });
    },
  },
  {
    name: '/pseudo-map',
    description: 'Show the real-name to replacement mapping',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.showPseudoMapping(cwd);
    },
  },
  {
    name: '/pseudo',
    description:
      'Pseudonymize the current document into a -pseudo copy. --ai = smart scan. --customer "Acme" or "Acme=Globex" forces a name',
    args: 'optional',
    argsHint: '[--ai] [--customer "Name[=Replacement]"]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const { folder, customers, ai } = ctx.parsePseudoArgs(args);
      const token = (folder || '').toLowerCase();
      // Default is the fast deterministic scan. --ai (or the legacy positional
      // "ai") selects the AI engine; "deterministic"/"det"/"fast" are accepted
      // as legacy no-ops since deterministic is now the default.
      const mode = ai || token === 'ai' ? 'ai' : 'deterministic';
      await ctx.pseudonymizeCurrentDoc(cwd, mode, customers);
    },
  },

  // ---- Legacy aliases (hidden from picker/help; kept for compatibility) ----
  {
    name: '/pseudo-deterministic',
    hidden: true,
    description: 'Alias for /pseudo-repo (deterministic scan)',
    args: 'optional',
    argsHint: '[folder] [--all] [--customer "Name"]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const { folder, customers, all } = ctx.parsePseudoArgs(args);
      await ctx.runPseudoRepo(cwd, folder, 'deterministic', '/pseudo-deterministic', customers, {
        all,
      });
    },
  },
  {
    name: '/pseudo-ai',
    hidden: true,
    description: 'Alias for /pseudo-repo --ai',
    args: 'optional',
    argsHint: '[folder] [--all] [--customer "Name"]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const { folder, customers, all } = ctx.parsePseudoArgs(args);
      await ctx.runPseudoRepo(cwd, folder, 'ai', '/pseudo-ai', customers, { all });
    },
  },
  {
    name: '/pseudo-run',
    hidden: true,
    description: 'Alias for /pseudo-repo',
    args: 'optional',
    argsHint: '[folder] [--all] [--customer "Name"]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const { folder, customers, all } = ctx.parsePseudoArgs(args);
      await ctx.runPseudoRepo(cwd, folder, 'deterministic', '/pseudo-run', customers, { all });
    },
  },
  {
    name: '/pseudo-text',
    hidden: true,
    description: 'Alias for /pseudo-selection',
    args: 'none',
    argsHint: '',
    requiresCwd: false,
    async handler(args, ctx, cwd) {
      await ctx.pseudonymizeSelection(cwd, 'deterministic');
    },
  },
  {
    name: '/pseudo-text-ai',
    hidden: true,
    description: 'Alias for /pseudo-selection --ai',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.pseudonymizeSelection(cwd, 'ai');
    },
  },
  {
    name: '/pseudo-depseudo-text',
    hidden: true,
    description: 'Alias for /pseudo-restore (selected text)',
    args: 'none',
    argsHint: '',
    requiresCwd: false,
    async handler(args, ctx) {
      await ctx.depseudonymizeSelection();
    },
  },
  {
    name: '/pseudo-depseudo',
    hidden: true,
    description: 'Alias for /pseudo-restore',
    args: 'optional',
    argsHint: '[repo-name]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const { folder } = ctx.parsePseudoArgs(args);
      if (folder) {
        await ctx.depseudoRepo(folder, cwd);
      } else {
        await ctx.depseudonymizeCurrentDoc();
      }
    },
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
    },
  },
  {
    name: '/reindex',
    description: 'Clear and rebuild bucket RAG index',
    args: 'none',
    argsHint: '',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.reindexRAG(cwd);
    },
  },
  {
    name: '/rag',
    description: 'Search bucket RAG context',
    args: 'required',
    argsHint: '<query>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.searchWithRAG(args, cwd);
    },
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
        ctx.appendTerminalOutput(
          `Unknown /wiki subcommand: ${sub}. Try: /wiki reindex | /wiki graph`,
          'error',
        );
      }
    },
  },
  {
    name: '/okf',
    description: 'Export bucket as an OKF bundle (tar.gz)',
    args: 'optional',
    argsHint: '[export]',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      const sub = (args || '').trim().toLowerCase() || 'export';
      ctx.appendTerminalOutput(`❯ /okf ${sub}`, 'input');
      if (sub !== 'export') {
        ctx.appendTerminalOutput(`Unknown /okf subcommand: ${sub}. Try: /okf export`, 'error');
        return;
      }
      ctx.appendTerminalOutput(
        'Exporting bucket as an OKF bundle (type: stamped, wikilinks rewritten)...',
        'system',
      );
      const result = await window.vomit.okfExport(cwd);
      if (result.success) {
        const brokenNote = result.brokenLinks
          ? `, ${result.brokenLinks} broken wikilink(s) left as-is`
          : '';
        ctx.appendTerminalOutput(
          `✓ ${result.notes} note(s) exported — ${result.stamped} stamped with type:, ${result.linksRewritten} wikilink(s) rewritten${brokenNote}`,
          'system',
        );
        ctx.appendTerminalOutput(`Bundle: ${result.output}`, 'system');
      } else {
        ctx.appendTerminalOutput(`✗ Export failed: ${result.error}`, 'error');
      }
    },
  },
  {
    name: '/presentation',
    description: 'Generate a presentation',
    args: 'required',
    argsHint: '<topic>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.generatePresentation(args, cwd);
    },
  },
  {
    name: '/doc',
    description: 'Ask AI about current document',
    args: 'required',
    argsHint: '<prompt>',
    requiresCwd: true,
    async handler(args, ctx, cwd) {
      await ctx.executeDocCommand(args, cwd);
    },
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
    },
  },
];

// Sorted by name length descending so the most specific prefix always wins
// (e.g. /pseudo-ai before /pseudo).
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
  const cmd = COMMAND_REGISTRY.find((c) => c.name === parsed.name);
  if (!cmd) return false;

  // Enforce args policy — surface violations as terminal errors
  if (cmd.args === 'none' && parsed.args !== '') {
    ctx.appendTerminalOutput(`Error: Command ${cmd.name} does not accept arguments.`, 'error');
    return true;
  }
  if (cmd.args === 'required' && !parsed.args) {
    ctx.appendTerminalOutput(
      `Error: Command ${cmd.name} requires an argument. Usage: ${cmd.name} ${cmd.argsHint}.`,
      'error',
    );
    return true;
  }
  if (cmd.subcommands && parsed.args !== '' && !cmd.subcommands.includes(parsed.args)) {
    ctx.appendTerminalOutput(
      `Error: Unknown subcommand '${parsed.args}' for ${cmd.name}. Valid: ${cmd.subcommands.join(', ')}.`,
      'error',
    );
    return true;
  }

  let cwd = null;
  if (cmd.requiresCwd !== false) {
    cwd = ctx.state.projectRoot || ctx.state.currentDirectory;
    if (!cwd) {
      ctx.appendTerminalOutput(
        'Error: No project folder open. Add or select a bucket from the Buckets menu first.',
        'error',
      );
      return true;
    }
  }

  await cmd.handler(parsed.args, ctx, cwd);
  return true;
}

window.TerminalCommands = { COMMAND_REGISTRY, parseCommand, dispatchCommand };
