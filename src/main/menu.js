// @ts-check
'use strict';

const { app, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let _state, _bus, _configStore;
// Store references to functions from main.js that menu items call
let _actions = {};

function register({ state, bus, configStore, actions }) {
  _state = state;
  _bus = bus;
  _configStore = configStore;
  _actions = actions;
}

function buildAISubmenu() {
  const submenu = [
    {
      label: 'Toggle AI Terminal',
      accelerator: 'CmdOrCtrl+J',
      click: () => {
        _bus.send('toggle-terminal');
      }
    },
    { type: 'separator' }
  ];

  const currentProvider = _configStore.getAIProvider();

  // Provider selection
  submenu.push({
    label: 'Ollama (local)',
    type: 'radio',
    checked: currentProvider === 'ollama',
    click: () => setAIProvider('ollama')
  });
  submenu.push({
    label: 'OpenAI-Compatible (e.g. MLX, vLLM, LM Studio)',
    type: 'radio',
    checked: currentProvider === 'openai-compatible',
    click: () => setAIProvider('openai-compatible')
  });
  submenu.push({ type: 'separator' });

  if (currentProvider === 'ollama') {
    // Add Ollama models if available
    if (_state.availableAITools.ollamaModels.length > 0) {
      for (const model of _state.availableAITools.ollamaModels) {
        submenu.push({
          label: model,
          type: 'radio',
          checked: _configStore.getOllamaModel() === model,
          click: () => setOllamaModel(model)
        });
      }
    } else if (_state.availableAITools.ollama) {
      submenu.push({ label: 'No models installed', enabled: false });
      submenu.push({ label: 'Run: ollama pull llama3.2', enabled: false });
    } else {
      submenu.push({ label: 'Ollama not installed', enabled: false });
      submenu.push({ label: 'Install from https://ollama.ai', enabled: false });
    }
  } else {
    // OpenAI-compatible: list saved endpoints as radios.
    const endpoints = _configStore.getOpenAIEndpoints();
    const activeIndex = _configStore.getActiveOpenAIEndpointIndex();
    if (endpoints.length === 0) {
      submenu.push({ label: 'No endpoints configured', enabled: false });
      submenu.push({ label: 'Use "Add OpenAI-Compatible Endpoint…" below', enabled: false });
    } else {
      endpoints.forEach((ep, idx) => {
        const label = ep.model ? `${ep.name} — ${ep.model}` : ep.name;
        submenu.push({
          label,
          type: 'radio',
          checked: idx === activeIndex,
          click: () => selectOpenAIEndpoint(idx)
        });
      });
    }
  }

  submenu.push({ type: 'separator' });
  submenu.push({
    label: 'Add OpenAI-Compatible Endpoint…',
    click: () => addOpenAIEndpoint()
  });

  const activeEp = _configStore.getActiveOpenAIEndpoint();
  if (activeEp) {
    submenu.push({
      label: `Edit "${activeEp.name}"…`,
      click: () => editActiveOpenAIEndpoint()
    });
    submenu.push({
      label: `Remove "${activeEp.name}"…`,
      click: () => removeActiveOpenAIEndpoint()
    });
  }
  submenu.push({
    label: 'Test AI Connection',
    click: () => testAIConnection()
  });

  submenu.push({ type: 'separator' });
  const tavilyKey = _configStore.getTavilyApiKey();
  submenu.push({
    label: tavilyKey ? 'Tavily API Key ✓' : 'Set Tavily API Key...',
    click: () => setTavilyApiKey()
  });

  return submenu;
}

function setAIProvider(provider) {
  _configStore.setAIProvider(provider);
  createMenu();
  const payload = { provider, model: _configStore.getActiveModel() };
  _bus.send('ai-provider-changed', payload);
  _bus.sendToTerminal('ai-provider-changed', payload);
  _bus.send('show-terminal');
}

function selectOpenAIEndpoint(index) {
  _configStore.setActiveOpenAIEndpointIndex(index);
  _configStore.setAIProvider('openai-compatible');
  createMenu();
  const ep = _configStore.getActiveOpenAIEndpoint();
  const payload = { provider: 'openai-compatible', model: ep ? ep.model : '' };
  _bus.send('ai-provider-changed', payload);
  _bus.sendToTerminal('ai-provider-changed', payload);
  _bus.send('show-terminal');
}

function escapeForAppleScript(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function promptString(message, defaultValue, { hidden = false } = {}) {
  const { exec } = require('child_process');
  const msg = escapeForAppleScript(message);
  const def = escapeForAppleScript(defaultValue || '');
  const hiddenArg = hidden ? ' with hidden answer' : '';
  const script = `osascript -e 'display dialog "${msg}" default answer "${def}"${hiddenArg}'`;
  return new Promise((resolve) => {
    exec(script, (err, stdout) => {
      if (err) return resolve(null); // cancelled
      const match = stdout.match(/text returned:(.*)/);
      resolve(match ? match[1].trim() : null);
    });
  });
}

async function confirmDialog(message, detail) {
  const { dialog } = require('electron');
  const r = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Remove'],
    defaultId: 0,
    cancelId: 0,
    message,
    detail: detail || ''
  });
  return r.response === 1;
}

// Prompt for a full endpoint (name, baseUrl, apiKey, model, contextLength).
// Returns the new endpoint object, or null if the user cancels at any step.
// Default values pre-fill prompts (handy for "Edit" vs. "Add"). The
// contextLength prompt accepts an empty string to mean "use 32k default".
async function promptEndpoint(defaults) {
  const d = defaults || {};
  const name = await promptString(
    'Endpoint name (e.g. "MLX Qwen3-Coder"):',
    d.name || ''
  );
  if (name === null) return null;

  const baseUrl = await promptString(
    'Base URL (e.g. http://127.0.0.1:8000/v1):',
    d.baseUrl || _configStore.getOpenAIBaseUrl()
  );
  if (baseUrl === null) return null;

  const apiKey = await promptString(
    'API key (use "dummy" for local servers like mlx_lm.server):',
    d.apiKey || _configStore.getOpenAIApiKey(),
    { hidden: true }
  );
  if (apiKey === null) return null;

  const model = await promptString(
    'Model id (e.g. mlx-community/Qwen3-Coder-Next-4bit):',
    d.model || ''
  );
  if (model === null) return null;

  const ctxDefault = typeof d.contextLength === 'number' && d.contextLength > 0
    ? String(d.contextLength)
    : '';
  const ctxRaw = await promptString(
    'Context length in tokens (optional, e.g. 262144; leave empty for 32768 default):',
    ctxDefault
  );
  if (ctxRaw === null) return null;
  const ctxNum = parseInt(String(ctxRaw).replace(/[_,\s]/g, ''), 10);
  const contextLength = Number.isFinite(ctxNum) && ctxNum > 0 ? ctxNum : undefined;

  return {
    name: name || baseUrl,
    baseUrl,
    apiKey,
    model,
    contextLength
  };
}

async function addOpenAIEndpoint() {
  const ep = await promptEndpoint(null);
  if (!ep) return;
  const newIndex = _configStore.addOpenAIEndpoint(ep);
  _configStore.setActiveOpenAIEndpointIndex(newIndex);
  _configStore.setAIProvider('openai-compatible');
  createMenu();
  const payload = { provider: 'openai-compatible', model: ep.model };
  _bus.send('ai-provider-changed', payload);
  _bus.sendToTerminal('ai-provider-changed', payload);
}

async function editActiveOpenAIEndpoint() {
  const idx = _configStore.getActiveOpenAIEndpointIndex();
  const current = _configStore.getActiveOpenAIEndpoint();
  if (!current) return addOpenAIEndpoint();
  const ep = await promptEndpoint(current);
  if (!ep) return;
  _configStore.updateOpenAIEndpoint(idx, ep);
  createMenu();
  const payload = { provider: 'openai-compatible', model: ep.model };
  _bus.send('ai-provider-changed', payload);
  _bus.sendToTerminal('ai-provider-changed', payload);
}

async function removeActiveOpenAIEndpoint() {
  const current = _configStore.getActiveOpenAIEndpoint();
  if (!current) return;
  const ok = await confirmDialog(
    `Remove endpoint "${current.name}"?`,
    'This only removes the entry from the AI menu. The remote server is not affected.'
  );
  if (!ok) return;
  _configStore.removeOpenAIEndpoint(_configStore.getActiveOpenAIEndpointIndex());
  // If no endpoints left, fall back to Ollama so the menu stays usable.
  if (_configStore.getOpenAIEndpoints().length === 0) {
    _configStore.setAIProvider('ollama');
  }
  createMenu();
  const payload = {
    provider: _configStore.getAIProvider(),
    model: _configStore.getActiveModel()
  };
  _bus.send('ai-provider-changed', payload);
  _bus.sendToTerminal('ai-provider-changed', payload);
}

async function testAIConnection() {
  const aiProviders = require('./services/aiProviders');
  const cfg = aiProviders.getActiveProviderConfig(_configStore);
  const result = await aiProviders.testConnection(cfg);
  const { dialog } = require('electron');
  dialog.showMessageBox({
    type: result.ok ? 'info' : 'error',
    title: 'AI Connection Test',
    message: result.ok ? 'Connection successful' : 'Connection failed',
    detail: `Provider: ${cfg.provider}\n${result.message}`
  });
}

// Prompt user to enter Tavily API key
async function setTavilyApiKey() {
  const { exec } = require('child_process');
  const currentKey = _configStore.getTavilyApiKey();
  const promptMsg = currentKey
    ? `Enter new Tavily API key (current: ${currentKey.substring(0, 8)}...):\\nLeave blank to clear.`
    : 'Enter your Tavily API key:';

  const script = `osascript -e 'display dialog "${promptMsg}" default answer "" with hidden answer'`;

  return new Promise((resolve) => {
    exec(script, (err, stdout) => {
      if (err) return resolve(); // user cancelled
      const match = stdout.match(/text returned:(.*)/);
      if (match) {
        const value = match[1].trim();
        _configStore.setTavilyApiKey(value || '');
        createMenu();
      }
      resolve();
    });
  });
}

// Set Ollama model and show terminal
function setOllamaModel(model) {
  _configStore.setOllamaModel(model);
  // Selecting an Ollama model implies the user wants the Ollama provider.
  _configStore.setAIProvider('ollama');
  createMenu();

  // Notify renderer and show terminal
  _bus.send('ai-provider-changed', { provider: 'ollama', model });
  _bus.sendToTerminal('ai-provider-changed', { provider: 'ollama', model });
  _bus.send('show-terminal');
}

// Set Mermaid curve style
function setMermaidCurve(curve) {
  _configStore.setMermaidCurve(curve);
  createMenu();
  _bus.send('mermaid-curve-changed', curve);
}

// Set font size
function setFontSize(size) {
  _configStore.setFontSize(size);
  createMenu();
  _bus.send('font-size-changed', size);
}

function buildBucketsSubmenu() {
  const submenu = [];
  const buckets = _configStore.getBuckets();
  const activeIndex = _configStore.getActiveBucketIndex();

  // Add bucket radio items
  buckets.forEach((bucket, index) => {
    submenu.push({
      label: bucket.name,
      type: 'radio',
      checked: index === activeIndex,
      click: () => switchBucket(index)
    });
  });

  // Separators and actions
  if (buckets.length > 0) {
    submenu.push({ type: 'separator' });
  }

  submenu.push({
    label: 'Add Bucket...',
    click: () => addBucket()
  });

  if (buckets.length > 0) {
    submenu.push({ type: 'separator' });
    const activeBucket = buckets[activeIndex];
    submenu.push({
      label: `Remove "${activeBucket?.name}"...`,
      click: () => removeBucket(activeIndex)
    });
  }

  return submenu;
}

async function switchBucket(index) {
  if (_actions.switchBucket) {
    _actions.switchBucket(index);
  }
}

async function addBucket() {
  if (_actions.addBucket) {
    await _actions.addBucket();
  }
}

async function removeBucket(index) {
  if (_actions.removeBucket) {
    await _actions.removeBucket(index);
  }
}

function createMenu() {
  const template = [
    {
      label: 'Vomit',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            _bus.send('new-tab');
          }
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => _actions.createNewEditorWindow()
        },
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => _actions.newFile()
        },
        {
          label: 'New Presentation',
          accelerator: 'CmdOrCtrl+Alt+N',
          click: () => _actions.newPresentation()
        },
        {
          label: 'New Folder',
          accelerator: 'CmdOrCtrl+Alt+Shift+N',
          click: () => {
            _bus.send('new-folder');
          }
        },
        { type: 'separator' },
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => _actions.openFile()
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            _bus.send('close-tab');
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => _actions.saveFile()
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => _actions.saveFileAs()
        },
        { type: 'separator' },
        {
          label: 'Export to PDF...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => _actions.exportToPDF()
        },
        { type: 'separator' },
        {
          label: 'Auto Save',
          type: 'checkbox',
          checked: _state.autoSaveEnabled,
          click: (menuItem) => {
            _state.autoSaveEnabled = menuItem.checked;
            _configStore.setAutoSaveEnabled(_state.autoSaveEnabled);
            _bus.send('auto-save-changed', _state.autoSaveEnabled);
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in File',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            _bus.send('find-in-file');
          }
        },
        {
          label: 'Find and Replace',
          accelerator: 'CmdOrCtrl+Alt+F',
          click: () => {
            _bus.send('find-and-replace');
          }
        },
        {
          label: 'Search in Files',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            _bus.send('toggle-search');
          }
        }
      ]
    },
    {
      label: 'Format',
      submenu: [
        {
          label: 'Bold',
          accelerator: 'CmdOrCtrl+B',
          click: () => _actions.sendFormatCommand('bold')
        },
        {
          label: 'Italic',
          accelerator: 'CmdOrCtrl+I',
          click: () => _actions.sendFormatCommand('italic')
        },
        {
          label: 'Code',
          accelerator: 'CmdOrCtrl+J',
          click: () => _actions.sendFormatCommand('code')
        },
        {
          label: 'Code Block',
          accelerator: 'CmdOrCtrl+M',
          click: () => _actions.sendFormatCommand('codeBlock')
        },
        {
          label: 'Link',
          accelerator: 'CmdOrCtrl+K',
          click: () => _actions.sendFormatCommand('link')
        },
        {
          label: 'Insert Table',
          click: () => _actions.sendFormatCommand('table')
        },
        {
          label: 'Format Table',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => _actions.sendFormatCommand('formatTable')
        },
        {
          label: 'Toggle Todo',
          click: () => _actions.sendFormatCommand('todo')
        },
        { type: 'separator' },
        {
          label: 'Heading 1',
          accelerator: 'CmdOrCtrl+Shift+1',
          click: () => _actions.sendFormatCommand('h1')
        },
        {
          label: 'Heading 2',
          accelerator: 'CmdOrCtrl+Shift+2',
          click: () => _actions.sendFormatCommand('h2')
        },
        {
          label: 'Heading 3',
          accelerator: 'CmdOrCtrl+Shift+3',
          click: () => _actions.sendFormatCommand('h3')
        },
        { type: 'separator' },
        {
          label: 'Bullet List',
          accelerator: 'CmdOrCtrl+Shift+8',
          click: () => _actions.sendFormatCommand('bullet')
        },
        {
          label: 'Numbered List',
          accelerator: 'CmdOrCtrl+Shift+9',
          click: () => _actions.sendFormatCommand('numbered')
        },
        {
          label: 'Quote',
          accelerator: "CmdOrCtrl+'",
          click: () => _actions.sendFormatCommand('quote')
        },
        {
          label: 'Horizontal Rule',
          accelerator: 'CmdOrCtrl+-',
          click: () => _actions.sendFormatCommand('hr')
        },
        { type: 'separator' },
        {
          label: 'Insert Slide',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => _actions.sendFormatCommand('slide')
        },
        { type: 'separator' },
        {
          label: 'Insert Date Heading',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => _actions.sendFormatCommand('dateHeading')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette...',
          accelerator: 'CmdOrCtrl+.',
          click: () => {
            _bus.send('show-command-palette');
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Preview',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            _bus.send('toggle-preview');
          }
        },
        {
          label: 'Toggle Outline',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            _bus.send('toggle-outline');
          }
        },
        {
          label: 'Toggle Right Outline',
          accelerator: 'CmdOrCtrl+Alt+O',
          click: () => {
            _bus.send('toggle-right-outline');
          }
        },
        {
          label: 'Wiki Graph',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => {
            _bus.send('toggle-wiki-graph');
          }
        },
        {
          label: 'Toggle Files',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            _bus.send('toggle-files');
          }
        },
        {
          label: 'Refresh File Tree',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            _bus.send('refresh-file-tree');
          }
        },
        {
          label: 'Toggle Tags',
          click: () => {
            _bus.send('toggle-tags');
          }
        },
        {
          label: 'Toggle Todos',
          click: () => {
            _bus.send('toggle-todos');
          }
        },
        {
          label: 'Show Images Folder',
          type: 'checkbox',
          checked: _configStore.getShowImagesFolder(),
          click: () => {
            _configStore.setShowImagesFolder(!_configStore.getShowImagesFolder());
            createMenu();
            _bus.send('refresh-file-tree');
          }
        },
        { type: 'separator' },
        {
          label: 'Sort by Name',
          type: 'radio',
          checked: _configStore.getFileSortOrder() === 'name',
          click: () => {
            _configStore.setFileSortOrder('name');
            createMenu();
            _bus.send('sort-order-changed', 'name');
          }
        },
        {
          label: 'Sort by Modified Date',
          type: 'radio',
          checked: _configStore.getFileSortOrder() === 'modified',
          click: () => {
            _configStore.setFileSortOrder('modified');
            createMenu();
            _bus.send('sort-order-changed', 'modified');
          }
        },
        {
          label: 'Toggle Word Wrap',
          accelerator: 'Alt+Z',
          click: () => {
            _bus.send('toggle-word-wrap');
          }
        },
        { type: 'separator' },
        {
          label: 'Mermaid Arrows',
          submenu: [
            {
              label: 'Straight (Linear)',
              type: 'radio',
              checked: _configStore.getMermaidCurve() === 'linear',
              click: () => setMermaidCurve('linear')
            },
            {
              label: 'Right Angles (Step)',
              type: 'radio',
              checked: _configStore.getMermaidCurve() === 'stepBefore',
              click: () => setMermaidCurve('stepBefore')
            },
            {
              label: 'Curved (Basis)',
              type: 'radio',
              checked: _configStore.getMermaidCurve() === 'basis',
              click: () => setMermaidCurve('basis')
            }
          ]
        },
        {
          label: 'Font Size',
          submenu: [
            {
              label: '11px (Compact)',
              type: 'radio',
              checked: _configStore.getFontSize() === 11,
              click: () => setFontSize(11)
            },
            {
              label: '12px (Dense)',
              type: 'radio',
              checked: _configStore.getFontSize() === 12,
              click: () => setFontSize(12)
            },
            {
              label: '13px (Small)',
              type: 'radio',
              checked: _configStore.getFontSize() === 13,
              click: () => setFontSize(13)
            },
            {
              label: '14px (Default)',
              type: 'radio',
              checked: _configStore.getFontSize() === 14,
              click: () => setFontSize(14)
            },
            {
              label: '16px (Large)',
              type: 'radio',
              checked: _configStore.getFontSize() === 16,
              click: () => setFontSize(16)
            },
            {
              label: '18px (Extra Large)',
              type: 'radio',
              checked: _configStore.getFontSize() === 18,
              click: () => setFontSize(18)
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Toggle Line Numbers',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            _bus.send('toggle-line-numbers');
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Shell Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => {
            _bus.send('toggle-shell-terminal');
          }
        },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: () => {
            _bus.send('next-tab');
          }
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: () => {
            _bus.send('prev-tab');
          }
        },
        {
          label: 'Toggle Sidebar Focus',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            _bus.send('toggle-pane-focus');
          }
        },
        {
          label: 'Go to...',
          submenu: [
            {
              label: 'Parent Folder',
              accelerator: 'CmdOrCtrl+Up',
              click: () => {
                _bus.send('navigate-parent');
              }
            },
            { type: 'separator' },
            ...[2,3,4,5,6,7,8].map(n => ({
              label: `Tab ${n - 1}`,
              accelerator: `CmdOrCtrl+${n}`,
              click: () => {
                _bus.send('go-to-tab', n - 1);
              }
            })),
            {
              label: 'Last Tab',
              accelerator: 'CmdOrCtrl+9',
              click: () => {
                _bus.send('go-to-tab', 9);
              }
            }
          ]
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Presentation',
      submenu: [
        {
          label: 'Start Presentation',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => _actions.startPresentation()
        },
        {
          label: 'Start with Presenter View',
          accelerator: 'CmdOrCtrl+Alt+P',
          click: () => _actions.startPresentationWithPresenter()
        },
        { type: 'separator' },
        {
          label: 'End Presentation',
          accelerator: 'Escape',
          click: () => _actions.endPresentation()
        }
      ]
    },
    {
      label: 'Theme',
      submenu: [
        { label: 'Default', click: () => _actions.setTheme('default') },
        { label: 'Dark', click: () => _actions.setTheme('dark') },
        { label: 'Catppuccin', click: () => _actions.setTheme('catppuccin') },
        { label: 'Nord', click: () => _actions.setTheme('nord') },
        { label: 'Tokyo Night', click: () => _actions.setTheme('tokyo-night') },
        { label: 'Tokyo Night Light', click: () => _actions.setTheme('tokyo-night-light') },
        { label: 'Solarized Dark', click: () => _actions.setTheme('solarized') }
      ]
    },
    {
      label: 'Buckets',
      submenu: buildBucketsSubmenu()
    },
    {
      label: 'AI',
      submenu: buildAISubmenu()
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          accelerator: 'CmdOrCtrl+Shift+/',
          click: () => {
            // Load manual.md and open in documentation window
            const manualPath = path.join(app.getAppPath(), 'manual.md');
            try {
              const content = fs.readFileSync(manualPath, 'utf8');
              _actions.showDocumentation(content);
            } catch (err) {
              _actions.showDocumentation('# Documentation\n\nManual not found.');
            }
          }
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            _bus.send('show-shortcuts');
          }
        },
        { type: 'separator' },
        {
          label: 'Vomit on GitHub',
          click: () => _actions.showHelp()
        }
      ]
    }
  ];

  const builtMenu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(builtMenu);
}

module.exports = { register, createMenu, setOllamaModel };
