'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const home = require('../.claude/routing/caronte-home.cjs');

const temp = t => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte-home-')); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p; };

test('percorsi di .caronte per FSR, Headroom e RTK', () => {
  const root = path.join(os.tmpdir(), 'progetto');
  assert.equal(home.DIR, '.caronte');
  assert.deepEqual(home.relative, { fsr: '.caronte/.fsr', headroom: '.caronte/.headroom', rtk: '.caronte/.rtk' });
  assert.equal(home.fsrHome(root, {}), path.join(root, '.caronte', '.fsr'));
  assert.equal(home.fsrHome(root, { FSR_HOME: 'x' }), 'x');
  const h = home.headroomPaths(root);
  assert.equal(h.venv, path.join(root, '.caronte', '.headroom', '.venv'));
  assert.equal(h.workspace, path.join(h.base, 'workspace'));
  assert.equal(h.config, path.join(h.base, 'config'));
  const r = home.rtkPaths(root);
  assert.equal(r.db, path.join(root, '.caronte', '.rtk', 'history.db'));
  assert.equal(r.recall, path.join(r.base, 'recall.db'));
});

test('caronteEnv espone le variabili con percorsi assoluti dentro .caronte', () => {
  const root = path.resolve(os.tmpdir(), 'progetto');
  const env = home.caronteEnv(root);
  assert.deepEqual(Object.keys(env).sort(), ['FSR_HOME', 'HEADROOM_CONFIG_DIR', 'HEADROOM_WORKSPACE_DIR',
    'RTK_AUDIT_DIR', 'RTK_CONFIG_DIR', 'RTK_DB_PATH', 'RTK_RECALL_DB', 'RTK_TEE_DIR']);
  for (const value of Object.values(env)) {
    assert.ok(path.isAbsolute(value));
    assert.ok(value.startsWith(path.join(root, '.caronte') + path.sep));
  }
});

test('ensureCaronteDir crea le cartelle e un .gitignore con * senza sovrascriverlo', t => {
  const root = temp(t);
  home.ensureCaronteDir(root);
  assert.match(fs.readFileSync(path.join(root, '.caronte', '.gitignore'), 'utf8'), /^\*$/m);
  assert.ok(fs.statSync(home.headroomPaths(root).workspace).isDirectory());
  assert.ok(fs.statSync(home.rtkPaths(root).tee).isDirectory());
  fs.writeFileSync(path.join(root, '.caronte', '.gitignore'), 'custom\n');
  home.ensureCaronteDir(root);
  assert.equal(fs.readFileSync(path.join(root, '.caronte', '.gitignore'), 'utf8'), 'custom\n');
});
