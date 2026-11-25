'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { sync, sessionApply } = require('../.claude/routing/dependencies.cjs');
const { planFsr } = require('../fsr-setup.cjs');

const temp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte-deps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const win = process.platform === 'win32';
const pythonIn = venv => path.join(venv, win ? 'Scripts/python.exe' : 'bin/python');
const touch = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); };
const blob = text => {
  const bytes = Buffer.from(text);
  return { type: 'file', encoding: 'base64', content: bytes.toString('base64'),
    sha: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') };
};
// ECC e RTK fuori gioco: nessuna cache Git e rtk assente.
const quiet = { cache: null };

test('la SessionStart applica solo ECC e RTK; FastSkillRetrieval e Headroom sono segnalati', async t => {
  assert.deepEqual(sessionApply, ['ecc', 'rtk']);
  // Senza apply la verifica non lancia mai un gestore pacchetti.
  const exec = name => {
    if (name === 'rtk') return { status: 0, stdout: 'rtk 1.2.0' };
    throw Error('nessuna installazione attesa: ' + name);
  };
  const get = async (repo, route) => {
    if (repo === 'rtk-ai/rtk' && route === 'releases/latest') return { tag_name: 'v1.2.1' };
    throw Object.assign(Error('GitHub HTTP 404'), { status: 404 });
  };
  const result = await sync(temp(t), { ...quiet, get, exec, env: { FSR_HOME: temp(t) }, apply: [], platform: 'win32' });
  assert.deepEqual(result.rtk, { version: '1.2.0', changed: false, pending: '1.2.1' });
});

test('FastSkillRetrieval senza release segue il ramo predefinito, solo in avanti, e reinstalla con caronte update', async t => {
  const home = temp(t);
  const venv = path.join(home, 'venv');
  touch(pythonIn(venv));
  const old = 'a'.repeat(40), next = 'b'.repeat(40);
  fs.writeFileSync(path.join(venv, 'caronte-fsr-revision'), old + '\n');
  let comparison = 'ahead', pyVersion = '0.3.0', major = '0.4.0';
  const calls = [];
  const exec = (exe, args) => {
    if (exe === 'rtk') return { status: 1 };
    calls.push(args);
    if (args.includes('pip')) return { status: 0, stdout: '', stderr: '' };
    if (args.at(-1).includes('fastskillretrieval")')) return { status: 0, stdout: pyVersion + '\n' };
    return { status: 0, stdout: '' };
  };
  const get = async (repo, route) => {
    if (!repo.endsWith('FastSkillRetrieval')) throw Object.assign(Error('GitHub HTTP 404'), { status: 404 });
    if (route === 'releases/latest') throw Object.assign(Error('GitHub HTTP 404'), { status: 404 });
    if (route === '') return { default_branch: 'main' };
    if (route === 'commits/main') return { sha: next };
    if (route.startsWith('compare/')) { assert.equal(route, 'compare/' + old + '...' + next); return { status: comparison }; }
    if (route === 'contents/pyproject.toml?ref=' + next) return blob('[project]\nname = "fastskillretrieval"\nversion = "' + major + '"\n');
    throw Error('rotta inattesa ' + route);
  };
  const env = { FSR_HOME: home };
  const root = temp(t);
  const checked = await sync(root, { ...quiet, get, exec, env });
  assert.deepEqual(checked.fsr, { version: '0.3.0', revision: old, changed: false, pending: '0.4.0 (bbbbbbbbbbbb)' });
  assert.ok(!calls.some(args => args.includes('pip')), 'la sola verifica non installa');
  const applied = await sync(root, { ...quiet, get, exec, env, apply: ['fsr'] });
  assert.deepEqual(applied.fsr, { version: '0.3.0', revision: next, changed: true });
  const pip = calls.find(args => args.includes('pip'));
  assert.ok(pip.includes('git+https://github.com/manuel-albanesee/FastSkillRetrieval.git@' + next));
  assert.ok(pip.includes('--force-reinstall') && pip.includes('--no-deps'));
  assert.equal(fs.readFileSync(path.join(venv, 'caronte-fsr-revision'), 'utf8').trim(), next);
  // L'installer non riporta indietro una revisione successiva a quella fissata.
  assert.equal(planFsr({ env, run: () => ({ status: 0 }) }).report.revision, next);
  // Revisione divergente, ramo indietro o cambio di major: resta la copia in uso.
  fs.writeFileSync(path.join(venv, 'caronte-fsr-revision'), old + '\n');
  comparison = 'diverged';
  assert.match((await sync(root, { ...quiet, get, exec, env, apply: ['fsr'] })).fsr.error, /non precede main/);
  comparison = 'behind';
  assert.equal((await sync(root, { ...quiet, get, exec, env, apply: ['fsr'] })).fsr.changed, false);
  comparison = 'ahead'; major = '1.0.0';
  assert.match((await sync(root, { ...quiet, get, exec, env, apply: ['fsr'] })).fsr.error, /cambia major/);
  assert.equal(fs.readFileSync(path.join(venv, 'caronte-fsr-revision'), 'utf8').trim(), old);
  // Senza FastSkillRetrieval installato non fa nulla.
  assert.deepEqual((await sync(root, { ...quiet, get, exec, env: { FSR_HOME: temp(t) } })).fsr, { version: null, changed: false });
});

test('Headroom del progetto: release stabile, stessa major, installazione verificata con caronte update', async t => {
  const root = temp(t);
  const venv = path.join(root, '.claude', 'vendor', 'headroom', '.venv');
  touch(pythonIn(venv));
  let installed = '0.44.0', pipStatus = 0, release = 'v0.45.0';
  const calls = [];
  const exec = (exe, args) => {
    if (exe === 'rtk') return { status: 1 };
    calls.push([exe, ...args]);
    if (args.includes('pip')) { if (pipStatus === 0) installed = args.at(-1).split('==')[1]; return { status: pipStatus, stderr: 'file in uso' }; }
    if (args.at(-1).includes('headroom-ai")')) return { status: 0, stdout: installed + '\n' };
    return { status: 0, stdout: 'headroom ' + installed };
  };
  const get = async (repo, route) => {
    if (repo === 'headroomlabs-ai/headroom' && route === 'releases/latest') return { tag_name: release };
    throw Object.assign(Error('GitHub HTTP 404'), { status: 404 });
  };
  const env = { FSR_HOME: temp(t) };
  assert.deepEqual((await sync(root, { ...quiet, get, exec, env, platform: process.platform })).headroom,
    { version: '0.44.0', changed: false, pending: '0.45.0' });
  pipStatus = 1;
  const failed = (await sync(root, { ...quiet, get, exec, env, platform: process.platform, apply: ['headroom'] })).headroom;
  assert.match(failed.error, /fallita: file in uso.*caronte start/);
  assert.equal(failed.version, '0.44.0');
  pipStatus = 0;
  assert.deepEqual((await sync(root, { ...quiet, get, exec, env, platform: process.platform, apply: ['headroom'] })).headroom,
    { version: '0.45.0', changed: true });
  assert.ok(calls.some(call => call.includes('headroom-ai[proxy]==0.45.0') && call.includes('--only-binary=headroom-ai')));
  release = 'v1.0.0';
  assert.match((await sync(root, { ...quiet, get, exec, env, platform: process.platform })).headroom.error, /cambia major/);
  // Senza runtime del progetto (CLI esterna o assente) Headroom non è gestito qui.
  assert.deepEqual((await sync(temp(t), { ...quiet, get, exec, env })).headroom, { version: null, changed: false });
});

test('caronte update rifiuta un progetto senza installazione e opzioni sconosciute; l’aiuto lo documenta', t => {
  const cli = path.join(__dirname, '..', 'caronte.cjs');
  const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true });
  const help = run(['--help'], temp(t));
  assert.match(help.stdout, /caronte update\n/);
  assert.match(help.stdout, /FastSkillRetrieval, and the project Headroom runtime/);
  const empty = run(['update'], temp(t));
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /Caronte non è installato in .*caronte install-project/);
  assert.match(run(['update', '--force'], temp(t)).stderr, /non accetta opzioni/);
});
