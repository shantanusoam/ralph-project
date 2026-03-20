#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const { loadUserConfig, parseArgString } = require('../config');
const {
  appendActivity,
  allTasksCompleted,
  completionMarkersPresent,
  detectPhase,
  ensureDir,
  ensureProjectFiles,
  getCurrentTask,
  summarizeStatus,
  writeRunState,
} = require('../playbook');
const { resolvePreset, PRESETS } = require('../presets');
const { runValidation } = require('../validation');
const { writeSourceToSpecs } = require('../sources');
const {
  buildCommitMessage,
  commitChanges,
  getDiffForReview,
  isGitRepo,
  writeReviewFiles,
} = require('../git');

const ENGINE_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = process.cwd();
const RUNS_DIR = path.join(PROJECT_DIR, '.ralph', 'runs');

const DEFAULT_ITERATIONS = 5;
const DEFAULT_CIRCUIT_BREAKER_FAILURES = 3;
const DEFAULT_CIRCUIT_BREAKER_ERRORS = 5;
const RALPH_MAX_TURN_SECONDS = Number.parseInt(process.env.RALPH_MAX_TURN_SECONDS || '900', 10);
const RALPH_NO_OUTPUT_SECONDS = Number.parseInt(process.env.RALPH_NO_OUTPUT_SECONDS || '180', 10);

const DEFAULT_BUILD_MODELS_PREF = [
  'github-copilot/gpt-5.2-codex',
  'github-copilot/claude-sonnet-4.5',
  'github-copilot/gemini-3-pro-preview',
  'github-copilot-enterprise/gpt-5.2-codex',
  'github-copilot-enterprise/claude-sonnet-4.5',
  'github-copilot-enterprise/gemini-3-pro-preview',
  'openai/gpt-5.2-codex',
  'openai/gpt-5.1-codex-max',
  'google/gemini-3-pro-preview',
  'opencode/grok-code',
];

const DEFAULT_PLAN_MODELS_PREF = [
  'github-copilot/claude-opus-4.5',
  'github-copilot/gemini-3-pro-preview',
  'github-copilot-enterprise/claude-opus-4.5',
  'github-copilot-enterprise/gemini-3-pro-preview',
  'openai/gpt-5.2',
  'google/antigravity-claude-opus-4-5-thinking',
  'google/gemini-3-pro-preview',
  'opencode/glm-4.7-free',
];

const SYSTEM_PROMPT = path.join(ENGINE_DIR, 'prompt.md');
const ARCHITECT_FILE = path.join(ENGINE_DIR, 'agents', 'architect.md');
const REVIEWER_FILE = path.join(ENGINE_DIR, 'agents', 'reviewer.md');

const userConfig = loadUserConfig();

const parseArgs = () => {
  const rawArgs = process.argv.slice(2);
  const commandNames = new Set(['run', 'new', 'free', 'doctor', 'fetch', 'init', 'plan', 'status', 'validate', 'mcp']);
  const options = {
    command: 'run',
    iterations: DEFAULT_ITERATIONS,
    watchMode: false,
    projectIdea: '',
    designMode: false,
    validate: false,
    review: false,
    commit: false,
    sourceInput: '',
    fetchInput: '',
    preset: '',
    completionPromise: '<promise>COMPLETE</promise>',
    requireExitSignal: false,
    circuitBreakerFailures: DEFAULT_CIRCUIT_BREAKER_FAILURES,
    circuitBreakerErrors: DEFAULT_CIRCUIT_BREAKER_ERRORS,
    forcedPhase: '',
    extraPromptSuffix: '',
  };

  let args = rawArgs.slice();
  if (args[0] && commandNames.has(args[0])) {
    options.command = args[0];
    args = args.slice(1);
  } else if (args[0] === '--doctor') {
    options.command = 'doctor';
    args = args.slice(1);
  }

  if (options.command === 'new') {
    options.projectIdea = args.join(' ').trim();
    return options;
  }

  if (options.command === 'fetch') {
    options.fetchInput = args.join(' ').trim();
    return options;
  }

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (/^\d+$/.test(arg)) {
      options.iterations = Number.parseInt(arg, 10);
      index += 1;
      continue;
    }

    switch (arg) {
      case '--watch':
        options.watchMode = true;
        index += 1;
        break;
      case '--design':
        options.designMode = true;
        index += 1;
        break;
      case '--validate':
        options.validate = true;
        index += 1;
        break;
      case '--review':
        options.review = true;
        index += 1;
        break;
      case '--commit':
        options.commit = true;
        index += 1;
        break;
      case '--from':
        options.sourceInput = args[index + 1] || '';
        index += 2;
        break;
      case '--preset':
        options.preset = args[index + 1] || '';
        index += 2;
        break;
      case '--completion-promise':
        options.completionPromise = args[index + 1] || options.completionPromise;
        index += 2;
        break;
      case '--require-exit-signal':
        options.requireExitSignal = true;
        index += 1;
        break;
      case '--circuit-breaker-failures':
        options.circuitBreakerFailures = Number.parseInt(args[index + 1] || `${DEFAULT_CIRCUIT_BREAKER_FAILURES}`, 10);
        index += 2;
        break;
      case '--circuit-breaker-errors':
        options.circuitBreakerErrors = Number.parseInt(args[index + 1] || `${DEFAULT_CIRCUIT_BREAKER_ERRORS}`, 10);
        index += 2;
        break;
      default:
        index += 1;
        break;
    }
  }

  if (options.command === 'plan') {
    options.forcedPhase = 'PLAN';
    if (options.iterations === DEFAULT_ITERATIONS) options.iterations = 1;
  }

  return options;
};

const md5File = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('md5').update(content).digest('hex');
};

const fileExists = (filePath) => fs.existsSync(filePath);

const readTail = (filePath, maxLines) => {
  if (!fileExists(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
};

const runCommand = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });

const getNodeMajor = () => {
  const [major] = process.versions.node.split('.').map((part) => Number.parseInt(part, 10));
  return major || 0;
};

const getNpmPrefix = () => {
  const result = runCommand('npm', ['config', 'get', 'prefix'], { stdio: 'pipe' });
  if (result.status !== 0) return null;
  const value = (result.stdout || '').trim();
  return value || null;
};

const isWritable = (dirPath) => {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
};

const printNpmPermissionHelp = (prefix) => {
  console.error('❌ npm global install path is not writable.');
  if (prefix) {
    console.error(`   Current prefix: ${prefix}`);
  }
  console.error('   Fix options:');
  console.error('   1) Use a user prefix (recommended):');
  console.error('      mkdir -p ~/.npm-global');
  console.error('      npm config set prefix ~/.npm-global');
  console.error('      echo "export PATH=~/.npm-global/bin:$PATH" >> ~/.bashrc');
  console.error('      source ~/.bashrc');
  console.error('   2) Or run npm with sudo (less safe):');
  console.error('      sudo npm install -g opencode-ai opencode-antigravity-auth');
};

const resolvePreferredModelLists = () => ({
  build: Array.isArray(userConfig.build_models) && userConfig.build_models.length > 0
    ? userConfig.build_models
    : DEFAULT_BUILD_MODELS_PREF,
  plan: Array.isArray(userConfig.plan_models) && userConfig.plan_models.length > 0
    ? userConfig.plan_models
    : DEFAULT_PLAN_MODELS_PREF,
});

const resolveAvailableModels = (prefModels) => {
  if (process.env.RALPH_MODEL_OVERRIDE) {
    console.error(`⚠️  Model Override Active: ${process.env.RALPH_MODEL_OVERRIDE}`);
    return [process.env.RALPH_MODEL_OVERRIDE];
  }

  console.error('🔍 Verifying available models...');
  const result = runCommand('opencode', ['models', '--refresh'], { stdio: 'pipe' });
  const output = result.stdout || '';
  const lines = output.split(/\r?\n/).filter((line) => /^[a-z0-9-]+\/[a-z0-9.-]+$/.test(line));
  const available = [];
  for (const pref of prefModels) {
    if (lines.includes(pref)) available.push(pref);
  }
  if (available.length === 0) {
    console.error('⚠️  No preferred models found. Falling back to generic discovery.');
    const gptFallback = lines.find((line) => line.includes('gpt-4o'));
    const claudeFallback = lines.find((line) => line.includes('claude-sonnet'));
    if (gptFallback) available.push(gptFallback);
    if (claudeFallback) available.push(claudeFallback);
  }
  if (available.length === 0 && lines.includes('opencode/grok-code')) {
    available.push('opencode/grok-code');
    console.error('⚠️  Using fallback model: opencode/grok-code');
  }
  return available;
};

const runWithWatchdog = (logPath, command, args) => new Promise((resolve) => {
  fs.writeFileSync(logPath, '', 'utf8');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let lastOutput = Date.now();
  let killed = false;
  const startTime = Date.now();

  const handleData = (data) => {
    lastOutput = Date.now();
    logStream.write(data);
    process.stdout.write(data);
  };

  child.stdout.on('data', handleData);
  child.stderr.on('data', handleData);

  const interval = setInterval(() => {
    const now = Date.now();
    if (now - lastOutput > RALPH_NO_OUTPUT_SECONDS * 1000) {
      logStream.write('[RALPH] NO OUTPUT: likely waiting for input / hung tool\n');
      if (!killed) {
        killed = true;
        child.kill('SIGINT');
        setTimeout(() => child.kill('SIGTERM'), 3000);
        setTimeout(() => child.kill('SIGKILL'), 4000);
      }
    }
    if (now - startTime > RALPH_MAX_TURN_SECONDS * 1000) {
      logStream.write('[RALPH] TIMEOUT: killing opencode turn\n');
      if (!killed) {
        killed = true;
        child.kill('SIGINT');
        setTimeout(() => child.kill('SIGTERM'), 3000);
        setTimeout(() => child.kill('SIGKILL'), 4000);
      }
    }
  }, 5000);

  child.on('close', (code) => {
    clearInterval(interval);
    logStream.end();
    resolve(code || 0);
  });
});

const contextFiles = (iterDir) => {
  const files = [
    SYSTEM_PROMPT,
    path.join(PROJECT_DIR, 'prd.md'),
    path.join(PROJECT_DIR, 'prd.state.json'),
    path.join(PROJECT_DIR, 'repo-map.md'),
    path.join(iterDir, 'progress.tail.log'),
    path.join(PROJECT_DIR, 'AGENTS.md'),
    path.join(PROJECT_DIR, 'IMPLEMENTATION_PLAN.md'),
    path.join(PROJECT_DIR, 'specs', 'latest-source.md'),
    path.join(PROJECT_DIR, '.ralph', 'validation.latest.txt'),
    path.join(PROJECT_DIR, '.ralph', 'review.latest.txt'),
  ];
  return files.filter((filePath) => fs.existsSync(filePath));
};

const buildPromptSuffix = (phase, options, preset) => {
  const parts = [];
  if (options.designMode || process.env.DESIGN_MODE === 'true' || preset?.designMode) {
    parts.push('MODE: DESIGN + BUILD. Apply the frontend-design skill guidelines to all work.');
  } else if (phase === 'PLAN') {
    parts.push('MODE: PLAN. Focus on exploring and mapping. Do NOT write implementation code yet.');
  } else {
    parts.push('MODE: BUILD. Focus on completing tasks in prd.md and IMPLEMENTATION_PLAN.md.');
  }

  if (preset?.promptSuffix) parts.push(preset.promptSuffix);
  if (options.extraPromptSuffix) parts.push(options.extraPromptSuffix);
  return parts.join(' ');
};

const runAgent = async (model, phase, iterDir, options, preset) => {
  const logPath = path.join(iterDir, 'agent_response.txt');
  const extraArgs = [];

  if (options.designMode || process.env.DESIGN_MODE === 'true' || preset?.designMode) {
    const designSkillPath = path.join(process.env.HOME || '', '.config/opencode/skills/frontend-design.md');
    if (fs.existsSync(designSkillPath)) {
      console.log('   🎨 Design Mode Active: Injecting frontend-design skill...');
      extraArgs.push('--file', designSkillPath);
    }
  }

  if (process.env.RALPH_EXTRA_ARGS) {
    console.log(`   ⚙️  Injecting custom args: ${process.env.RALPH_EXTRA_ARGS}`);
    extraArgs.push(...parseArgString(process.env.RALPH_EXTRA_ARGS));
  }

  const args = [
    'run',
    `Proceed with task. ${buildPromptSuffix(phase, options, preset)}`,
    ...contextFiles(iterDir).flatMap((filePath) => ['--file', filePath]),
    ...extraArgs,
    '--model', model,
  ];

  return runWithWatchdog(logPath, 'opencode', args);
};

const runReviewer = async (model, iterDir) => {
  const diffContent = getDiffForReview(PROJECT_DIR);
  const diffPath = writeReviewFiles(iterDir, diffContent);
  const logPath = path.join(iterDir, 'review_response.txt');
  const args = [
    'run',
    'Review the current uncommitted changes. Approve only if the implementation looks correct and well-verified.',
    '--file', REVIEWER_FILE,
    '--file', diffPath,
    '--file', path.join(PROJECT_DIR, 'prd.md'),
    '--file', path.join(PROJECT_DIR, 'IMPLEMENTATION_PLAN.md'),
    '--model', model,
  ];
  const exitCode = await runWithWatchdog(logPath, 'opencode', args);
  const response = fs.readFileSync(logPath, 'utf8');
  return {
    exitCode,
    response,
    passed: exitCode === 0 && /<review>PASS<\/review>/i.test(response),
  };
};

const runArchitect = (projectIdea, planModels) => {
  if (!planModels.length) {
    console.error('❌ No available plan models. Run `vibepup doctor` to diagnose.');
    return 1;
  }
  console.log('🏗️  Phase 0: The Architect');
  const args = [
    'run',
    `PROJECT IDEA: ${projectIdea}`,
    '--file', ARCHITECT_FILE,
    '--agent', 'general',
    '--model', planModels[0],
  ];
  const result = runCommand('opencode', args, { stdio: 'inherit' });
  return result.status || 0;
};

const ensureOpencode = (freeMode) => {
  const exists = runCommand('opencode', ['--version'], { stdio: 'ignore' }).status === 0;
  if (exists) return true;

  if (!freeMode) {
    console.error('❌ opencode not found. Vibepup requires opencode to run.');
    console.error('   Install with: npm install -g opencode-ai');
    console.error('   Free-tier option: vibepup free');
    return false;
  }

  console.log('🔧 Free setup: installing opencode...');
  const npmAvailable = runCommand('npm', ['--version'], { stdio: 'ignore' }).status === 0;
  if (!npmAvailable) {
    console.error('❌ npm not found. Install Node.js or use WSL2 for full setup.');
    return false;
  }

  const prefix = getNpmPrefix();
  if (prefix && !isWritable(prefix)) {
    printNpmPermissionHelp(prefix);
    return false;
  }

  runCommand('npm', ['install', '-g', 'opencode-ai'], { stdio: 'inherit' });
  return runCommand('opencode', ['--version'], { stdio: 'ignore' }).status === 0;
};

const runFreeSetup = () => {
  console.log('✨ Vibepup Free Setup');

  if (!ensureOpencode(true)) {
    process.exit(127);
  }

  const nodeMajor = getNodeMajor();
  if (nodeMajor < 20) {
    console.error('❌ Node.js 20+ is required for opencode-antigravity-auth.');
    console.error('   Upgrade Node and re-run:');
    console.error('   - nvm install 20 && nvm use 20');
    console.error('   - or https://nodejs.org/en/download');
    process.exit(1);
  }

  const npmAvailable = runCommand('npm', ['--version'], { stdio: 'ignore' }).status === 0;
  if (!npmAvailable) {
    console.error('❌ npm not found. Install Node.js and re-run.');
    process.exit(127);
  }

  const prefix = getNpmPrefix();
  if (prefix && !isWritable(prefix)) {
    printNpmPermissionHelp(prefix);
    process.exit(1);
  }

  console.log('   1) Installing auth plugin');
  const installResult = runCommand('npm', ['install', '-g', 'opencode-antigravity-auth'], { stdio: 'inherit' });
  if (installResult.status !== 0) {
    console.error('❌ Failed to install opencode-antigravity-auth.');
    process.exit(1);
  }

  console.log('   2) Starting Google auth');
  const authResult = runCommand('opencode', ['auth', 'login', 'antigravity'], { stdio: 'inherit' });
  if (authResult.status !== 0) {
    console.error('❌ Auth failed. If you cannot open a browser, run:');
    console.error('   opencode auth print-token antigravity');
    console.error('   export OPENCODE_ANTIGRAVITY_TOKEN="<token>"');
  }

  console.log('   3) Refreshing models');
  runCommand('opencode', ['models', '--refresh'], { stdio: 'inherit' });
  console.log("✅ Free setup complete. Run 'vibepup --watch' next.");
  process.exit(0);
};

const runDoctor = () => {
  console.log('🩺 Vibepup Doctor');
  console.log(`- Node.js: ${process.versions.node}`);
  console.log(`- config: ${userConfig && Object.keys(userConfig).length > 0 ? 'loaded' : 'defaults'}`);
  console.log(`- presets: ${Object.keys(PRESETS).join(', ')}`);

  const nodeMajor = getNodeMajor();
  if (nodeMajor < 20) {
    console.log('  ⚠️  Node 20+ required for opencode-antigravity-auth');
  }

  const npmVersion = runCommand('npm', ['--version'], { stdio: 'pipe' });
  if (npmVersion.status === 0) {
    console.log(`- npm: ${String(npmVersion.stdout).trim()}`);
    const prefix = getNpmPrefix();
    if (prefix) {
      console.log(`- npm prefix: ${prefix}`);
      if (!isWritable(prefix)) console.log('  ⚠️  npm prefix is not writable');
    }
  } else {
    console.log('- npm: not found');
  }

  const opencodeExists = runCommand('opencode', ['--version'], { stdio: 'pipe' });
  if (opencodeExists.status === 0) {
    console.log(`- opencode: ${String(opencodeExists.stdout).trim()}`);
  } else {
    console.log('- opencode: not found');
  }

  const modelResult = runCommand('opencode', ['models', '--refresh'], { stdio: 'pipe' });
  if (modelResult.status === 0) {
    const models = String(modelResult.stdout || '')
      .split(/\r?\n/)
      .filter((line) => /^[a-z0-9-]+\/[a-z0-9.-]+$/.test(line));
    console.log(`- models found: ${models.length}`);
    if (models.length === 0) {
      console.log('  ⚠️  No models available. Run:');
      console.log('     opencode auth login antigravity');
      console.log('     opencode models --refresh');
    }
  } else {
    console.log('- models refresh: failed');
  }

  console.log('\nNext steps:');
  console.log('1) Fix any warnings above.');
  console.log('2) Run `vibepup free` to bootstrap free-tier.');
  process.exit(0);
};

const updateLatestFeedback = (fileName, body) => {
  const target = path.join(PROJECT_DIR, '.ralph', fileName);
  fs.writeFileSync(target, body.trim() + '\n', 'utf8');
};

const buildErrorSignature = (context) => {
  const input = JSON.stringify(context);
  return crypto.createHash('sha1').update(input).digest('hex');
};

const writeIterationSummary = (iterDir, payload) => {
  fs.writeFileSync(path.join(iterDir, 'summary.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
};

const completionReached = (response, options) => {
  const responseHasSignal = options.completionPromise
    ? response.includes(options.completionPromise)
    : response.includes('<promise>COMPLETE</promise>');
  const markerReached = completionMarkersPresent(PROJECT_DIR);
  const tasksDone = allTasksCompleted(PROJECT_DIR);

  if (options.requireExitSignal) {
    return responseHasSignal || markerReached;
  }

  return responseHasSignal || markerReached || tasksDone;
};

const prepareIterationContext = (iterDir) => {
  ensureDir(iterDir);
  const tail = readTail(path.join(PROJECT_DIR, 'progress.log'), 200);
  fs.writeFileSync(path.join(iterDir, 'progress.tail.log'), tail, 'utf8');
  const latestLink = path.join(RUNS_DIR, 'latest');
  try {
    if (fs.existsSync(latestLink)) fs.rmSync(latestLink, { recursive: true, force: true });
  } catch (_) {}
  try {
    fs.symlinkSync(iterDir, latestLink, 'junction');
  } catch (_) {}
};

const syncImplementationPlan = () => {
  const prdPath = path.join(PROJECT_DIR, 'prd.md');
  const planPath = path.join(PROJECT_DIR, 'IMPLEMENTATION_PLAN.md');
  if (!fs.existsSync(prdPath) || fs.existsSync(planPath)) return;
  const tasks = fs.readFileSync(prdPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^- \[[ xX]\]/.test(line.trim()));
  fs.writeFileSync(planPath, `# Implementation Plan\n\n${tasks.join('\n')}\n`, 'utf8');
};

const handleFetch = async (input) => {
  ensureProjectFiles(PROJECT_DIR);
  const source = await writeSourceToSpecs(PROJECT_DIR, input);
  appendActivity(PROJECT_DIR, [
    `## ${new Date().toISOString()} Source Imported`,
    `- Kind: ${source.kind}`,
    `- Title: ${source.title}`,
    `- File: \`${path.relative(PROJECT_DIR, source.path)}\``,
    '',
  ]);
  console.log(`✅ Imported source into ${path.relative(PROJECT_DIR, source.path)}`);
};

const printStatus = () => {
  ensureProjectFiles(PROJECT_DIR);
  const status = summarizeStatus(PROJECT_DIR);
  console.log('📋 Vibepup Status');
  console.log(`- Phase: ${status.phase}`);
  console.log(`- Current task: ${status.currentTask || 'none'}`);
  console.log(`- All tasks completed: ${status.allTasksCompleted ? 'yes' : 'no'}`);
  console.log(`- Completion marker present: ${status.completionMarkerPresent ? 'yes' : 'no'}`);
  if (status.runState) {
    console.log(`- Last iteration: ${status.runState.iteration || 0}`);
    console.log(`- Last result: ${status.runState.result || 'unknown'}`);
  }
};

const runValidateCommand = () => {
  ensureProjectFiles(PROJECT_DIR);
  const iterDir = path.join(RUNS_DIR, 'manual-validate');
  ensureDir(iterDir);
  const result = runValidation(PROJECT_DIR, iterDir);
  console.log(result.summary);
  process.exit(result.status === 'failed' ? 1 : 0);
};

const runInit = () => {
  ensureProjectFiles(PROJECT_DIR);
  syncImplementationPlan();
  console.log('✅ Vibepup playbook files are ready.');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const options = parseArgs();
  const preset = resolvePreset(options.preset);
  if (preset) {
    options.validate = options.validate || Boolean(preset.validate);
    options.review = options.review || Boolean(preset.review);
    options.designMode = options.designMode || Boolean(preset.designMode);
    options.requireExitSignal = options.requireExitSignal || Boolean(preset.requireExitSignal);
    if (options.iterations === DEFAULT_ITERATIONS && preset.iterations) options.iterations = preset.iterations;
    if (options.circuitBreakerFailures === DEFAULT_CIRCUIT_BREAKER_FAILURES && preset.circuitBreakerFailures) {
      options.circuitBreakerFailures = preset.circuitBreakerFailures;
    }
    if (options.circuitBreakerErrors === DEFAULT_CIRCUIT_BREAKER_ERRORS && preset.circuitBreakerErrors) {
      options.circuitBreakerErrors = preset.circuitBreakerErrors;
    }
  }

  if (options.command === 'mcp') {
    ensureDir(RUNS_DIR);
    ensureProjectFiles(PROJECT_DIR);
    syncImplementationPlan();
    const { startMcpServer } = require('../mcp/server');
    startMcpServer({
      projectDir: PROJECT_DIR,
      runnerPath: __filename,
    });
    return;
  }

  console.log('🐾 Vibepup v1.1 (CLI Mode)');
  console.log(`   Engine:  ${ENGINE_DIR}`);
  console.log(`   Context: ${PROJECT_DIR}`);
  if (options.preset) console.log(`   Preset:  ${options.preset}`);
  console.log('   Tips:');
  console.log("   - Run 'vibepup free' for free-tier setup");
  console.log("   - Run 'vibepup new \"My idea\"' to bootstrap a project");
  console.log("   - Run 'vibepup --tui' for a guided interface");

  ensureDir(RUNS_DIR);
  ensureProjectFiles(PROJECT_DIR);
  syncImplementationPlan();

  if (options.command === 'doctor') runDoctor();
  if (options.command === 'free') runFreeSetup();
  if (options.command === 'init') {
    runInit();
    return;
  }
  if (options.command === 'status') {
    printStatus();
    return;
  }
  if (options.command === 'validate') {
    runValidateCommand();
    return;
  }
  if (options.command === 'fetch') {
    await handleFetch(options.fetchInput);
    return;
  }

  if (!ensureOpencode(options.command === 'free')) process.exit(127);

  const preferredModels = resolvePreferredModelLists();
  const buildModels = resolveAvailableModels(preferredModels.build);
  const planModels = resolveAvailableModels(preferredModels.plan);

  if (options.command === 'new') {
    const code = runArchitect(options.projectIdea, planModels);
    if (code !== 0) process.exit(code);
    console.log('✅ Architect initialization complete.');
  }

  const maybeImportSource = async () => {
    if (!options.sourceInput) return null;
    const source = await writeSourceToSpecs(PROJECT_DIR, options.sourceInput);
    appendActivity(PROJECT_DIR, [
      `## ${new Date().toISOString()} Source Imported`,
      `- Kind: ${source.kind}`,
      `- Title: ${source.title}`,
      `- File: \`${path.relative(PROJECT_DIR, source.path)}\``,
      '',
    ]);
    return source;
  };

  let lastHash = md5File(path.join(PROJECT_DIR, 'prd.md'));
  let iteration = 1;

  await maybeImportSource();
  const circuitState = {
    consecutiveFailures: 0,
    repeatedErrorCount: 0,
    lastErrorSignature: '',
  };

  while (true) {
    const currentHash = md5File(path.join(PROJECT_DIR, 'prd.md'));
    if (currentHash !== lastHash) {
      console.log('👀 PRD Changed! Restarting loop...');
      fs.appendFileSync(path.join(PROJECT_DIR, 'progress.log'), '--- PRD CHANGED: RESTARTING LOOP ---\n', 'utf8');
      lastHash = currentHash;
      if (options.watchMode) iteration = 1;
    }

    if (!options.watchMode && iteration > options.iterations) {
      console.log('⏸️  Max iterations reached.');
      break;
    }

    const phase = detectPhase(PROJECT_DIR, options.forcedPhase);
    const currentTask = getCurrentTask(PROJECT_DIR);
    const iterId = `iter-${String(iteration).padStart(4, '0')}`;
    const iterDir = path.join(RUNS_DIR, iterId);
    prepareIterationContext(iterDir);

    console.log('');
    console.log(`🔁 Loop ${iteration} (${phase} Phase)`);
    console.log(`   Logs: ${iterDir}`);
    if (currentTask) console.log(`   Task: ${currentTask}`);

    writeRunState(PROJECT_DIR, {
      startedAt: new Date().toISOString(),
      iteration,
      phase,
      currentTask,
      result: 'running',
      latestRunDir: iterDir,
      preset: options.preset || null,
    });

    const models = phase === 'PLAN' ? planModels : buildModels;
    let result = 'agent_failed';
    let success = false;
    let response = '';
    let validationResult = null;
    let reviewResult = null;
    let commitResult = null;
    let errorSummary = '';

    for (const model of models) {
      console.log(`   Using: ${model}`);
      const exitCode = await runAgent(model, phase, iterDir, options, preset);
      response = fs.readFileSync(path.join(iterDir, 'agent_response.txt'), 'utf8');

      if (/not supported|ModelNotFoundError|Make sure the model is enabled/i.test(response)) {
        console.log(`   ⚠️  Model ${model} not supported. Falling back...`);
        continue;
      }

      if (exitCode !== 0 || response.trim().length === 0) {
        errorSummary = `Model ${model} failed (exit ${exitCode}).`;
        console.log(`   ⚠️  ${errorSummary} Falling back...`);
        continue;
      }

      success = true;
      result = 'agent_passed';

      if (options.validate && phase !== 'PLAN') {
        validationResult = runValidation(PROJECT_DIR, iterDir);
        updateLatestFeedback('validation.latest.txt', [
          `Validation status: ${validationResult.status}`,
          validationResult.summary,
        ].join('\n'));
        fs.appendFileSync(path.join(PROJECT_DIR, 'progress.log'), `[validation] ${validationResult.summary}\n`, 'utf8');
        if (validationResult.status === 'failed') {
          result = 'validation_failed';
          success = false;
          errorSummary = validationResult.summary;
          break;
        }
      }

      if (options.review && phase !== 'PLAN' && isGitRepo(PROJECT_DIR)) {
        reviewResult = await runReviewer(model, iterDir);
        updateLatestFeedback('review.latest.txt', reviewResult.response || 'Review did not produce output.');
        if (!reviewResult.passed) {
          result = 'review_failed';
          success = false;
          errorSummary = 'Review rejected the current changes.';
          break;
        }
      }

      if (options.commit && phase !== 'PLAN' && isGitRepo(PROJECT_DIR)) {
        commitResult = commitChanges(PROJECT_DIR, buildCommitMessage(currentTask, options.preset));
        if (commitResult.status === 'failed') {
          result = 'commit_failed';
          success = false;
          errorSummary = commitResult.summary;
          break;
        }
      }

      break;
    }

    if (!success) {
      circuitState.consecutiveFailures += 1;
      const signature = buildErrorSignature({
        result,
        errorSummary,
        currentTask,
      });
      circuitState.repeatedErrorCount = signature === circuitState.lastErrorSignature
        ? circuitState.repeatedErrorCount + 1
        : 1;
      circuitState.lastErrorSignature = signature;
      if (!errorSummary) errorSummary = 'All models failed this iteration.';
      console.log(`❌ ${errorSummary}`);
    } else {
      circuitState.consecutiveFailures = 0;
      circuitState.repeatedErrorCount = 0;
      circuitState.lastErrorSignature = '';
    }

    writeIterationSummary(iterDir, {
      iteration,
      phase,
      currentTask,
      result,
      validation: validationResult,
      review: reviewResult ? { passed: reviewResult.passed } : null,
      commit: commitResult,
      circuitState,
    });

    writeRunState(PROJECT_DIR, {
      updatedAt: new Date().toISOString(),
      iteration,
      phase,
      currentTask,
      result,
      latestRunDir: iterDir,
      validationStatus: validationResult?.status || null,
      reviewPassed: reviewResult?.passed ?? null,
      commitStatus: commitResult?.status || null,
      consecutiveFailures: circuitState.consecutiveFailures,
      repeatedErrorCount: circuitState.repeatedErrorCount,
      preset: options.preset || null,
    });

    appendActivity(PROJECT_DIR, [
      `## ${new Date().toISOString()} Iteration ${iteration}`,
      `- Phase: ${phase}`,
      `- Task: ${currentTask || 'none'}`,
      `- Result: ${result}`,
      `- Validation: ${validationResult?.status || 'not-run'}`,
      `- Review: ${reviewResult ? (reviewResult.passed ? 'passed' : 'failed') : 'not-run'}`,
      `- Commit: ${commitResult?.status || 'not-run'}`,
      '',
    ]);

    if (success && completionReached(response, options)) {
      console.log('✅ Agent signaled completion.');
      if (!options.watchMode) {
        process.exit(0);
      }
      console.log('⏸️  Project Complete. Waiting for changes in prd.md...');
      while (md5File(path.join(PROJECT_DIR, 'prd.md')) === lastHash) {
        await sleep(2000);
      }
      console.log('👀 Change detected! Resuming...');
      iteration = 1;
      lastHash = md5File(path.join(PROJECT_DIR, 'prd.md'));
      continue;
    }

    if (circuitState.consecutiveFailures >= options.circuitBreakerFailures) {
      console.log(`🛑 Circuit breaker tripped after ${circuitState.consecutiveFailures} consecutive failures.`);
      process.exit(1);
    }
    if (circuitState.repeatedErrorCount >= options.circuitBreakerErrors) {
      console.log(`🛑 Circuit breaker tripped after repeating the same error ${circuitState.repeatedErrorCount} times.`);
      process.exit(1);
    }

    lastHash = md5File(path.join(PROJECT_DIR, 'prd.md'));
    iteration += 1;
    await sleep(success ? 1000 : 2000);
  }
};

main().catch((err) => {
  console.error('❌ Vibepup runner failed.');
  console.error(String(err));
  process.exit(1);
});
