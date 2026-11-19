#!/usr/bin/env node

const usage = 'Usage: caronte install-project [--dry-run | --verify] [--ecc-full]\n' +
  '        [--headroom-path=<executable>] [--ecc-path=<directory>] [--rtk-path=<executable>]\n' +
  '       caronte start [Claude Code options]\n' +
  'Installs Caronte, ECC, Headroom, and RTK for the current project.';
const [command, ...flags] = process.argv.slice(2);

async function start(args) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { constants } = require('node:os');
  const { spawn } = require('node:child_process');
  const { planHeadroom } = require('./headroom-setup.cjs');
  const { showLogo } = require('./terminal-ui.cjs');
  const root = process.cwd();
  const settingsFile = path.join(root, '.claude', 'settings.local.json');
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  const configured = settings.env?.CARONTE_HEADROOM_PATH ?? process.env.CARONTE_HEADROOM_PATH;
  let report;
  try {
    ({ report } = planHeadroom(root, configured && path.resolve(root, configured)));
  } catch (error) {
    if (!configured || !['EPERM', 'EACCES', 'ENOENT'].includes(error.code)) throw error;
    ({ report } = planHeadroom(root));
    if (report.runtime !== 'present') throw error;
    console.error('Caronte | Uso la copia Headroom disponibile in ' + report.executable + '.');
  }
  if (report.runtime !== 'present') {
    throw Error(report.error ?? 'Headroom assente. Esegui caronte install-project nella root del progetto.');
  }
  const headroom = path.resolve(root, report.executable);
  await showLogo();
  const env = { ...process.env };
  const separator = args.indexOf('--');
  const wrapOptions = separator < 0 ? args : args.slice(0, separator);
  if (!wrapOptions.some(arg => ['--code-memory', '--serena', '--no-serena'].includes(arg.split('=')[0]))) {
    env.HEADROOM_CODE_MEMORY = 'none';
  }
  const rtk = settings.env?.CARONTE_RTK_EXECUTABLE;
  if (rtk && path.isAbsolute(rtk) && fs.existsSync(rtk)) {
    const key = Object.keys(env).find(name => name.toLowerCase() === 'path') ?? 'PATH';
    env[key] = [path.dirname(rtk), env[key]].filter(Boolean).join(path.delimiter);
  }
  const child = spawn(headroom, ['wrap', 'claude', ...args], { stdio: 'inherit', env });
  // The foreground child receives Ctrl+C directly from the shared terminal.
  const waitForHeadroom = () => {};
  if (process.stdin.isTTY) process.on('SIGINT', waitForHeadroom);
  child.once('error', error => console.error('Avvio di Headroom locale fallito (' + headroom + '): ' + error.message));
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
