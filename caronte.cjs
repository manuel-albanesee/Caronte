#!/usr/bin/env node

const usage = 'Usage: caronte install-project [--dry-run | --verify] [--ecc-full]\n' +
  '        [--headroom-path=<executable>] [--ecc-path=<directory>] [--rtk-path=<executable>]\n' +
  '        [--headroom-python[=<absolute-path>]]\n' +
  '       caronte start [--headroom-python[=<absolute-path>]] [Claude Code options]\n' +
  '       caronte update\n' +
  'Installs Caronte, ECC, Headroom, RTK, and FastSkillRetrieval for the current project.\n' +
  'update applies the local Caronte clone to the current project, then updates ECC, RTK,\n' +
  'FastSkillRetrieval, and the project Headroom runtime from their official repositories.';
const [command, ...flags] = process.argv.slice(2);

async function start(args) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { constants } = require('node:os');
  const { spawn } = require('node:child_process');
  const { locateHeadroom, pythonEntry, resolveHeadroomPython } = require('./headroom-setup.cjs');
  const { showLogo } = require('./terminal-ui.cjs');
  const root = process.cwd();
  const { updateMessage, updateProject } = require('./auto-update.cjs');
  const update = fs.existsSync(path.join(__dirname, '.git')) ? updateProject(root) : null;
  if (update) console.error('Caronte | ' + updateMessage(update));
  const settingsFile = path.join(root, '.claude', 'settings.local.json');
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  const separator = args.indexOf('--');
  const wrapOptions = separator < 0 ? args : args.slice(0, separator);
  const pythonOptions = wrapOptions.filter(arg => arg === '--headroom-python' || arg.startsWith('--headroom-python='));
  let python;
  if (pythonOptions.length) {
    if (pythonOptions.length > 1) throw Error('Usa --headroom-python una sola volta.');
    python = resolveHeadroomPython(pythonOptions[0] === '--headroom-python' || pythonOptions[0].slice('--headroom-python='.length));
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
  const entry = python ? pythonEntry : [];
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

const labels = { ecc: 'ECC', rtk: 'RTK', fsr: 'FastSkillRetrieval', headroom: 'Headroom' };
function describe(name, status) {
  const label = labels[name] || name;
  if (status.changed) return label + ' aggiornato a ' + status.version + '.';
  if (status.error) return label + ': aggiornamento non riuscito (' + status.error + '). Resta in uso ' + (status.version ? 'la ' + status.version : 'la copia precedente') + '.';
  if (!status.version) return label + ': non gestito dal kit qui (assente o installato esternamente).';
  if (status.pending) return label + ' ' + status.version + ': ' + status.pending + ' disponibile ma non installato dal gestore pacchetti.';
  return label + ' ' + status.version + ': già all’ultima versione compatibile.';
}

async function update(args) {
  if (args.length) throw Error('caronte update non accetta opzioni.');
  const fs = require('node:fs');
  const root = fs.realpathSync(process.cwd());
  const { hasInstallation, installedRevision, updateMessage, updateProject } = require('./auto-update.cjs');
  if (!hasInstallation(root)) throw Error('Caronte non è installato in ' + root + '. Esegui prima caronte install-project nella root del progetto.');
  const kit = updateProject(root);
  console.log('Caronte | ' + (kit ? updateMessage(kit) : 'Kit già alla revisione ' + String(installedRevision(root) || 'sconosciuta').slice(0, 12) + ' del clone locale.'));
  const { sync } = require('./.claude/routing/dependencies.cjs');
  const results = await sync(root, { apply: Object.keys(labels) });
  for (const [name, status] of Object.entries(results)) console.log('Caronte | ' + describe(name, status));
  if (Object.values(results).some(status => status.error)) process.exitCode = 1;
}

async function main() {
  if (!command || command === '--help' || command === '-h' ||
      (command === 'install-project' && flags.some(flag => flag === '--help' || flag === '-h'))) {
    console.log(usage);
    return;
  }
  const path = require('node:path');
  if (__dirname.split(path.sep).some(part => part.toLowerCase() === 'node_modules') &&
      !require('./auto-update.cjs').checkoutRevision()) {
    throw Error('Caronte risolve una copia npm separata. Esegui npm link dal clone Git che aggiorni con git pull.');
  }
  if (command === 'start') {
    await start(flags);
  } else if (command === 'update') {
    await update(flags);
  } else if (command !== 'install-project' || flags.some(flag => !flag.startsWith('--'))) {
    console.error(usage);
    process.exitCode = 1;
  } else {
    await require('./install.cjs').cli([process.cwd(), ...flags]);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
