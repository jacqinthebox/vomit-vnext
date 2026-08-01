// highlight.js grammar for Terraform / HCL (.tf, .tfvars).
// Registered here because highlight.js ships no terraform grammar.
(function () {
  'use strict';

  function terraform(hljs) {
    const KEYWORDS = {
      keyword: [
        'resource',
        'data',
        'variable',
        'output',
        'locals',
        'module',
        'provider',
        'terraform',
        'backend',
        'provisioner',
        'connection',
        'dynamic',
        'import',
        'moved',
        'check',
        'removed',
        'for',
        'in',
        'if',
      ],
      literal: ['true', 'false', 'null'],
      type: ['string', 'number', 'bool', 'list', 'map', 'set', 'object', 'tuple', 'any'],
    };

    const INTERPOLATION = {
      className: 'subst',
      begin: /\$\{/,
      end: /\}/,
      keywords: KEYWORDS,
    };

    const QUOTED_STRING = {
      className: 'string',
      begin: /"/,
      end: /"/,
      contains: [hljs.BACKSLASH_ESCAPE, INTERPOLATION],
    };

    const HEREDOC = hljs.END_SAME_AS_BEGIN({
      className: 'string',
      begin: /<<-?(\w+)\n/,
      end: /^\s*(\w+)\s*$/,
      contains: [INTERPOLATION],
    });

    const ATTRIBUTE = {
      className: 'attr',
      begin: /[A-Za-z_][\w-]*(?=\s*=(?!=))/,
    };

    return {
      name: 'Terraform',
      aliases: ['tf', 'hcl', 'tfvars'],
      keywords: KEYWORDS,
      contains: [
        hljs.HASH_COMMENT_MODE,
        hljs.C_LINE_COMMENT_MODE,
        hljs.C_BLOCK_COMMENT_MODE,
        QUOTED_STRING,
        HEREDOC,
        hljs.C_NUMBER_MODE,
        ATTRIBUTE,
      ],
    };
  }

  if (typeof window !== 'undefined' && window.hljs) {
    window.hljs.registerLanguage('terraform', terraform);
  }
})();
