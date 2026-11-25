const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { planRepository } = require('./repository-setup.cjs');
const { filePath } = require('./.claude/routing/icm.cjs');

const location = require('./.claude/routing/caronte-home.cjs').relative.headroom;
const legacyLocation = '.claude/vendor/headroom';
const version = '0.44.0';
const spec = {
  name: 'Headroom', location,
  repository: 'https://github.com/headroomlabs-ai/headroom.git',
  release: 'v' + version,
  revision: 'b21479e0fa84db5f3e46bb79f96c962de4d5fdc6',
  validate: folder => /^name\s*=\s*"headroom-ai"\s*$/m.test(fs.readFileSync(path.join(folder, 'pyproject.toml'), 'utf8')),
};
const pythonCheck = 'import sys; sys.exit(not ((3, 11) <= sys.version_info[:2] < (4, 0)))';
const pythonEntry = ['-I', '-c', 'from headroom.cli import main; main()'];
const runtimeCheck = [
  'import importlib.metadata as m',
  'm.version("fastapi")',
  'm.version("uvicorn")',
  'print(m.version("headroom-ai"))',
].join('\n');

function resolveHeadroomPython(option) {
  let python = option;
  if (option === true) {
    const windows = process.platform === 'win32';
    const dataDir = windows
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const toolsDir = process.env.UV_TOOL_DIR || path.join(dataDir, 'uv', 'tools');
    python = path.resolve(toolsDir, 'headroom-ai', windows ? 'Scripts/python.exe' : 'bin/python');
  }
  if (!path.isAbsolute(python)) throw Error('Usa --headroom-python senza valore o indica un percorso assoluto.');
  if (!fs.statSync(python, { throwIfNoEntry: false })?.isFile()) {
    throw Error('Interprete Python di Headroom non trovato: ' + python + '. Se è altrove, usa --headroom-python=<percorso assoluto>.');
  }
  return python;
}

function planHeadroom(root, explicitPath, python) {
  const executable = python ?? explicitPath;
  if (executable) {
    const external = probeHeadroom(root, executable, python ? pythonEntry : []);
    if (!external.version) {
      const error = Error('Headroom (' + executable + '): ' + external.error);
      error.code = external.code;
      throw error;
    }
    return { report: { executable, version: external.version, status: 'external', runtime: 'present', ...(python ? { launcher: 'python' } : {}) } };
  }
  const external = findExternalHeadroom(root);
  if (external?.version) return { report: { ...external, status: 'external', runtime: 'present' } };

  const plan = { report: { version, runtime: 'planned' } };
  setupHeadroom(root, plan, true);
  if (plan.report.runtime === 'planned' && external?.error) {
    return { report: { ...external, status: 'external', runtime: 'unavailable' } };
  }
  const repository = planRepository(root, spec);
  if (fs.existsSync(filePath(root, legacyLocation))) plan.report.legacy = legacyLocation;
  return { ...repository, report: { ...repository.report, ...plan.report } };
}

function execute(root, exe, args, timeout, live = false) {
  return spawnSync(exe, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024,
    stdio: live ? ['ignore', 2, 2] : 'pipe',
    env: { ...process.env, HEADROOM_UPDATE_CHECK: 'off', PYTHONDONTWRITEBYTECODE: '1' },
  });
}

function* externalHeadroomExecutables() {
  const name = process.platform === 'win32' ? 'headroom.exe' : 'headroom';
  const directories = new Set((process.env.PATH || '').split(path.delimiter).map(entry => entry.replace(/^"(.*)"$/, '$1')));
  directories.add(path.join(os.homedir(), '.local', 'bin'));
  for (const directory of directories) {
    if (path.isAbsolute(directory)) yield path.join(directory, name);
  }
}

function locateHeadroom(root, configured) {
  if (configured) {
    const executable = path.resolve(root, configured);
    if (fs.statSync(executable, { throwIfNoEntry: false })) return executable;
  }
  for (const executable of externalHeadroomExecutables()) {
    if (fs.existsSync(executable)) return executable;
  }
  const command = process.platform === 'win32' ? 'Scripts/headroom.exe' : 'bin/headroom';
  for (const base of [location, legacyLocation]) {
    const local = filePath(root, base + '/.venv/' + command);
    if (fs.existsSync(local)) return local;
  }
}

// Windows reports an executable it refuses to run (policy, antivirus, corrupted file) as UNKNOWN or EFTYPE.
const blockedCodes = process.platform === 'win32' ? ['EPERM', 'EACCES', 'UNKNOWN', 'EFTYPE'] : ['EPERM', 'EACCES'];

function findExternalHeadroom(root) {
  let blocked = null;
  for (const executable of externalHeadroomExecutables()) {
    if (!fs.existsSync(executable)) continue;
    const probe = probeHeadroom(root, executable);
    if (probe.version) return { executable, version: probe.version };
    if (blockedCodes.includes(probe.code)) {
      blocked ??= { executable, error: 'Avvio di Headroom fallito (' + executable + '): ' + probe.error };
    }
  }
  return blocked;
}

function probeHeadroom(root, executable, entry = []) {
  const probe = execute(root, executable, [...entry, '--version'], 10000);
  if (probe.status !== 0) return { error: commandError(probe), code: probe.error?.code };
  const version = /^headroom(?:,?\s+version)?\s+v?(\d+(?:\.\d+)+[^\s]*)\s*$/im.exec((probe.stdout ?? '') + '\n' + (probe.stderr ?? ''))?.[1];
  if (!version) return { error: 'versione Headroom non riconosciuta' };
  const help = execute(root, executable, [...entry, 'wrap', 'claude', '--help'], 10000);
  if (help.status !== 0) return { error: commandError(help), code: help.error?.code };
  return { version };
}

function setupHeadroom(root, plan, dry, progress) {
  const win = process.platform === 'win32';
  const environment = filePath(root, location + '/.venv');
  const scripts = path.join(environment, win ? 'Scripts' : 'bin');
  const python = path.join(scripts, win ? 'python.exe' : 'python');
  const command = path.join(scripts, win ? 'headroom.exe' : 'headroom');
  const metadata = fs.lstatSync(environment, { throwIfNoEntry: false });
  const error = message => Object.assign(plan.report, { runtime: 'unavailable', error: message });
  if (metadata && !metadata.isDirectory()) return error('Percorso dell’ambiente Headroom occupato: ' + environment);
  const run = (exe, args, timeout) => execute(root, exe, args, timeout);
  function installedRuntime() {
    if (!fs.existsSync(command)) return null;
    const metadata = run(python, ['-I', '-B', '-c', runtimeCheck], 5000);
    const installedVersion = metadata.stdout?.trim();
    if (metadata.status !== 0 || !installedVersion) return null;
    const launched = run(command, ['--version'], 10000);
    return { version: installedVersion, error: launched.status === 0 ? null : commandError(launched) };
  }
  plan.report.executable = path.relative(root, command).split(path.sep).join('/');
  const existing = installedRuntime();
  if (existing) {
    if (existing.error) return error('Avvio di Headroom fallito: ' + existing.error);
    Object.assign(plan.report, { runtime: 'present', version: existing.version });
    return;
  }
  if (dry) return;

  if (run(python, ['-I', '-B', '-c', pythonCheck], 5000).status !== 0) {
    progress?.('Headroom: creo l’ambiente Python del progetto.', 5, 'Headroom', 25);
    const interpreters = win ? [['py', '-3.13'], ['py', '-3'], ['python']] : [['python3'], ['python']];
    const found = interpreters.find(([exe, ...args]) => run(exe, [...args, '-I', '-B', '-c', pythonCheck], 5000).status === 0);
    if (!found) return error('Serve Python 3.11 o successivo per installare Headroom.');
    const [exe, ...args] = found;
    const made = run(exe, [...args, '-I', '-m', 'venv', environment], 90000);
    if (made.status !== 0) return error('Creazione dell’ambiente Python Headroom fallita: ' + commandError(made));
  }
  progress?.('Headroom: installo la CLI e il proxy. Questa fase può richiedere alcuni minuti.', 6, 'Headroom', 50);
  const live = progress?.interactive;
  const pip = execute(root, python, ['-I', '-m', 'pip', '--disable-pip-version-check', 'install', '--no-input',
    '--progress-bar', live ? 'on' : 'off', '--only-binary=headroom-ai', 'headroom-ai[proxy]==' + version], 600000, live);
  if (pip.status !== 0) return error('Installazione Headroom fallita: ' + commandError(pip));
  progress?.('Headroom: verifico la CLI appena installata.', undefined, 'Headroom', 90);
  const installed = installedRuntime();
  if (!installed) return error('Il runtime Headroom installato risulta incompleto.');
  if (installed.error) return error('Avvio di Headroom fallito: ' + installed.error);
  Object.assign(plan.report, { runtime: 'installed', version: installed.version });
  progress?.('Headroom ' + installed.version + ': installazione verificata.', undefined, 'Headroom', 100);
}

function commandError(result) {
  const output = result.stderr?.trim().split(/\r?\n/).filter(Boolean);
  return result.error?.message || output?.slice(-3).join(' ').slice(0, 600) || 'codice ' + result.status;
}

module.exports = { location, legacyLocation, locateHeadroom, planHeadroom, pythonEntry, resolveHeadroomPython, setupHeadroom };
