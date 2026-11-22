const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// FastSkillRetrieval (MIT, Manuel Albanese): indice BM25 locale di skill, agent e comandi installati.
// Come per gli altri prodotti terzi viene scaricato dal repository ufficiale a ogni installazione di Caronte.
const spec = {
  name: 'FastSkillRetrieval',
  repository: 'https://github.com/manuel-albanesee/FastSkillRetrieval.git',
  revision: '8d8a918cfe40b98e7d54ba480d2f46229f14a304',
};
const pythonCheck = 'import sys; sys.exit(not sys.version_info[:2] == (3, 13))';
const verifyCode = 'import fastskillretrieval.agent_index, fastskillretrieval.install_agent';

const fsrHome = (env = process.env, home = os.homedir()) => env.FSR_HOME || path.join(home, '.fsr');

function paths(env = process.env, home = os.homedir(), platform = process.platform) {
  const base = fsrHome(env, home);
  const venv = path.join(base, 'venv');
  return {
    base, venv,
    python: path.join(venv, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    marker: path.join(venv, 'caronte-fsr-revision'),
  };
}

function commandError(result) {
  const output = result.stderr?.trim().split(/\r?\n/).filter(Boolean);
  return result.error?.message || output?.slice(-3).join(' ').slice(0, 600) || 'codice ' + result.status;
}

function execute(run, exe, args, timeout, live = false) {
  return run(exe, args, {
    encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024,
    stdio: live ? ['ignore', 2, 2] : 'pipe',
    env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', GIT_TERMINAL_PROMPT: '0', PYTHONDONTWRITEBYTECODE: '1' },
  });
}

function current(run, location) {
  if (!fs.existsSync(location.python)) return false;
  let revision = null;
  try { revision = fs.readFileSync(location.marker, 'utf8').trim(); } catch { /* assente */ }
  return revision === spec.revision && execute(run, location.python, ['-I', '-c', verifyCode], 10000).status === 0;
}

function planFsr({ env = process.env, home = os.homedir(), platform = process.platform, run = spawnSync } = {}) {
  const location = paths(env, home, platform);
  const present = current(run, location);
  return {
    location,
    report: { status: present ? 'present' : 'planned', revision: spec.revision, path: location.venv },
  };
}

function setupFsr(plan, { dry = false, progress, platform = process.platform, run = spawnSync } = {}) {
  const { location, report } = plan;
  if (report.status === 'present' || dry) return report;
  const fail = message => Object.assign(report, { status: 'unavailable', error: message });
  const windows = platform === 'win32';
  const interpreters = windows ? [['py', '-3.13'], ['python']] : [['python3.13'], ['python3'], ['python']];
  const found = interpreters.find(([exe, ...args]) => execute(run, exe, [...args, '-I', '-c', pythonCheck], 10000).status === 0);
  if (!found) return fail('Serve Python 3.13 per installare FastSkillRetrieval (dipendenza obbligatoria di Caronte).');
  const [exe, ...args] = found;
  fs.mkdirSync(location.base, { recursive: true });
  if (!fs.existsSync(location.python)) {
    progress?.('FastSkillRetrieval: creo l’ambiente Python in ' + location.venv + '.', undefined, 'FSR', 25);
    const made = execute(run, exe, [...args, '-I', '-m', 'venv', location.venv], 90000);
    if (made.status !== 0) return fail('Creazione dell’ambiente Python di FastSkillRetrieval fallita: ' + commandError(made));
  }
  progress?.('FastSkillRetrieval: scarico e installo dal repository ufficiale.', undefined, 'FSR', 50);
  const live = progress?.interactive;
  const pip = execute(run, location.python, ['-I', '-m', 'pip', 'install', '--no-input', '--upgrade',
    'git+' + spec.repository.replace(/\.git$/, '') + '.git@' + spec.revision], 600000, live);
  if (pip.status !== 0) return fail('Installazione FastSkillRetrieval fallita: ' + commandError(pip));
  if (execute(run, location.python, ['-I', '-c', verifyCode], 10000).status !== 0) {
    return fail('FastSkillRetrieval installato ma non importabile.');
  }
  fs.writeFileSync(location.marker, spec.revision + '\n');
  progress?.('FastSkillRetrieval: installazione verificata.', undefined, 'FSR', 100);
  return Object.assign(report, { status: 'installed' });
}

module.exports = { spec, paths, planFsr, setupFsr };
