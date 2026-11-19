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
  const { report } = planHeadroom(root, configured && path.resolve(root, configured));
  if (report.runtime !== 'present') {
    throw Error(report.error ?? 'Headroom assente. Esegui caronte install-project nella root del progetto.');
  }
  const headroom = path.resolve(root, report.executable);
  await showLogo();
  const child = spawn(headroom, ['wrap', 'claude', ...args], { stdio: 'inherit' });
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
