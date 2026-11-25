'use strict';
// Cartella .caronte nella root del progetto: dati e runtime delle dipendenze di Caronte, mai versionati.
//   .caronte/.fsr       FSR_HOME di FastSkillRetrieval (venv, indice, lock, log)
//   .caronte/.headroom  checkout e venv di Headroom, più workspace/ e config/ del proxy
//   .caronte/.rtk       configurazione, database, recall, tee e audit di RTK (il binario resta al gestore pacchetti)
// Un valore esplicito nell'ambiente (es. FSR_HOME) ha la precedenza sul percorso di progetto.
const fs = require('node:fs');
const path = require('node:path');

const DIR = '.caronte';
const relative = { fsr: DIR + '/.fsr', headroom: DIR + '/.headroom', rtk: DIR + '/.rtk' };

const caronteDir = root => path.join(root, DIR);
const fsrHome = (root, env = process.env) => env.FSR_HOME || path.join(root, relative.fsr);

function headroomPaths(root) {
  const base = path.join(root, relative.headroom);
  return { base, venv: path.join(base, '.venv'), workspace: path.join(base, 'workspace'), config: path.join(base, 'config') };
}

function rtkPaths(root) {
  const base = path.join(root, relative.rtk);
  return {
    base, config: path.join(base, 'config'), db: path.join(base, 'history.db'), recall: path.join(base, 'recall.db'),
    tee: path.join(base, 'tee'), audit: path.join(base, 'audit'),
  };
}

// Variabili d'ambiente che portano FSR, Headroom e RTK sui percorsi di progetto (assoluti).
function caronteEnv(root) {
  const h = headroomPaths(root), r = rtkPaths(root);
  return {
    FSR_HOME: path.join(root, relative.fsr),
    HEADROOM_WORKSPACE_DIR: h.workspace,
    HEADROOM_CONFIG_DIR: h.config,
    RTK_CONFIG_DIR: r.config,
    RTK_DB_PATH: r.db,
    RTK_RECALL_DB: r.recall,
    RTK_TEE_DIR: r.tee,
    RTK_AUDIT_DIR: r.audit,
  };
}

// Crea .caronte con un .gitignore che esclude tutto il contenuto dal repository del progetto.
function ensureCaronteDir(root) {
  const dir = caronteDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '# Dati locali di Caronte: non versionare.\n*\n');
  const h = headroomPaths(root), r = rtkPaths(root);
  for (const p of [path.join(root, relative.fsr), h.workspace, h.config, r.config, r.tee, r.audit]) fs.mkdirSync(p, { recursive: true });
  return dir;
}

module.exports = { DIR, relative, caronteDir, fsrHome, headroomPaths, rtkPaths, caronteEnv, ensureCaronteDir };
