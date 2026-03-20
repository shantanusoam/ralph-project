const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { execa } = require('execa');
const { createFixture } = require('fs-fixture');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const stripAnsi = require('strip-ansi');
const stripAnsiText = stripAnsi.default || stripAnsi;

const ralphBin = path.resolve('bin/ralph.js');

const writeOpencodeStub = (binDir) => {
  const stubPath = path.join(binDir, 'opencode');
  const content = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

if (command === '--version') {
  console.log('opencode 0.0.0-test');
  process.exit(0);
}

if (command === 'models') {
  console.log('openai/gpt-5.2-codex');
  console.log('opencode/grok-code');
  process.exit(0);
}

if (command === 'auth') {
  console.log('auth ok');
  process.exit(0);
}

if (command === 'run') {
  if (args.some((arg) => String(arg).includes('reviewer.md'))) {
    console.log('<review>PASS</review>');
    process.exit(0);
  }
  console.log('<promise>COMPLETE</promise>');
  process.exit(0);
}

console.log('opencode stub');
process.exit(0);
`;

  fs.writeFileSync(stubPath, content, 'utf8');
  fs.chmodSync(stubPath, 0o755);

  return stubPath;
};

const runCli = async (args, { cwd, env }) => {
  const mergedEnv = {
    ...process.env,
    CI: 'true',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    RALPH_MAX_TURN_SECONDS: '2',
    RALPH_NO_OUTPUT_SECONDS: '2',
    ...env
  };

  const result = await execa(process.execPath, [ralphBin, ...args], {
    cwd,
    env: mergedEnv,
    reject: false
  });

  return {
    ...result,
    stdout: stripAnsiText(result.stdout),
    stderr: stripAnsiText(result.stderr)
  };
};

const encodeMcpMessage = (message) => {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
};

const collectMcpMessages = async (child, count) => {
  let buffer = '';
  const messages = [];

  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          reject(new Error('Missing Content-Length header'));
          return;
        }
        const length = Number.parseInt(match[1], 10);
        const totalLength = headerEnd + 4 + length;
        if (buffer.length < totalLength) break;
        const payload = buffer.slice(headerEnd + 4, totalLength);
        buffer = buffer.slice(totalLength);
        messages.push(JSON.parse(payload));
        if (messages.length >= count) {
          resolve(messages);
          return;
        }
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (messages.length < count) {
        reject(new Error(`MCP process closed early with code ${code}`));
      }
    });
  });
};

describe('vibepup CLI end-to-end', () => {
  let fixture;

  beforeEach(async () => {
    fixture = await createFixture({
      'README.md': '# Fixture'
    });
  });

  test('runs default CLI flow with stubbed opencode', async () => {
    const binDir = path.join(fixture.path, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    writeOpencodeStub(binDir);

    const { stdout, exitCode } = await runCli(['1'], {
      cwd: fixture.path,
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
      }
    });

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('🐾 Vibepup is waking up...'));
    assert.ok(stdout.includes('🔁 Loop 1'));

    const runsDir = path.join(fixture.path, '.ralph', 'runs');
    const iterDir = path.join(runsDir, 'iter-0001');
    assert.ok(fs.existsSync(iterDir));
    assert.ok(fs.existsSync(path.join(iterDir, 'agent_response.txt')));
  });

  test('runs free setup flow with stubbed opencode', async () => {
    const binDir = path.join(fixture.path, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    writeOpencodeStub(binDir);

    const { stdout, exitCode } = await runCli(['free'], {
      cwd: fixture.path,
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
      }
    });

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('✨ Vibepup Free Setup'));
  });

  test('windows runner flow uses stubbed opencode', async () => {
    const binDir = path.join(fixture.path, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    writeOpencodeStub(binDir);

    const { stdout, exitCode } = await runCli(['--platform=windows', 'free'], {
      cwd: fixture.path,
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
      }
    });

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('🐾 Vibepup is waking up...'));
    assert.ok(stdout.includes('✨ Vibepup Free Setup'));
  });

  test('imports a local source file into specs', async () => {
    fs.writeFileSync(path.join(fixture.path, 'spec.md'), '# Input spec\n\nBuild a timer.\n', 'utf8');

    const { stdout, exitCode } = await runCli(['fetch', './spec.md'], {
      cwd: fixture.path,
      env: {}
    });

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Imported source'));
    assert.ok(fs.existsSync(path.join(fixture.path, 'specs', 'latest-source.md')));
  });

  test('runs validation from AGENTS playbook', async () => {
    fs.writeFileSync(path.join(fixture.path, 'AGENTS.md'), [
      '# AGENTS.md',
      '',
      '## Validation',
      '```sh',
      'node -e "process.exit(0)"',
      '```',
      ''
    ].join('\n'), 'utf8');

    const { stdout, exitCode } = await runCli(['validate'], {
      cwd: fixture.path,
      env: {}
    });

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Validation passed'));
  });

  test('reports status after initialization', async () => {
    const { stdout, exitCode } = await runCli(['status'], {
      cwd: fixture.path,
      env: {}
    });

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Vibepup Status'));
    assert.ok(stdout.includes('Phase'));
  });

  test('serves MCP tools over stdio', { timeout: 10000 }, async () => {
    const child = spawn(process.execPath, [ralphBin, 'mcp'], {
      cwd: fixture.path,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const messagePromise = Promise.race([
      collectMcpMessages(child, 2),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for MCP messages')), 5000))
    ]);
    child.stdin.write(encodeMcpMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    }));
    child.stdin.write(encodeMcpMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    }));
    child.stdin.write(encodeMcpMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    }));

    const messages = await messagePromise.finally(() => {
      child.kill();
    });

    assert.equal(messages[0].id, 1);
    assert.equal(messages[0].result.serverInfo.name, 'vibepup');
    assert.equal(messages[1].id, 2);
    assert.ok(Array.isArray(messages[1].result.tools));
    assert.ok(messages[1].result.tools.some((tool) => tool.name === 'vibepup_run'));
  });
});
