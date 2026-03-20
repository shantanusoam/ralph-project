const fs = require('fs');
const path = require('path');

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });

const writeIfMissing = (filePath, contents) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, contents, 'utf8');
  }
};

const defaultPrd = () => [
  '# Product Requirements Document (PRD)',
  '',
  '- [ ] Initialize repo-map.md with project architecture',
  '- [ ] Setup initial project structure',
  '',
].join('\n');

const defaultAgents = () => [
  '# AGENTS.md',
  '',
  '## Validation',
  '```sh',
  '# Add one command per line. Vibepup runs these after each iteration when --validate is enabled.',
  '# npm test',
  '# npm run lint',
  '# npm run build',
  '```',
  '',
  '## Conventions',
  '- Keep changes small and verifiable.',
  '- Prefer non-interactive commands.',
  '- Update `IMPLEMENTATION_PLAN.md` and `prd.md` as work progresses.',
  '',
].join('\n');

const defaultImplementationPlan = () => [
  '# Implementation Plan',
  '',
  '- [ ] Review `prd.md` and refine the top-level task list',
  '- [ ] Fill in `specs/` with supporting notes or fetched source material',
  '- [ ] Keep completed work reflected here as the project evolves',
  '',
].join('\n');

const ensureProjectFiles = (projectDir) => {
  const prdPath = path.join(projectDir, 'prd.md');
  const legacyPrdPath = path.join(projectDir, 'prd.json');

  if (!fs.existsSync(prdPath)) {
    if (fs.existsSync(legacyPrdPath)) {
      const data = JSON.parse(fs.readFileSync(legacyPrdPath, 'utf8'));
      const lines = data.map((item) => `- [ ] ${item.description}`);
      fs.writeFileSync(prdPath, lines.join('\n') + '\n', 'utf8');
      fs.renameSync(legacyPrdPath, path.join(projectDir, 'prd.json.bak'));
    } else {
      fs.writeFileSync(prdPath, defaultPrd(), 'utf8');
    }
  }

  writeIfMissing(path.join(projectDir, 'repo-map.md'), '');
  writeIfMissing(path.join(projectDir, 'prd.state.json'), '{}\n');
  writeIfMissing(path.join(projectDir, 'progress.log'), '');
  writeIfMissing(path.join(projectDir, 'activity.md'), '# Vibepup Activity\n\n');
  writeIfMissing(path.join(projectDir, 'AGENTS.md'), defaultAgents());
  writeIfMissing(path.join(projectDir, 'IMPLEMENTATION_PLAN.md'), defaultImplementationPlan());
  ensureDir(path.join(projectDir, 'specs'));
  writeIfMissing(path.join(projectDir, 'specs', 'README.md'), '# Specs\n\nStore fetched or hand-written supporting specs here.\n');
  ensureDir(path.join(projectDir, '.ralph', 'runs'));
};

const detectPhase = (projectDir, forcedPhase) => {
  if (forcedPhase) return forcedPhase;
  const repoMapPath = path.join(projectDir, 'repo-map.md');
  if (!fs.existsSync(repoMapPath)) return 'PLAN';
  const content = fs.readFileSync(repoMapPath, 'utf8');
  return content.trim().length === 0 ? 'PLAN' : 'BUILD';
};

const listTaskLines = (markdown) => markdown
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^- \[[ xX]\]/.test(line));

const getCurrentTask = (projectDir) => {
  const prdPath = path.join(projectDir, 'prd.md');
  if (!fs.existsSync(prdPath)) return null;
  const content = fs.readFileSync(prdPath, 'utf8');
  const pending = content
    .split(/\r?\n/)
    .find((line) => /^- \[ \]/.test(line.trim()));
  return pending ? pending.replace(/^- \[ \]\s*/, '').trim() : null;
};

const allTasksCompleted = (projectDir) => {
  const prdPath = path.join(projectDir, 'prd.md');
  if (!fs.existsSync(prdPath)) return false;
  const tasks = listTaskLines(fs.readFileSync(prdPath, 'utf8'));
  return tasks.length > 0 && tasks.every((line) => /^- \[[xX]\]/.test(line));
};

const completionMarkersPresent = (projectDir) => {
  const markers = ['RALPH_COMPLETE', '.ralph-done'];
  return markers.some((fileName) => fs.existsSync(path.join(projectDir, fileName)));
};

const readRunState = (projectDir) => {
  const statePath = path.join(projectDir, '.ralph', 'run-state.json');
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (_) {
    return null;
  }
};

const writeRunState = (projectDir, state) => {
  const statePath = path.join(projectDir, '.ralph', 'run-state.json');
  ensureDir(path.dirname(statePath));
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
};

const appendActivity = (projectDir, lines) => {
  const activityPath = path.join(projectDir, 'activity.md');
  const payload = Array.isArray(lines) ? lines : [lines];
  fs.appendFileSync(activityPath, payload.join('\n') + '\n', 'utf8');
};

const summarizeStatus = (projectDir) => {
  const runState = readRunState(projectDir);
  const currentTask = getCurrentTask(projectDir);
  return {
    phase: detectPhase(projectDir),
    currentTask,
    allTasksCompleted: allTasksCompleted(projectDir),
    completionMarkerPresent: completionMarkersPresent(projectDir),
    runState,
  };
};

module.exports = {
  appendActivity,
  allTasksCompleted,
  completionMarkersPresent,
  detectPhase,
  ensureDir,
  ensureProjectFiles,
  getCurrentTask,
  readRunState,
  summarizeStatus,
  writeRunState,
};
