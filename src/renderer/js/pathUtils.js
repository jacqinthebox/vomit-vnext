// PathUtils — separator-tolerant helpers for native paths received from main.
// Keep native paths intact for IPC/fs; normalize only for display/comparison.

window.PathUtils = {
  normalize(path) {
    return String(path || '').replace(/\\/g, '/');
  },

  basename(path) {
    const normalized = this.normalize(path);
    return normalized.split('/').filter(Boolean).pop() || '';
  },

  dirname(path) {
    const value = String(path || '');
    const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return slash >= 0 ? value.substring(0, slash) : '';
  },

  join(base, child) {
    if (!base) return child || '';
    if (!child) return base;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(child) || child.startsWith('/') || child.startsWith('\\')) {
      return child;
    }
    const sep = String(base).includes('\\') ? '\\' : '/';
    return `${String(base).replace(/[\\/]+$/, '')}${sep}${String(child).replace(/^[\\/]+/, '')}`;
  },

  isSubPath(child, parent) {
    const childNorm = this.normalize(child).replace(/\/+$/, '').toLowerCase();
    const parentNorm = this.normalize(parent).replace(/\/+$/, '').toLowerCase();
    return childNorm === parentNorm || childNorm.startsWith(`${parentNorm}/`);
  },

  relativeParts(path, root) {
    const pathNorm = this.normalize(path);
    const rootNorm = this.normalize(root).replace(/\/+$/, '');
    return pathNorm.slice(rootNorm.length).split('/').filter(Boolean);
  },

  toVomitFileUrl(path) {
    return `vomit-file://${encodeURIComponent(path)}`;
  }
};
