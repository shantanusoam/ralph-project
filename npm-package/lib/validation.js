const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const runShellCommand = (command, cwd) => spawnSync(command, {
  cwd,
  shell: true,
  encoding: 'utf8',
  env: {
    ...process.env,
    CI: 'true',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
  },
});

const extractValidationCommandsFromAgents = (agentsPath) => {
  if (!fs.existsSync(agentsPath)) return [];
  const contents = fs.readFileSync(agentsPath, 'utf8');
  const match = contents.match(/## Validation\s+```(?:\w+)?\n([\s\S]*?)```/i);
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

const extractValidationCommandsFromPackage = (packagePath) => {
  if (!fs.existsSync(packagePath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const scripts = pkg.scripts || {};
    return ['test', 'lint', 'build']
      .filter((name) => scripts[name])
      .map((name) => `npm run ${name}`);
  } catch (_) {
    return [];
  }
};

const resolveValidationCommands = (projectDir) => {
  const agentsCommands = extractValidationCommandsFromAgents(path.join(projectDir, 'AGENTS.md'));
  if (agentsCommands.length > 0) return agentsCommands;
  return extractValidationCommandsFromPackage(path.join(projectDir, 'package.json'));
};

const runValidation = (projectDir, iterDir) => {
  const commands = resolveValidationCommands(projectDir);
  if (commands.length === 0) {
    return {
      status: 'skipped',
      commands: [],
      results: [],
      summary: 'No validation commands configured.',
    };
  }

  const results = [];
  for (const command of commands) {
    const result = runShellCommand(command, projectDir);
    results.push({
      command,
      exitCode: result.status || 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    });
    if ((result.status || 0) !== 0) break;
  }

  const payload = {
    status: results.every((entry) => entry.exitCode === 0) ? 'passed' : 'failed',
    commands,
    results,
  };

  fs.writeFileSync(path.join(iterDir, 'validation.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    path.join(iterDir, 'validation.txt'),
    results.map((entry) => [
      `$ ${entry.command}`,
      entry.stdout.trim(),
      entry.stderr.trim(),
    ].filter(Boolean).join('\n')).join('\n\n') + '\n',
    'utf8'
  );

  payload.summary = payload.status === 'passed'
    ? `Validation passed (${results.length} command${results.length === 1 ? '' : 's'}).`
    : `Validation failed on: ${results.find((entry) => entry.exitCode !== 0)?.command || commands[0]}`;

  return payload;
};

module.exports = {
  resolveValidationCommands,
  runValidation,
};
