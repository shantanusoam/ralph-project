const { spawn } = require('child_process');

const encodeMessage = (message) => {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
};

const writeMessage = (message) => {
  process.stdout.write(encodeMessage(message));
};

const createToolResult = (text) => ({
  content: [
    {
      type: 'text',
      text,
    },
  ],
});

const runRunner = ({ projectDir, runnerPath }, args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [runnerPath, ...args], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('close', (code) => {
    resolve({
      code: code || 0,
      stdout,
      stderr,
    });
  });
});

const toolDefinitions = [
  {
    name: 'vibepup_init',
    description: 'Create Vibepup playbook files in the current project.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'vibepup_plan',
    description: 'Run a focused planning pass that refreshes the architecture map.',
    inputSchema: {
      type: 'object',
      properties: {
        iterations: { type: 'number' },
        from: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vibepup_run',
    description: 'Run the autonomous Vibepup loop with optional validation and presets.',
    inputSchema: {
      type: 'object',
      properties: {
        iterations: { type: 'number' },
        watch: { type: 'boolean' },
        validate: { type: 'boolean' },
        review: { type: 'boolean' },
        commit: { type: 'boolean' },
        preset: { type: 'string' },
        from: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vibepup_status',
    description: 'Read the latest Vibepup run status and current task summary.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'vibepup_validate',
    description: 'Run the configured validation commands for the current project.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

const toolHandlers = ({ projectDir, runnerPath }) => ({
  async vibepup_init() {
    return runRunner({ projectDir, runnerPath }, ['init']);
  },
  async vibepup_plan(args = {}) {
    const command = ['plan'];
    if (args.from) command.push('--from', args.from);
    if (args.iterations) command.push(String(args.iterations));
    return runRunner({ projectDir, runnerPath }, command);
  },
  async vibepup_run(args = {}) {
    const command = ['run'];
    if (args.from) command.push('--from', args.from);
    if (args.preset) command.push('--preset', args.preset);
    if (args.watch) command.push('--watch');
    if (args.validate) command.push('--validate');
    if (args.review) command.push('--review');
    if (args.commit) command.push('--commit');
    if (args.iterations) command.push(String(args.iterations));
    return runRunner({ projectDir, runnerPath }, command);
  },
  async vibepup_status() {
    return runRunner({ projectDir, runnerPath }, ['status']);
  },
  async vibepup_validate() {
    return runRunner({ projectDir, runnerPath }, ['validate']);
  },
});

const startMcpServer = (context) => {
  const handlers = toolHandlers(context);
  let buffer = '';

  const processMessage = async (message) => {
    if (message.method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'vibepup',
            version: '1.1.0',
          },
        },
      });
      return;
    }

    if (message.method === 'notifications/initialized') {
      return;
    }

    if (message.method === 'tools/list') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: toolDefinitions,
        },
      });
      return;
    }

    if (message.method === 'tools/call') {
      const { name, arguments: args = {} } = message.params || {};
      const handler = handlers[name];
      if (!handler) {
        writeMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Unknown tool: ${name}`,
          },
        });
        return;
      }
      const result = await handler(args);
      const text = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: createToolResult(text || `Command exited with code ${result.code}`),
      });
      return;
    }

    if (typeof message.id !== 'undefined') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported method: ${message.method}`,
        },
      });
    }
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = buffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        buffer = '';
        break;
      }
      const contentLength = Number.parseInt(lengthMatch[1], 10);
      const totalLength = headerEnd + 4 + contentLength;
      if (buffer.length < totalLength) break;
      const body = buffer.slice(headerEnd + 4, totalLength);
      buffer = buffer.slice(totalLength);
      try {
        const message = JSON.parse(body);
        await processMessage(message);
      } catch (error) {
        writeMessage({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: `Parse error: ${String(error.message || error)}`,
          },
        });
      }
    }
  });
};

module.exports = {
  startMcpServer,
};
