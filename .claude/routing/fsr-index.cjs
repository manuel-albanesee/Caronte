'use strict';
// Indicizzazione automatica di FastSkillRetrieval: all'avvio sessione lancia in background
// `fastskillretrieval init-index --if-stale`, che ricostruisce l'indice solo se skill, agent o comandi sono cambiati.
// Non blocca mai la sessione e non solleva errori: senza FSR installato non fa nulla.
// FSR è obbligatorio: l'indicizzazione non si disattiva. FSR_HOME vale <root>/.caronte/.fsr salvo override esplicito.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const caronteHome = require('./caronte-home.cjs');

// Senza root (chiamanti legacy) resta ~/.fsr; con root la cartella è quella del progetto.
const fsrHome = (env = process.env, root) => root ? caronteHome.fsrHome(root, env) : env.FSR_HOME || path.join(os.homedir(), '.fsr');
const fsrPython = (env = process.env, platform = process.platform, root) =>
  path.join(fsrHome(env, root), 'venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function startIndexing(root, env = process.env, { spawnFn = spawn, platform = process.platform } = {}) {
  const python = fsrPython(env, platform, root);
  if (!fs.existsSync(python)) return { started: false, reason: 'FastSkillRetrieval non installato' };
  const home = fsrHome(env, root);
  const lock = path.join(home, 'index.lock');
  try {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (pid && alive(pid)) return { started: false, reason: 'indicizzazione già in corso' };
  } catch { /* nessun lock valido */ }
  try {
    const firstBuild = !fs.existsSync(path.join(home, 'index', 'claude', 'registry.sqlite3'));
    const log = fs.openSync(path.join(home, 'index.log'), 'a');
    const child = spawnFn(python, ['-I', '-m', 'fastskillretrieval', 'init-index', '--agent', 'claude', '--project', root, '--if-stale'], {
      detached: true, windowsHide: true, stdio: ['ignore', log, log],
      env: { ...env, FSR_HOME: home, PYTHONDONTWRITEBYTECODE: '1' },
    });
    child.on?.('error', () => {});
    if (child.pid) fs.writeFileSync(lock, String(child.pid));
    child.unref();
    fs.closeSync(log);
    return { started: true, firstBuild };
  } catch (error) {
    return { started: false, reason: error.message };
  }
}

module.exports = { startIndexing, fsrHome, fsrPython };
