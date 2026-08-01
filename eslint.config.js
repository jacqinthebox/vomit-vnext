// @ts-check
'use strict';

// Flat config for ESLint 9 (also used by the pre-commit eslint hook, which
// runs in an isolated env with only eslint + typescript installed — so this
// file must not require packages beyond eslint's own dependencies).
//
// The repo predates linting; rules are correctness-focused so the hook
// catches real mistakes without demanding a style rewrite. Style is
// prettier's job.

const commonRules = {
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-sparse-arrays': 'error',
  'no-unsafe-negation': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': 'error',
  'no-dupe-else-if': 'error',
  'no-empty-pattern': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-loss-of-precision': 'error',
  'no-obj-calls': 'error',
  'no-prototype-builtins': 'off',
  'no-setter-return': 'error',
  'no-unexpected-multiline': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
};

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  structuredClone: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  Image: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  EventTarget: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  DOMParser: 'readonly',
  XMLSerializer: 'readonly',
  getComputedStyle: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  AbortController: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  structuredClone: 'readonly',
  crypto: 'readonly',
};

// Renderer scripts are classic <script> tags sharing one page: each file's
// top-level classes/functions are effectively globals for the files loaded
// after it. Declaring per-file exports here is not practical, so no-undef
// stays off in the renderer; the correctness rules still apply.
const rendererRules = { ...commonRules, 'no-undef': 'off' };

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      // Vendored third-party bundles living alongside our renderer code.
      '**/*.min.js',
    ],
  },
  {
    files: ['src/main/**/*.js', 'test/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: commonRules,
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: rendererRules,
  },
  {
    // preload runs in the renderer context (browser globals) but is authored
    // as a CommonJS module with require().
    files: ['src/main/preload.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, ...browserGlobals },
    },
    rules: commonRules,
  },
];
