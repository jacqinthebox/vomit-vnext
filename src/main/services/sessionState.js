// @ts-check
'use strict';

const EventEmitter = require('events');

class SessionState extends EventEmitter {
  constructor() {
    super();
    /** @type {string|null} */
    this._currentFilePath = null;
    /** @type {string} */
    this._currentContent = '';
    /** @type {string|null} */
    this._currentProjectRoot = null;
    /** @type {string|null} */
    this._currentTheme = null;
    /** @type {boolean} */
    this._autoSaveEnabled = true;
    /** @type {string|null} */
    this._watchedFilePath = null;
    /** @type {number|null} */
    this._lastKnownMtime = null;
    /** @type {import('child_process').ChildProcess|null} */
    this._ollamaProcess = null;
    /** @type {{ abort: () => void }|null} */
    this._ollamaAbortController = null;
    /** @type {object|null} */
    this._shellProcess = null;
    /** @type {object|null} */
    this._piProcess = null;
    /** @type {{ ollama: string|null, ollamaModels: string[] }} */
    this._availableAITools = { ollama: null, ollamaModels: [] };
    /** @type {boolean} */
    this._agentAborted = false;
    /** @type {import('child_process').ChildProcess|null} */
    this._agentChildProcess = null;
    /** @type {import('http').ClientRequest|null} */
    this._agentActiveRequest = null;
    /** @type {Set<string>} */
    this._agentSessionAllowlist = new Set();
    /** @type {Array<object>} */
    this._agentConversationHistory = [];
    /** @type {Array<{role: 'user'|'assistant', content: string}>} */
    this._chatHistory = [];
    /** @type {boolean} */
    this._isTerminalDetached = false;
    /** @type {number} */
    this._terminalHeight = 300;
  }

  // --- File state ---

  get currentFilePath() {
    return this._currentFilePath;
  }
  set currentFilePath(v) {
    const old = this._currentFilePath;
    this._currentFilePath = v;
    if (old !== v) this.emit('change', 'currentFilePath', v, old);
  }

  get currentContent() {
    return this._currentContent;
  }
  set currentContent(v) {
    this._currentContent = v;
  }

  get currentProjectRoot() {
    return this._currentProjectRoot;
  }
  set currentProjectRoot(v) {
    this._currentProjectRoot = v;
  }

  // --- UI state ---

  get currentTheme() {
    return this._currentTheme;
  }
  set currentTheme(v) {
    this._currentTheme = v;
  }

  get autoSaveEnabled() {
    return this._autoSaveEnabled;
  }
  set autoSaveEnabled(v) {
    this._autoSaveEnabled = v;
  }

  // --- File watcher state ---

  get watchedFilePath() {
    return this._watchedFilePath;
  }
  set watchedFilePath(v) {
    this._watchedFilePath = v;
  }

  get lastKnownMtime() {
    return this._lastKnownMtime;
  }
  set lastKnownMtime(v) {
    this._lastKnownMtime = v;
  }

  // --- Process state ---

  get ollamaProcess() {
    return this._ollamaProcess;
  }
  set ollamaProcess(v) {
    this._ollamaProcess = v;
  }

  get ollamaAbortController() {
    return this._ollamaAbortController;
  }
  set ollamaAbortController(v) {
    this._ollamaAbortController = v;
  }

  get shellProcess() {
    return this._shellProcess;
  }
  set shellProcess(v) {
    this._shellProcess = v;
  }

  get piProcess() {
    return this._piProcess;
  }
  set piProcess(v) {
    this._piProcess = v;
  }

  // --- AI state ---

  get availableAITools() {
    return this._availableAITools;
  }
  set availableAITools(v) {
    this._availableAITools = v;
  }

  get agentAborted() {
    return this._agentAborted;
  }
  set agentAborted(v) {
    this._agentAborted = v;
  }

  get agentChildProcess() {
    return this._agentChildProcess;
  }
  set agentChildProcess(v) {
    this._agentChildProcess = v;
  }

  get agentActiveRequest() {
    return this._agentActiveRequest;
  }
  set agentActiveRequest(v) {
    this._agentActiveRequest = v;
  }

  get agentSessionAllowlist() {
    return this._agentSessionAllowlist;
  }

  get agentConversationHistory() {
    return this._agentConversationHistory;
  }
  set agentConversationHistory(v) {
    this._agentConversationHistory = v;
  }

  clearAgentConversationHistory() {
    this._agentConversationHistory = [];
  }

  get chatHistory() {
    return this._chatHistory;
  }
  set chatHistory(v) {
    this._chatHistory = v;
  }

  clearChatHistory() {
    this._chatHistory = [];
  }

  clearAIConversationHistory() {
    this.clearChatHistory();
    this.clearAgentConversationHistory();
  }

  // --- Terminal state ---

  get isTerminalDetached() {
    return this._isTerminalDetached;
  }
  set isTerminalDetached(v) {
    this._isTerminalDetached = v;
  }

  get terminalHeight() {
    return this._terminalHeight;
  }
  set terminalHeight(v) {
    this._terminalHeight = v;
  }
}

module.exports = { SessionState };
