const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planRepository } = require('./repository-setup.cjs');
const { filePath } = require('./.claude/routing/icm.cjs');

const location = '.claude/vendor/headroom';
const version = '0.44.0';
const spec = {
  name: 'Headroom', location,
  repository: 'https://github.com/headroomlabs-ai/headroom.git',
  release: 'v' + version,
  revision: 'b21479e0fa84db5f3e46bb79f96c962de4d5fdc6',
  validate: folder => /^name\s*=\s*"headroom-ai"\s*$/m.test(fs.readFileSync(path.join(folder, 'pyproject.toml'), 'utf8')),
};
const pythonCheck = 'import sys; sys.exit(not ((3, 11) <= sys.version_info[:2] < (4, 0)))';
const runtimeCheck = [
  'import importlib.metadata as m, sys',
  'sys.exit(not (m.version("headroom-ai") == sys.argv[1] and m.version("fastapi") and m.version("uvicorn")))',
].join('\n');

function planHeadroom(root) {
  const plan = planRepository(root, spec);
  Object.assign(plan.report, { version, runtime: 'planned' });
  return plan;
}

function setupHeadroom(root, plan, dry) {
  const win = process.platform === 'win32';
  const environment = filePath(root, location + '/.venv');
  const metadata = fs.lstatSync(environment, { throwIfNoEntry: false });
  const error = message => Object.assign(plan.report, { runtime: 'unavailable', error: message });
  if (metadata && !metadata.isDirectory()) return error('Percorso dell’ambiente Headroom occupato: ' + environment);
  const scripts = path.join(environment, win ? 'Scripts' : 'bin');
  const python = path.join(scripts, win ? 'python.exe' : 'python');
  const command = path.join(scripts, win ? 'headroom.exe' : 'headroom');
  const execute = (exe, args, timeout) => spawnSync(exe, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, HEADROOM_UPDATE_CHECK: 'off' },
  });
  const ready = () => fs.existsSync(command) && execute(python, ['-I', '-B', '-c', runtimeCheck, version], 5000).status === 0;
  plan.report.executable = path.relative(root, command).split(path.sep).join('/');
  if (ready()) {
    plan.report.runtime = 'present';
    return;
  }
  if (dry) return;

  if (execute(python, ['-I', '-B', '-c', pythonCheck], 5000).status !== 0) {
    const interpreters = win ? [['py', '-3.13'], ['py', '-3'], ['python']] : [['python3'], ['python']];
    const found = interpreters.find(([exe, ...args]) => execute(exe, [...args, '-I', '-B', '-c', pythonCheck], 5000).status === 0);
    if (!found) return error('Serve Python 3.11 o successivo per installare Headroom.');
    const [exe, ...args] = found;
    const made = execute(exe, [...args, '-I', '-m', 'venv', environment], 90000);
    if (made.status !== 0) return error('Creazione dell’ambiente Python Headroom fallita: ' + commandError(made));
  }
  const pip = execute(python, ['-I', '-m', 'pip', '--disable-pip-version-check', 'install', '--no-input',
    '--only-binary=headroom-ai', 'headroom-ai[proxy]==' + version], 600000);
  if (pip.status !== 0) return error('Installazione Headroom fallita: ' + commandError(pip));
  const launched = execute(command, ['--version'], 10000);
  if (!ready() || launched.status !== 0) return error('Il runtime Headroom installato non risponde a --version.');
  plan.report.runtime = 'installed';
}

function commandError(result) {
  const output = result.stderr?.trim().split(/\r?\n/).filter(Boolean);
  return result.error?.message || output?.slice(-3).join(' ').slice(0, 600) || 'codice ' + result.status;
}

module.exports = { location, planHeadroom, setupHeadroom };
