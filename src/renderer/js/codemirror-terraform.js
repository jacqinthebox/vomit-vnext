// CodeMirror 5 mode for Terraform / HCL (.tf, .tfvars).
// Handwritten because upstream CodeMirror 5 ships no HCL mode.
(function (CodeMirror) {
  'use strict';

  CodeMirror.defineMode('terraform', function () {
    var blockKeywords =
      /^(resource|data|variable|output|locals|module|provider|terraform|backend|provisioner|connection|dynamic|import|moved|check|removed)$/;
    var atoms = /^(true|false|null)$/;
    var types = /^(string|number|bool|list|map|set|object|tuple|any)$/;

    function tokenBase(stream, state) {
      if (stream.eatSpace()) return null;

      var ch = stream.next();

      if (ch === '#' || (ch === '/' && stream.eat('/'))) {
        stream.skipToEnd();
        return 'comment';
      }
      if (ch === '/' && stream.eat('*')) {
        state.tokenize = tokenComment;
        return tokenComment(stream, state);
      }
      if (ch === '"') {
        state.tokenize = tokenString;
        return tokenString(stream, state);
      }
      if (ch === '<') {
        var heredoc = stream.match(/^<-?([A-Za-z_]\w*)/);
        if (heredoc) {
          state.heredoc = heredoc[1];
          return 'string-2';
        }
      }
      if (/\d/.test(ch)) {
        stream.match(/^\d*(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        return 'number';
      }
      if (/[A-Za-z_]/.test(ch)) {
        stream.match(/^[\w-]*/);
        var word = stream.current();
        if (atoms.test(word)) return 'atom';
        if (types.test(word)) return 'type';
        if (blockKeywords.test(word)) return 'keyword';
        if (stream.match(/^\s*=(?!=)/, false)) return 'attribute';
        return 'variable';
      }
      return null;
    }

    function tokenString(stream, state) {
      // Highlight ${...} interpolation distinctly inside strings.
      if (stream.match(/^\$\{[^}]*\}/)) return 'string-2';
      var ch;
      while ((ch = stream.next()) != null) {
        if (ch === '\\') {
          stream.next();
          continue;
        }
        if (ch === '"') {
          state.tokenize = tokenBase;
          return 'string';
        }
        if (ch === '$' && stream.peek() === '{') {
          stream.backUp(1);
          return 'string';
        }
      }
      // HCL quoted strings do not span lines; recover on the next line.
      state.tokenize = tokenBase;
      return 'string';
    }

    function tokenComment(stream, state) {
      var ch;
      while ((ch = stream.next()) != null) {
        if (ch === '*' && stream.eat('/')) {
          state.tokenize = tokenBase;
          break;
        }
      }
      return 'comment';
    }

    return {
      startState: function () {
        return { tokenize: tokenBase, heredoc: null };
      },
      token: function (stream, state) {
        if (state.heredoc) {
          if (stream.sol() && stream.match(new RegExp('^\\s*' + state.heredoc + '\\s*$'))) {
            state.heredoc = null;
            return 'string-2';
          }
          stream.skipToEnd();
          return 'string';
        }
        return state.tokenize(stream, state);
      },
      lineComment: '#',
      blockCommentStart: '/*',
      blockCommentEnd: '*/',
    };
  });

  CodeMirror.defineMIME('text/x-terraform', 'terraform');

  // Register in modeInfo so the markdown mode's findModeByName resolves
  // ```terraform / ```hcl / ```tfvars fences to this mode.
  if (CodeMirror.modeInfo) {
    CodeMirror.modeInfo.push({
      name: 'Terraform',
      mime: 'text/x-terraform',
      mode: 'terraform',
      ext: ['tf', 'tfvars'],
      alias: ['tf', 'hcl', 'tfvars'],
    });
  }
})(CodeMirror);
