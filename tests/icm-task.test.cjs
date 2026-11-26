const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { loadRun, check } = require('../.claude/routing/icm.cjs');

const kit = path.resolve(__dirname, '..');
const hook = path.join(kit, '.claude', 'hooks', 'icm-task.cjs');
const manifest = '.icm/task/run.json';
function write(root, name, text) { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icm task-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [n, v] of Object.entries({ 'input.txt': 'a', 'contract-a.md': 'A', 'out-a.txt': 'A' })) write(root, n, v);
  write(root, manifest, JSON.stringify({ version: 1, runId: 'task-1', stages: [
    { id: 'a', contract: 'contract-a.md', inputs: ['input.txt'], outputs: ['out-a.txt'], dependsOn: [], verify: { command: process.execPath, args: ['-e', 'process.exit(0)'] } },
  ] }));
  return root;
}
function run(root, event, raw) {
  return spawnSync(process.execPath, [hook], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: raw ?? JSON.stringify(event), encoding: 'utf8' });
}
const completed = (subject, description = '') => ({ hook_event_name: 'TaskCompleted', task_id: '1', task_subject: subject, task_description: description });
const created = (subject, description = '') => ({ hook_event_name: 'TaskCreated', task_id: '1', task_subject: subject, task_description: description });

test('TaskCompleted blocca una fase non certificata', t => {
  const root = fixture(t);
  const r = run(root, completed('Fase a [ICM:' + manifest + '/a]'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ricevuta valida/);
});
test('TaskCompleted consente dopo il check e blocca di nuovo se gli input cambiano', t => {
  const root = fixture(t);
  check(loadRun(root, manifest), 'a');
  assert.equal(run(root, completed('x', 'dettaglio [ICM:' + manifest + '/a]')).status, 0);
  write(root, 'input.txt', 'cambiato');
  assert.equal(run(root, completed('x [ICM:' + manifest + '/a]')).status, 2);
});
test('senza marcatore consente', t => {
  const root = fixture(t);
  assert.equal(run(root, completed('task libero')).status, 0);
  assert.equal(run(root, created('task libero')).status, 0);
});
test('TaskCreated blocca run o fase inesistenti e consente quelli validi', t => {
  const root = fixture(t);
  assert.equal(run(root, created('[ICM:.icm/nessuno/run.json/a]')).status, 2);
  const missing = run(root, created('[ICM:' + manifest + '/zzz]'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /zzz/);
  assert.equal(run(root, created('Fase a [ICM:' + manifest + '/a]')).status, 0);
});
test('fail-open su stdin illeggibile o manifest non valido', t => {
  const root = fixture(t);
  assert.equal(run(root, null, '{broken').status, 0);
  write(root, manifest, '{non json');
  assert.equal(run(root, completed('[ICM:' + manifest + '/a]')).status, 0);
  assert.equal(run(root, created('[ICM:' + manifest + '/a]')).status, 0);
  assert.equal(run(root, completed('[ICM:../fuori/run.json/a]')).status, 0);
});
