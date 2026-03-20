#!/usr/bin/env node

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const readline = require('readline');

async function promptPlatform() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(
      '\n🐾 Vibepup on Windows! Choose your mode:\n' +
      '  1) WSL (recommended) - Full Linux parity\n' +
      '  2) Windows-native - Simpler setup\n' +
      'Select (1 or 2): ',
      (answer) => {
        rl.close();
        const choice = answer.trim();
        if (choice === '1') {
          resolve('wsl');
        } else if (choice === '2') {
          resolve('windows');
        } else {
          console.log('Invalid choice. Defaulting to WSL...');
          resolve('wsl');
        }
      }
    );
  });
}

async function main() {
  const scriptPath = path.join(__dirname, '../lib/runner/index.js');
  const windowsRunnerPath = path.join(__dirname, '../lib/runner/index.js');
  const allArgs = process.argv.slice(2);
  const useTui = allArgs.includes('--tui');

  if (allArgs[0] === 'mcp') {
    const mcpProcess = spawn(process.execPath, [scriptPath, ...allArgs], { stdio: 'inherit', shell: false });
    mcpProcess.on('error', (err) => {
      console.error('❌ Failed to start Vibepup MCP server.');
      console.error(String(err));
      process.exit(1);
    });
    mcpProcess.on('close', (code) => process.exit(code));
    return;
  }

  let selectedPlatform = null;
  let explicitPlatformFlag = false;
  const args = [];
  for (const arg of allArgs) {
    if (arg === '--tui') continue;
    if (arg === '--wsl') {
      selectedPlatform = 'wsl';
      explicitPlatformFlag = true;
      continue;
    }
    if (arg === '--windows') {
      selectedPlatform = 'windows';
      explicitPlatformFlag = true;
      continue;
    }
    if (arg.startsWith('--platform=')) {
      selectedPlatform = arg.split('=')[1];
      explicitPlatformFlag = true;
      continue;
    }
    args.push(arg);
  }

  try {
    fs.chmodSync(scriptPath, '755');
  } catch (err) {}

  console.log('🐾 Vibepup is waking up...');

  const shellOptions = { stdio: 'inherit', shell: false };
  const isWindows = os.platform() === 'win32';

  const hasWsl = () => {
    if (!isWindows) return false;
    const res = spawnSync('wsl.exe', ['-l', '-q'], { stdio: 'ignore' });
    return res.status === 0;
  };

  const toWslPath = (winPath) => {
    const resolved = path.resolve(winPath);
    const drive = resolved[0].toLowerCase();
    const rest = resolved.slice(2).replace(/\\/g, '/');
    return `/mnt/${drive}${rest}`;
  };

   if (useTui) {
     const tuiDir = path.join(__dirname, '../tui');
     const binName = os.platform() === 'win32' ? 'vibepup-tui.exe' : 'vibepup-tui';
     const binPath = path.join(tuiDir, binName);

      if (fs.existsSync(binPath)) {
        const tuiArgs = ['--runner', scriptPath, ...args];
        const tui = spawn(binPath, tuiArgs, shellOptions);
       tui.on('error', (err) => {
         console.error('❌ Failed to start Vibepup TUI.');
         console.error(String(err));
         process.exit(1);
       });
       tui.on('close', (code) => process.exit(code));
       return;
     }

      if (os.platform() !== 'win32' && fs.existsSync(tuiDir)) {
        const goArgs = ['run', '.', '--runner', scriptPath, ...args];
        const goCmd = spawn('go', goArgs, { ...shellOptions, cwd: tuiDir });
       goCmd.on('error', (err) => {
         console.error('❌ Failed to start Vibepup TUI.');
         console.error(String(err));
         process.exit(1);
       });
       goCmd.on('close', (code) => process.exit(code));
       return;
     }

     console.error('❌ Vibepup TUI not available.');
     console.error('   Build it with:');
     console.error('   cd ' + tuiDir + ' && go build -o ' + binName);
     process.exit(1);
   }

   let command = process.execPath;
   let cmdArgs = [scriptPath, ...args];

   if (isWindows) {
     const wslAvailable = hasWsl();

     // Interactive prompt for Windows when no explicit platform flag provided
     if (!explicitPlatformFlag && process.stdin.isTTY) {
       if (wslAvailable) {
         selectedPlatform = await promptPlatform();
       } else {
         console.warn('⚠️  WSL not detected. Using Windows-native mode.');
         console.warn('   💡 Tip: install WSL2 for full Linux parity.');
         selectedPlatform = 'windows';
       }
     } else if (!explicitPlatformFlag) {
       // No TTY: auto-select WSL if available, else Windows
       selectedPlatform = wslAvailable ? 'wsl' : 'windows';
       if (!wslAvailable) {
         console.warn('⚠️  WSL not detected. Using Windows-native mode.');
         console.warn('   💡 Tip: install WSL2 for full Linux parity.');
       }
     }

     const normalizedPlatform = (selectedPlatform || '').toLowerCase();

      if (normalizedPlatform === 'wsl' || (!normalizedPlatform && wslAvailable)) {
        if (!wslAvailable) {
          console.error('❌ WSL not found. Install WSL2 or use --platform=windows.');
          process.exit(1);
        }
        const wslScriptPath = toWslPath(scriptPath);
        const wslCwd = toWslPath(process.cwd());
        command = 'wsl.exe';
        cmdArgs = ['--cd', wslCwd, '--', 'node', wslScriptPath, ...args];
      } else {
        console.warn('⚠️  Using Windows-native mode.');
        console.warn('   💡 Tip: install WSL2 for full Linux parity.');
        command = process.execPath;
        cmdArgs = [windowsRunnerPath, ...args];
      }
   }

  const vibepup = spawn(command, cmdArgs, shellOptions);

  vibepup.on('error', (err) => {
    console.error('❌ Failed to start Vibepup.');
    if (err.code === 'ENOENT') {
      if (command === 'bash') {
        console.error('   Error: Bash not found. Install WSL2 or use --platform=windows.');
      } else {
        console.error('   Error: Required runtime not found on PATH.');
      }
    } else {
      console.error(String(err));
    }
    process.exit(1);
  });

  vibepup.on('close', (code) => {
    process.exit(code);
  });
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
