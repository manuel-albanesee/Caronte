#!/usr/bin/env node

const usage = 'Usage: caronte install-project [--dry-run | --verify] [--ecc-full]\n' +
  '        [--headroom-path=<executable>] [--ecc-path=<directory>] [--rtk-path=<executable>]\n' +
  '       caronte start [--headroom-python=<absolute-path>] [Claude Code options]\n' +
  'Installs Caronte, ECC, Headroom, and RTK for the current project.';
const [command, ...flags] = process.argv.slice(2);

async function start(args) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { constants } = require('node:os');
  const { spawn } = require('node:child_process');
  const { locateHeadroom } = require('./headroom-setup.cjs');
  const { showLogo } = require('./terminal-ui.cjs');
  const root = process.cwd();
  const settingsFile = path.join(root, '.claude', 'settings.local.json');
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  const separator = args.indexOf('--');
  const wrapOptions = separator < 0 ? args : args.slice(0, separator);
  const pythonOptions = wrapOptions.filter(arg => arg === '--headroom-python' || arg.startsWith('--headroom-python='));
  let python;
  if (pythonOptions.length) {
    python = pythonOptions[0].slice('--headroom-python='.length);
    if (pythonOptions.length !== 1 || !path.isAbsolute(python)) {
      throw Error('Usa --headroom-python=<percorso assoluto di Python> una sola volta.');
    }
    if (!fs.statSync(python, { throwIfNoEntry: false })?.isFile()) {
      throw Error('Interprete Python di Headroom non trovato: ' + python);
    }
    args = [...wrapOptions.filter(arg => arg !== pythonOptions[0]), ...(separator < 0 ? [] : args.slice(separator))];
  }
  const configured = settings.env?.CARONTE_HEADROOM_PATH ?? process.env.CARONTE_HEADROOM_PATH;
  const executable = python ?? locateHeadroom(root, configured);
  if (!executable) throw Error('Headroom assente. Esegui caronte install-project nella root del progetto.');
  await showLogo();
  console.error('Caronte | Avvio Headroom ' + (python ? 'tramite Python da ' : 'da ') + executable);
  const env = { ...process.env };
  if (!wrapOptions.some(arg => ['--code-memory', '--serena', '--no-serena'].includes(arg.split('=')[0]))) {
    env.HEADROOM_CODE_MEMORY = 'none';
  }
  const rtk = settings.env?.CARONTE_RTK_EXECUTABLE;
  if (rtk && path.isAbsolute(rtk) && fs.existsSync(rtk)) {
    const key = Object.keys(env).find(name => name.toLowerCase() === 'path') ?? 'PATH';
    env[key] = [path.dirname(rtk), env[key]].filter(Boolean).join(path.delimiter);
  }
  const entry = python ? ['-I', '-c', 'from headroom.cli import main; main()'] : [];
  const child = spawn(executable, [...entry, 'wrap', 'claude', ...args], { stdio: 'inherit', env });
  // The foreground child receives Ctrl+C directly from the shared terminal.
  const waitForHeadroom = () => {};
  if (process.stdin.isTTY) process.on('SIGINT', waitForHeadroom);
  child.once('error', error => console.error('Caronte | Avvio di Headroom fallito: ' + error.message));
  child.once('close', (code, signal) => {
    process.off('SIGINT', waitForHeadroom);
    process.exitCode = code !== null && code >= 0 ? code : signal ? 128 + (constants.signals[signal] ?? 0) : 1;
  });
}

async function main() {
  if (!command || command === '--help' || command === '-h' ||
      (command === 'install-project' && flags.some(flag => flag === '--help' || flag === '-h'))) {
    console.log(usage);
  } else if (command === 'start') {
    await start(flags);
  } else if (command !== 'install-project' || flags.some(flag => !flag.startsWith('--'))) {
    console.error(usage);
    process.exitCode = 1;
  } else {
    await require('./install.cjs').cli([process.cwd(), ...flags]);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
