const VISIBLE_TYPES = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance Improvements',
  chore: 'Chores'
};

module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    ['@semantic-release/release-notes-generator', {
      writerOpts: {
        transform: (commit) => {
          const section = VISIBLE_TYPES[commit.type];
          if (!section) return false;

          commit.type = section;
          if (typeof commit.hash === 'string') {
            commit.shortHash = commit.hash.substring(0, 7);
          }

          return commit;
        }
      }
    }],
    ['@semantic-release/changelog', {
      changelogFile: 'CHANGELOG.md'
    }],
    ['@semantic-release/npm', {
      npmPublish: false
    }],
    ['@semantic-release/git', {
      assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
      message: 'chore(release): ${nextRelease.version}\n\n${nextRelease.notes}'
    }],
    '@semantic-release/github'
  ]
};
