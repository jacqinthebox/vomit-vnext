# Plan: Full IDE Features with LSP Integration

## Overview

Transform Vomit from a markdown editor into a full-featured code editor with IDE capabilities for DevOps/Infrastructure workflows.

## Target Languages (Priority Order)

1. **Terraform** (HCL) - Most important
2. **Python**
3. **Go**
4. **Kubernetes YAML**
5. **Ansible YAML**
6. **Shell/Bash**
7. **GitLab CI pipelines**
8. **GitHub Actions pipelines**
9. **Azure DevOps pipelines**

---

## Current State

### Existing Intellisense (`src/renderer/js/hints.js`)

- Static keyword-based completion (not context-aware)
- Hard-coded keyword lists for Python, Bash, Terraform, K8s YAML, Helm, Markdown
- "Anyword" hints scanning current document
- Manual trigger only (`Ctrl+J` / `Ctrl+Space`)
- No semantic understanding, no type inference, no go-to-definition

### Existing Syntax Highlighting

CodeMirror modes loaded:
- Python, Go, YAML, Shell, JavaScript, SQL, Dockerfile, CSS, HTML, Lua, C-like

**Missing**: HCL/Terraform mode (currently uses JavaScript as workaround)

---

## Implementation Plan

### Phase 1: LSP Infrastructure (Main Process)

**File**: `src/main/main.js`

Create `LSPManager` class:

```javascript
class LSPManager {
  constructor() {
    this.servers = new Map(); // language -> ChildProcess
  }

  async startServer(language, config) {
    // Spawn language server process
    // Handle JSON-RPC communication
    // Manage lifecycle (start/stop/restart)
  }

  async sendRequest(language, method, params) {
    // textDocument/completion
    // textDocument/hover
    // textDocument/definition
    // textDocument/references
  }

  handleNotification(language, method, params) {
    // textDocument/publishDiagnostics
  }
}
```

IPC Handlers to add:
- `lsp:initialize` - Start LSP for a language
- `lsp:completion` - Request completions
- `lsp:hover` - Request hover info
- `lsp:definition` - Go to definition
- `lsp:references` - Find references
- `lsp:diagnostics` - Receive errors/warnings
- `lsp:shutdown` - Stop LSP server

### Phase 2: Preload Bridge

**File**: `src/main/preload.js`

```javascript
// LSP methods
lspInitialize: (language, rootPath) => ipcRenderer.invoke('lsp:initialize', language, rootPath),
lspCompletion: (filePath, position) => ipcRenderer.invoke('lsp:completion', filePath, position),
lspHover: (filePath, position) => ipcRenderer.invoke('lsp:hover', filePath, position),
lspDefinition: (filePath, position) => ipcRenderer.invoke('lsp:definition', filePath, position),
lspDidOpen: (filePath, content, language) => ipcRenderer.send('lsp:didOpen', filePath, content, language),
lspDidChange: (filePath, content) => ipcRenderer.send('lsp:didChange', filePath, content),
lspDidClose: (filePath) => ipcRenderer.send('lsp:didClose', filePath),

// Events
ipcRenderer.on('lsp:diagnostics', (event, filePath, diagnostics) => {
  window.dispatchEvent(new CustomEvent('vomit:lsp-diagnostics', { detail: { filePath, diagnostics } }));
});
```

### Phase 3: Editor LSP Client (Renderer)

**File**: `src/renderer/js/editor.js`

```javascript
class LSPClient {
  constructor(editor) {
    this.editor = editor;
    this.diagnosticsMarkers = [];
  }

  async onFileOpen(filePath, content) {
    const language = this.detectLanguage(filePath);
    await window.vomit.lspDidOpen(filePath, content, language);
  }

  async onFileChange(filePath, content) {
    await window.vomit.lspDidChange(filePath, content);
  }

  async requestCompletion(filePath, position) {
    return await window.vomit.lspCompletion(filePath, position);
  }

  renderDiagnostics(diagnostics) {
    // Clear old markers
    // Add squiggly underlines for errors/warnings
  }
}
```

### Phase 4: Language Server Integration

#### 4.1 Terraform (HIGHEST PRIORITY)

**Server**: `terraform-ls` (official HashiCorp LSP)

**Installation**:
```bash
# macOS
brew install hashicorp/tap/terraform-ls

# Linux
# Download from https://releases.hashicorp.com/terraform-ls/
```

**Detection paths**:
```javascript
const terraformLsPaths = [
  '/opt/homebrew/bin/terraform-ls',
  '/usr/local/bin/terraform-ls',
  '/usr/bin/terraform-ls',
  `${process.env.HOME}/.local/bin/terraform-ls`
];
```

**Features**:
- Completion for resources, data sources, variables, outputs
- Go-to-definition for modules, variables
- Hover documentation from Terraform Registry
- Validation and diagnostics
- Format on save

**CodeMirror mode**: Need to add HCL mode (currently missing)
- Option: Use `codemirror-mode-hcl` package or create custom mode

#### 4.2 Python

**Server**: `pylsp` (python-lsp-server)

**Installation**: `pip install python-lsp-server[all]`

**Detection paths**:
```javascript
const pylspPaths = [
  `${process.env.HOME}/.local/bin/pylsp`,
  '/opt/homebrew/bin/pylsp',
  '/usr/local/bin/pylsp',
  '/usr/bin/pylsp'
];
```

**Features**:
- Jedi-based completion (context-aware)
- Pyflakes linting
- Rope refactoring
- Type hints support

#### 4.3 Go

**Server**: `gopls` (official Go LSP)

**Installation**: `go install golang.org/x/tools/gopls@latest`

**Detection paths**:
```javascript
const goplsPaths = [
  `${process.env.GOPATH || process.env.HOME + '/go'}/bin/gopls`,
  '/opt/homebrew/bin/gopls',
  '/usr/local/bin/gopls'
];
```

**Features**:
- Full completion with type info
- Go-to-definition across packages
- Find references
- Rename refactoring
- Format on save (gofmt)

#### 4.4 YAML (Kubernetes, Ansible, CI Pipelines)

**Server**: `yaml-language-server`

**Installation**: `npm install -g yaml-language-server`

**Detection paths**:
```javascript
const yamlLsPaths = [
  `${process.env.HOME}/.npm-global/bin/yaml-language-server`,
  '/opt/homebrew/bin/yaml-language-server',
  '/usr/local/bin/yaml-language-server'
];
```

**Schema Detection**:
```javascript
function detectYAMLSchema(filePath, content) {
  const basename = path.basename(filePath);
  const firstLines = content.split('\n').slice(0, 10).join('\n');

  // GitLab CI
  if (basename === '.gitlab-ci.yml' || basename.includes('gitlab-ci')) {
    return 'https://gitlab.com/gitlab-org/gitlab/-/raw/master/app/assets/javascripts/editor/schema/ci.json';
  }

  // GitHub Actions
  if (filePath.includes('.github/workflows/')) {
    return 'https://json.schemastore.org/github-workflow.json';
  }

  // Azure DevOps
  if (basename === 'azure-pipelines.yml' || basename.startsWith('azure-pipelines')) {
    return 'https://json.schemastore.org/azure-pipelines.json';
  }

  // Kubernetes
  if (firstLines.includes('apiVersion:') && firstLines.includes('kind:')) {
    return 'https://kubernetesjsonschema.dev/master/_definitions.json';
  }

  // Ansible
  if (filePath.includes('/ansible/') || filePath.includes('/playbooks/') ||
      firstLines.includes('hosts:') || firstLines.includes('tasks:')) {
    return 'https://raw.githubusercontent.com/ansible/ansible-lint/main/src/ansiblelint/schemas/ansible.json';
  }

  return null;
}
```

#### 4.5 Shell/Bash

**Server**: `bash-language-server`

**Installation**: `npm install -g bash-language-server`

**Features**:
- ShellCheck integration (linting)
- Completion for commands, variables
- Go-to-definition for functions

---

### Phase 5: Enhanced File Type Detection

**File**: `src/renderer/js/editor.js`

```javascript
const languageConfig = {
  // Terraform (PRIORITY)
  'tf':     { mode: 'hcl', lsp: 'terraform-ls', icon: 'terraform' },
  'tfvars': { mode: 'hcl', lsp: 'terraform-ls', icon: 'terraform' },
  'hcl':    { mode: 'hcl', lsp: 'terraform-ls', icon: 'terraform' },

  // Python
  'py':     { mode: 'python', lsp: 'pylsp', icon: 'python' },

  // Go
  'go':     { mode: 'go', lsp: 'gopls', icon: 'go' },

  // YAML (with schema detection)
  'yaml':   { mode: 'yaml', lsp: 'yaml-language-server', schemaDetect: true },
  'yml':    { mode: 'yaml', lsp: 'yaml-language-server', schemaDetect: true },

  // Shell
  'sh':     { mode: 'shell', lsp: 'bash-language-server', icon: 'shell' },
  'bash':   { mode: 'shell', lsp: 'bash-language-server', icon: 'shell' },
  'zsh':    { mode: 'shell', lsp: 'bash-language-server', icon: 'shell' },

  // Others
  'json':   { mode: 'javascript', lsp: null },
  'md':     { mode: 'yaml-frontmatter', lsp: null },
  'dockerfile': { mode: 'dockerfile', lsp: null },
};
```

---

### Phase 6: UI Enhancements

#### 6.1 Status Bar Updates

```html
<div id="statusbar">
  <span id="status-file">main.tf</span>
  <span id="status-language">Terraform</span>
  <span id="status-lsp" class="lsp-active" title="LSP Active">LSP</span>
  <span id="status-position">Ln 42, Col 15</span>
  <span id="status-errors" class="has-errors">2 errors</span>
</div>
```

#### 6.2 Problems Panel (Optional)

Add a collapsible problems panel showing all diagnostics:

```html
<div id="problems-panel" class="hidden">
  <div class="problems-header">
    <span>Problems</span>
    <span class="problems-count">3 errors, 2 warnings</span>
  </div>
  <div class="problems-list">
    <!-- Populated by LSP diagnostics -->
  </div>
</div>
```

#### 6.3 Completion Popup Enhancement

- Show type/kind icons
- Show documentation preview
- Keyboard navigation (already exists)

#### 6.4 Error Squigglies

```css
.lint-error {
  background: url("data:image/svg+xml,...") repeat-x bottom left;
  /* Red wavy underline */
}

.lint-warning {
  background: url("data:image/svg+xml,...") repeat-x bottom left;
  /* Yellow wavy underline */
}

.lint-info {
  text-decoration: underline dotted var(--accent-color);
}
```

---

### Phase 7: Keybindings

| Action | Keybinding | Notes |
|--------|------------|-------|
| Trigger Completion | `Ctrl+Space` | Already exists |
| Go to Definition | `Cmd+Click` or `F12` | New |
| Find References | `Shift+F12` | New |
| Hover Info | Mouse hover | New |
| Quick Fix | `Cmd+.` | New (if LSP supports) |
| Format Document | `Shift+Alt+F` | New |
| Rename Symbol | `F2` | New |

---

## Dependencies to Add

**package.json**:
```json
{
  "dependencies": {
    "vscode-languageserver-protocol": "^3.17.0",
    "vscode-jsonrpc": "^8.0.0"
  }
}
```

**Optional** (bundle these for out-of-box experience):
```json
{
  "dependencies": {
    "bash-language-server": "^5.0.0",
    "yaml-language-server": "^1.14.0"
  }
}
```

---

## Implementation Order

| Step | Task | Priority | Effort |
|------|------|----------|--------|
| 1 | Add HCL/Terraform CodeMirror mode | High | 0.5 day |
| 2 | LSP infrastructure in main.js | High | 2 days |
| 3 | Preload IPC bridges | High | 0.5 day |
| 4 | Terraform LSP integration | High | 1 day |
| 5 | Python LSP integration | Medium | 1 day |
| 6 | YAML LSP + schema detection | Medium | 1.5 days |
| 7 | Go LSP integration | Medium | 1 day |
| 8 | Bash LSP integration | Low | 0.5 day |
| 9 | Diagnostics UI (squigglies) | Medium | 1 day |
| 10 | Go-to-definition | Medium | 0.5 day |
| 11 | Hover tooltips | Low | 0.5 day |
| 12 | Status bar enhancements | Low | 0.5 day |
| 13 | Problems panel | Low | 1 day |
| 14 | Testing & polish | High | 2 days |

**Total estimated effort: 12-14 days**

---

## Graceful Degradation

If LSP servers are not installed:
1. Fall back to existing static keyword completion
2. Show notification: "Install terraform-ls for full IntelliSense"
3. Add menu item: "Help > Install Language Servers" with instructions

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/main/main.js` | Add LSPManager class, IPC handlers |
| `src/main/preload.js` | Add LSP IPC bridges |
| `src/renderer/js/editor.js` | LSP client, diagnostics, completion integration |
| `src/renderer/js/hints.js` | Replace with LSP-based completion |
| `src/renderer/css/styles.css` | Diagnostic squigglies, hover tooltips |
| `src/renderer/index.html` | Add HCL CodeMirror mode |
| `package.json` | Add LSP dependencies |

---

## Notes

- Windows support: May need different paths for language servers
- Memory: Each LSP server uses 100-300MB RAM
- Startup: Language servers need 1-5 seconds to initialize
- Consider lazy loading: Only start LSP when opening relevant file type
