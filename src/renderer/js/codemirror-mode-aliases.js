// Extra fence-language aliases for CodeMirror's mode metadata.
// highlight.js already accepts these in the preview; without this patch the
// editor only colors fences using the canonical name (e.g. ```powershell).
// Must load after codemirror-meta.min.js.
(function (CodeMirror) {
  'use strict';
  if (!CodeMirror || !CodeMirror.findModeByName) return;

  var powershell = CodeMirror.findModeByName('powershell');
  if (powershell) {
    powershell.alias = (powershell.alias || []).concat(['ps', 'ps1', 'pwsh']);
  }
})(window.CodeMirror);
