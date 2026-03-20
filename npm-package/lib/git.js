const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const runGit = (projectDir, args) => spawnSync('git', args, {
  cwd: projectDir,
  encoding: 'utf8',
});

const isGitRepo = (projectDir) => runGit(projectDir, ['rev-parse', '--is-inside-work-tree']).status === 0;

const getDiffForReview = (projectDir) => {
  const diff = runGit(projectDir, ['diff', '--no-ext-diff', '--binary', 'HEAD', '--', '.']);
  const status = runGit(projectDir, ['status', '--short']);
  return [
    '# Git Status',
    '',
    (status.stdout || '').trim() || '(clean)',
    '',
    '# Git Diff',
    '',
    (diff.stdout || '').trim() || '(no diff)',
    '',
  ].join('\n');
};

const commitChanges = (projectDir, message) => {
  const status = runGit(projectDir, ['status', '--porcelain']);
  if ((status.stdout || '').trim().length === 0) {
    return { status: 'skipped', summary: 'No changes to commit.' };
  }

  const add = runGit(projectDir, ['add', '-A']);
  if (add.status !== 0) {
    return { status: 'failed', summary: add.stderr || 'git add failed' };
  }

  const commit = runGit(projectDir, ['commit', '-m', message]);
  if (commit.status !== 0) {
    return { status: 'failed', summary: commit.stderr || commit.stdout || 'git commit failed' };
  }

  return {
    status: 'committed',
    summary: (commit.stdout || '').trim() || `Committed with message: ${message}`,
  };
};

const buildCommitMessage = (task, presetName) => {
  const scope = presetName ? `(${presetName})` : '';
  const suffix = task ? task.toLowerCase().replace(/[^\w\s-]/g, '').trim() : 'update project state';
  return `chore${scope}: ${suffix || 'update project state'}`;
};

const writeReviewFiles = (iterDir, diffContent) => {
  const diffPath = path.join(iterDir, 'diff.patch');
  fs.writeFileSync(diffPath, diffContent, 'utf8');
  return diffPath;
};

module.exports = {
  buildCommitMessage,
  commitChanges,
  getDiffForReview,
  isGitRepo,
  writeReviewFiles,
};
