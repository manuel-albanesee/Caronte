'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaultIndex, displayName } = require('../.claude/routing/skill-suggest.cjs');
const { startIndexing, fsrPython } = require('../.claude/routing/fsr-index.cjs');
const { spec, planFsr, setupFsr } = require('../fsr-setup.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'caronte-fsr-'));
const venvBin = home => path.join(home, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin');
const pythonName = process.platform === 'win32' ? 'python.exe' : 'python';
const fakeVenv = home => {
  fs.mkdirSync(venvBin(home), { recursive: true });
  fs.writeFileSync(path.join(venvBin(home), pythonName), '');
};

test('defaultIndex usa CARONTE_SKILL_INDEX, poi FSR_HOME, poi ~/.fsr', () => {
  assert.equal(defaultIndex({ CARONTE_SKILL_INDEX: 'x' }), 'x');
  assert.equal(defaultIndex({ FSR_HOME: path.join('h', 'fsr') }), path.join('h', 'fsr', 'index', 'claude'));
  assert.equal(defaultIndex({}), path.join(os.homedir(), '.fsr', 'index', 'claude'));
});

test('displayName traduce la cartella indicizzata nel nome ECC e ripiega sul prefisso rimosso', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ 'agent--java-reviewer': { name: 'ecc:java-reviewer' } }));
  assert.equal(displayName(dir, 'agent--java-reviewer'), 'ecc:java-reviewer');
  assert.equal(displayName(dir, 'cmd--plan'), 'plan');
  assert.equal(displayName(path.join(dir, 'assente'), 'agent--x'), 'x');
});

test('startIndexing non fa nulla senza FastSkillRetrieval o se disattivato', () => {
  const home = temp();
  const spawnFn = () => { throw Error('non deve partire'); };
  assert.equal(startIndexing('r', { FSR_HOME: home }, { spawnFn }).started, false);
  assert.equal(startIndexing('r', { FSR_HOME: home, CARONTE_FSR_AUTOINDEX: 'off' }, { spawnFn }).reason, 'disattivata');
});

test('startIndexing lancia init-index --if-stale una sola volta finché il lock è vivo', () => {
  const home = temp();
  assert.equal(fsrPython({ FSR_HOME: home }), path.join(venvBin(home), pythonName));
  fakeVenv(home);
  const calls = [];
  const spawnFn = (exe, args, options) => { calls.push({ exe, args, options }); return { pid: process.pid, on() {}, unref() {} }; };
  const first = startIndexing('proj', { FSR_HOME: home }, { spawnFn });
  assert.deepEqual([first.started, first.firstBuild], [true, true]);
  assert.deepEqual(calls[0].args.slice(-5), ['--agent', 'claude', '--project', 'proj', '--if-stale']);
  assert.equal(calls[0].options.detached, true);
  assert.equal(startIndexing('proj', { FSR_HOME: home }, { spawnFn }).reason, 'indicizzazione già in corso');
  assert.equal(calls.length, 1);
});

test('planFsr segnala planned senza venv e setupFsr in dry-run non esegue nulla', () => {
  const home = temp();
  const run = () => { throw Error('non deve eseguire'); };
  const plan = planFsr({ env: { FSR_HOME: home }, run });
  assert.equal(plan.report.status, 'planned');
  assert.equal(plan.report.revision, spec.revision);
  assert.equal(setupFsr(plan, { dry: true, run }).status, 'planned');
});

test('setupFsr installa dal repository ufficiale alla revisione pinnata e scrive il marker', () => {
  const home = temp();
  const calls = [];
  const run = (exe, args) => {
    calls.push([exe, ...args]);
    if (args.includes('venv')) fakeVenv(home);
    return { status: 0, stdout: '', stderr: '' };
  };
  const plan = planFsr({ env: { FSR_HOME: home }, run });
  const report = setupFsr(plan, { run });
  assert.equal(report.status, 'installed');
  const pip = calls.find(call => call.includes('pip'));
  assert.ok(pip.includes('git+https://github.com/manuel-albanesee/FastSkillRetrieval.git@' + spec.revision));
  assert.equal(fs.readFileSync(plan.location.marker, 'utf8').trim(), spec.revision);
  assert.equal(planFsr({ env: { FSR_HOME: home }, run }).report.status, 'present');
});

test('setupFsr senza Python 3.13 o con pip fallito segnala unavailable senza sollevare', () => {
  const home = temp();
  const none = () => ({ status: 1, stderr: '' });
  assert.match(setupFsr(planFsr({ env: { FSR_HOME: home }, run: none }), { run: none }).error, /Python 3\.13/);
  const run = (exe, args) => {
    if (args.includes('venv')) fakeVenv(home);
    return args.includes('pip') ? { status: 1, stderr: 'errore rete' } : { status: 0, stderr: '' };
  };
  const report = setupFsr(planFsr({ env: { FSR_HOME: home }, run: none }), { run });
  assert.equal(report.status, 'unavailable');
  assert.match(report.error, /errore rete/);
});
