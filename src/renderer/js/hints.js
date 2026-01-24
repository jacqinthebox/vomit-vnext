// Custom hints for various languages
(function() {
  const CodeMirror = window.CodeMirror;

  // Python keywords and builtins
  const pythonKeywords = [
    // Keywords
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
    'while', 'with', 'yield',
    // Builtins
    'abs', 'all', 'any', 'bin', 'bool', 'bytes', 'callable', 'chr',
    'classmethod', 'compile', 'complex', 'dict', 'dir', 'divmod',
    'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset',
    'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input',
    'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals',
    'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open',
    'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed',
    'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str',
    'sum', 'super', 'tuple', 'type', 'vars', 'zip',
    // Common modules
    'os', 'sys', 'json', 'datetime', 'collections', 'itertools', 'functools',
    're', 'math', 'random', 'pathlib', 'typing', 'dataclasses', 'enum',
    'logging', 'argparse', 'subprocess', 'threading', 'asyncio', 'requests',
    'pytest', 'unittest', 'pydantic', 'fastapi', 'flask', 'django',
    // Common patterns
    'self', '__init__', '__name__', '__main__', '__str__', '__repr__',
    'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
    'AttributeError', 'ImportError', 'RuntimeError', 'StopIteration'
  ];

  // Bash keywords and commands
  const bashKeywords = [
    // Keywords
    'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while',
    'until', 'do', 'done', 'in', 'function', 'select', 'time', 'coproc',
    // Builtins
    'alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'cd', 'command',
    'compgen', 'complete', 'compopt', 'continue', 'declare', 'dirs',
    'disown', 'echo', 'enable', 'eval', 'exec', 'exit', 'export', 'false',
    'fc', 'fg', 'getopts', 'hash', 'help', 'history', 'jobs', 'kill',
    'let', 'local', 'logout', 'mapfile', 'popd', 'printf', 'pushd', 'pwd',
    'read', 'readarray', 'readonly', 'return', 'set', 'shift', 'shopt',
    'source', 'suspend', 'test', 'times', 'trap', 'true', 'type', 'typeset',
    'ulimit', 'umask', 'unalias', 'unset', 'wait',
    // Common commands
    'grep', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'head', 'tail',
    'cat', 'less', 'more', 'find', 'xargs', 'ls', 'cp', 'mv', 'rm', 'mkdir',
    'rmdir', 'chmod', 'chown', 'ln', 'touch', 'tar', 'gzip', 'gunzip',
    'curl', 'wget', 'ssh', 'scp', 'rsync', 'git', 'docker', 'kubectl',
    'terraform', 'helm', 'make', 'npm', 'yarn', 'pip', 'python', 'node',
    'jq', 'yq', 'envsubst', 'xargs', 'tee', 'diff', 'patch', 'which',
    // Variables
    '$HOME', '$USER', '$PATH', '$PWD', '$SHELL', '$?', '$$', '$!', '$@', '$#',
    '$0', '$1', '$2', '$RANDOM', '$LINENO', '$FUNCNAME', '$BASH_VERSION'
  ];

  // Terraform keywords
  const terraformKeywords = [
    // Block types
    'resource', 'data', 'variable', 'output', 'locals', 'module', 'provider',
    'terraform', 'backend', 'required_providers', 'required_version',
    // Meta-arguments
    'count', 'for_each', 'depends_on', 'provider', 'lifecycle', 'provisioner',
    'connection', 'create_before_destroy', 'prevent_destroy', 'ignore_changes',
    // Functions
    'abs', 'ceil', 'floor', 'log', 'max', 'min', 'pow', 'signum',
    'chomp', 'format', 'formatlist', 'indent', 'join', 'lower', 'regex',
    'regexall', 'replace', 'split', 'strrev', 'substr', 'title', 'trim',
    'trimprefix', 'trimsuffix', 'trimspace', 'upper',
    'alltrue', 'anytrue', 'chunklist', 'coalesce', 'coalescelist', 'compact',
    'concat', 'contains', 'distinct', 'element', 'flatten', 'index', 'keys',
    'length', 'list', 'lookup', 'map', 'matchkeys', 'merge', 'one', 'range',
    'reverse', 'setintersection', 'setproduct', 'setsubtract', 'setunion',
    'slice', 'sort', 'sum', 'transpose', 'values', 'zipmap',
    'base64decode', 'base64encode', 'base64gzip', 'csvdecode', 'jsondecode',
    'jsonencode', 'textdecodebase64', 'textencodebase64', 'urlencode', 'yamldecode', 'yamlencode',
    'abspath', 'dirname', 'pathexpand', 'basename', 'file', 'fileexists',
    'fileset', 'filebase64', 'templatefile',
    'formatdate', 'timeadd', 'timestamp',
    'base64sha256', 'base64sha512', 'bcrypt', 'filebase64sha256', 'filebase64sha512',
    'filemd5', 'filesha1', 'filesha256', 'filesha512', 'md5', 'rsadecrypt',
    'sha1', 'sha256', 'sha512', 'uuid', 'uuidv5',
    'cidrhost', 'cidrnetmask', 'cidrsubnet', 'cidrsubnets',
    'can', 'defaults', 'nonsensitive', 'sensitive', 'tobool', 'tolist',
    'tomap', 'tonumber', 'toset', 'tostring', 'try', 'type',
    // Common resources (AWS)
    'aws_instance', 'aws_vpc', 'aws_subnet', 'aws_security_group',
    'aws_iam_role', 'aws_iam_policy', 'aws_s3_bucket', 'aws_lambda_function',
    'aws_dynamodb_table', 'aws_rds_cluster', 'aws_eks_cluster', 'aws_ecr_repository',
    'aws_lb', 'aws_lb_target_group', 'aws_route53_zone', 'aws_acm_certificate',
    // Common resources (Azure)
    'azurerm_resource_group', 'azurerm_virtual_network', 'azurerm_subnet',
    'azurerm_network_security_group', 'azurerm_storage_account', 'azurerm_key_vault',
    'azurerm_kubernetes_cluster', 'azurerm_container_registry',
    // Types
    'string', 'number', 'bool', 'list', 'map', 'set', 'object', 'tuple', 'any',
    // Keywords
    'true', 'false', 'null', 'each', 'self', 'var', 'local', 'path', 'root'
  ];

  // Kubernetes YAML keywords
  const kubernetesKeywords = [
    // API versions
    'apiVersion', 'v1', 'apps/v1', 'batch/v1', 'networking.k8s.io/v1',
    'rbac.authorization.k8s.io/v1', 'autoscaling/v2', 'policy/v1',
    // Kinds
    'kind', 'Pod', 'Deployment', 'Service', 'ConfigMap', 'Secret',
    'PersistentVolume', 'PersistentVolumeClaim', 'StorageClass',
    'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'ReplicaSet',
    'Ingress', 'IngressClass', 'NetworkPolicy',
    'ServiceAccount', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding',
    'Namespace', 'Node', 'LimitRange', 'ResourceQuota',
    'HorizontalPodAutoscaler', 'PodDisruptionBudget', 'PriorityClass',
    // Metadata
    'metadata', 'name', 'namespace', 'labels', 'annotations', 'uid',
    'resourceVersion', 'generation', 'creationTimestamp', 'ownerReferences',
    'finalizers', 'managedFields',
    // Spec common
    'spec', 'replicas', 'selector', 'matchLabels', 'matchExpressions',
    'template', 'containers', 'initContainers', 'volumes', 'volumeMounts',
    // Container spec
    'image', 'imagePullPolicy', 'Always', 'IfNotPresent', 'Never',
    'command', 'args', 'env', 'envFrom', 'ports', 'containerPort',
    'resources', 'limits', 'requests', 'cpu', 'memory', 'ephemeral-storage',
    'livenessProbe', 'readinessProbe', 'startupProbe', 'httpGet', 'tcpSocket',
    'exec', 'initialDelaySeconds', 'periodSeconds', 'timeoutSeconds',
    'successThreshold', 'failureThreshold', 'terminationGracePeriodSeconds',
    'securityContext', 'runAsUser', 'runAsGroup', 'runAsNonRoot', 'fsGroup',
    'privileged', 'readOnlyRootFilesystem', 'allowPrivilegeEscalation',
    'capabilities', 'add', 'drop',
    // Volume types
    'emptyDir', 'hostPath', 'configMap', 'secret', 'persistentVolumeClaim',
    'claimName', 'projected', 'downwardAPI', 'nfs', 'awsElasticBlockStore',
    'azureDisk', 'gcePersistentDisk', 'csi',
    // Service
    'type', 'ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName',
    'clusterIP', 'externalIPs', 'sessionAffinity', 'externalTrafficPolicy',
    'port', 'targetPort', 'nodePort', 'protocol', 'TCP', 'UDP',
    // Ingress
    'rules', 'host', 'http', 'paths', 'path', 'pathType', 'Prefix', 'Exact',
    'backend', 'service', 'tls', 'secretName',
    // Status
    'status', 'conditions', 'phase', 'Running', 'Pending', 'Succeeded', 'Failed',
    // Common values
    'true', 'false', 'null'
  ];

  // Helm template keywords
  const helmKeywords = [
    // Template functions
    '.Values', '.Release', '.Chart', '.Files', '.Capabilities', '.Template',
    'Release.Name', 'Release.Namespace', 'Release.Service', 'Release.IsUpgrade',
    'Release.IsInstall', 'Release.Revision',
    'Chart.Name', 'Chart.Version', 'Chart.AppVersion', 'Chart.Type',
    'Values', 'Files.Get', 'Files.GetBytes', 'Files.Glob', 'Files.Lines',
    'Files.AsSecrets', 'Files.AsConfig',
    'Capabilities.APIVersions', 'Capabilities.KubeVersion',
    'Template.Name', 'Template.BasePath',
    // Sprig functions
    'default', 'empty', 'coalesce', 'toJson', 'fromJson', 'toYaml', 'fromYaml',
    'toToml', 'fromToml', 'toPrettyJson', 'ternary',
    'now', 'ago', 'date', 'dateInZone', 'dateModify', 'duration', 'durationRound',
    'unixEpoch', 'toDate', 'mustToDate',
    'b64enc', 'b64dec', 'b32enc', 'b32dec',
    'abbrev', 'abbrevboth', 'camelcase', 'cat', 'contains', 'hasPrefix',
    'hasSuffix', 'indent', 'nindent', 'initials', 'kebabcase', 'lower',
    'nospace', 'plural', 'print', 'printf', 'println', 'quote', 'randAlpha',
    'randAlphaNum', 'randAscii', 'randNumeric', 'repeat', 'replace', 'shuffle',
    'snakecase', 'squote', 'substr', 'swapcase', 'title', 'trim', 'trimAll',
    'trimPrefix', 'trimSuffix', 'trunc', 'untitle', 'upper', 'wrap', 'wrapWith',
    'list', 'first', 'rest', 'last', 'initial', 'append', 'prepend', 'concat',
    'reverse', 'uniq', 'without', 'has', 'compact', 'slice', 'until', 'untilStep',
    'seq', 'add', 'add1', 'sub', 'div', 'mod', 'mul', 'max', 'min', 'len',
    'addf', 'subf', 'divf', 'mulf', 'round', 'ceil', 'floor',
    'dict', 'get', 'set', 'unset', 'hasKey', 'pluck', 'keys', 'pick', 'omit',
    'values', 'deepCopy', 'merge', 'mergeOverwrite', 'mustMerge', 'mustMergeOverwrite',
    'include', 'required', 'tpl', 'lookup',
    'sha1sum', 'sha256sum', 'adler32sum', 'htpasswd', 'derivePassword',
    'genPrivateKey', 'buildCustomCert', 'genCA', 'genSelfSignedCert',
    'genSignedCert', 'encryptAES', 'decryptAES', 'uuidv4',
    'getHostByName', 'fail', 'urlParse', 'urlJoin', 'urlquery',
    'regexMatch', 'regexFindAll', 'regexFind', 'regexReplaceAll',
    'regexReplaceAllLiteral', 'regexSplit', 'mustRegexMatch',
    // Control structures
    'if', 'else', 'end', 'range', 'with', 'define', 'template', 'block',
    'and', 'or', 'not', 'eq', 'ne', 'lt', 'le', 'gt', 'ge',
    ...kubernetesKeywords
  ];

  // Markdown hints
  const markdownKeywords = [
    // Headers
    '# ', '## ', '### ', '#### ', '##### ', '###### ',
    // Formatting
    '**bold**', '*italic*', '~~strikethrough~~', '`code`', '```', '```python', '```bash',
    '```javascript', '```yaml', '```json', '```typescript', '```terraform', '```hcl',
    // Links and images
    '[text](url)', '![alt](image)', '[reference][id]',
    // Lists
    '- ', '* ', '1. ', '- [ ] ', '- [x] ',
    // Other
    '> ', '---', '|', '| --- |',
    // Vomit specific
    '???', '<!-- speaker notes -->'
  ];

  // Get hints based on mode
  function getHintsForMode(mode) {
    if (!mode) return [];
    const modeName = typeof mode === 'string' ? mode : mode.name;

    switch (modeName) {
      case 'python':
        return pythonKeywords;
      case 'shell':
        return bashKeywords;
      case 'yaml':
      case 'yaml-frontmatter':
        // Check content for kubernetes/helm patterns
        return [...kubernetesKeywords, ...helmKeywords];
      case 'markdown':
      case 'gfm':
        return markdownKeywords;
      default:
        // For terraform (.tf files), use terraform keywords
        return [];
    }
  }

  // Custom hint function
  function customHint(editor, options) {
    const cur = editor.getCursor();
    const token = editor.getTokenAt(cur);
    const mode = editor.getMode();
    const line = editor.getLine(cur.line);

    // Get the word being typed
    let start = token.start;
    let end = cur.ch;
    let word = token.string;

    // Handle special cases
    if (token.type === null || token.string.match(/^\s*$/)) {
      // At whitespace, look for partial word
      const match = line.slice(0, cur.ch).match(/[\w\.\$\-]+$/);
      if (match) {
        word = match[0];
        start = cur.ch - word.length;
      } else {
        word = '';
        start = cur.ch;
      }
    }

    // Get language-specific keywords
    let keywords = getHintsForMode(mode);

    // For .tf files, add terraform keywords
    const fileName = editor.getOption('filename') || '';
    if (fileName.endsWith('.tf') || fileName.endsWith('.tfvars')) {
      keywords = terraformKeywords;
    }

    // Also get words from the document (anyword-style)
    const documentWords = new Set();
    editor.eachLine((lineHandle) => {
      const text = lineHandle.text;
      const matches = text.match(/[\w\$\.\-]+/g);
      if (matches) {
        matches.forEach(w => {
          if (w.length > 2 && w !== word) {
            documentWords.add(w);
          }
        });
      }
    });

    // Combine and filter
    const allWords = [...new Set([...keywords, ...documentWords])];
    const wordLower = word.toLowerCase();

    const matches = allWords.filter(w => {
      const wLower = w.toLowerCase();
      return wLower.startsWith(wordLower) && wLower !== wordLower;
    }).sort((a, b) => {
      // Prioritize keywords over document words
      const aIsKeyword = keywords.includes(a);
      const bIsKeyword = keywords.includes(b);
      if (aIsKeyword && !bIsKeyword) return -1;
      if (!aIsKeyword && bIsKeyword) return 1;
      return a.localeCompare(b);
    }).slice(0, 15); // Limit to 15 suggestions

    if (matches.length === 0) return null;

    return {
      list: matches,
      from: CodeMirror.Pos(cur.line, start),
      to: CodeMirror.Pos(cur.line, end)
    };
  }

  // Register the hint function
  CodeMirror.registerHelper('hint', 'custom', customHint);

  // Make it available globally
  window.VomitHints = {
    customHint,
    pythonKeywords,
    bashKeywords,
    terraformKeywords,
    kubernetesKeywords,
    helmKeywords,
    markdownKeywords
  };
})();
