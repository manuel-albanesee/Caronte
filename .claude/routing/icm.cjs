const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}
function filePath(root, name, required = false) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name)) throw Error('Usa percorsi relativi al progetto.');
  const base = fs.realpathSync(root), p = path.resolve(base, name);
  if (!inside(base, p)) throw Error('Percorso esterno al progetto: ' + name);
  let existing = p;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  if (!inside(base, fs.realpathSync(existing))) throw Error('Symlink esterno al progetto: ' + name);
  if (required && (!fs.existsSync(p) || !fs.statSync(p).isFile())) throw Error('File necessario assente: ' + name);
  return p;
}
function loadRun(root, name) {
  root = fs.realpathSync(root);
  const manifest = filePath(root, name, true), data = readJSON(manifest);
  if (data.version !== 1 || !/^[a-zA-Z0-9_-]+$/.test(data.runId || '') || !Array.isArray(data.stages) || !data.stages.length) throw Error('Manifest ICM non valido.');
  const seen = new Set();
  for (const s of data.stages) {
    if (!/^[a-zA-Z0-9_-]+$/.test(s.id || '') || seen.has(s.id)) throw Error('ID fase non valido o duplicato.');
    if (!Array.isArray(s.dependsOn) || s.dependsOn.some(d => !seen.has(d))) throw Error('Dipendenze mancanti, cicliche o fuori ordine: ' + s.id);
    if (!Array.isArray(s.inputs) || !Array.isArray(s.outputs) || !s.outputs.length) throw Error('Input/output di fase non validi.');
    for (const p of [s.contract, ...s.inputs, ...s.outputs]) filePath(root, p);
    if (!s.verify || typeof s.verify.command !== 'string' || !s.verify.command.trim() || !Array.isArray(s.verify.args) || s.verify.args.some(a => typeof a !== 'string')) throw Error('Verifica senza comando e args validi: ' + s.id);
    if (s.verify.timeoutMs !== undefined && (!Number.isInteger(s.verify.timeoutMs) || s.verify.timeoutMs < 1 || s.verify.timeoutMs > 600000)) throw Error('timeoutMs deve essere tra 1 e 600000.');
    seen.add(s.id);
  }
  const dirName = path.relative(root, path.join(path.dirname(manifest), '.state-' + data.runId));
  return { root, manifest, data, stateDir: filePath(root, dirName) };
}
function stage(run, id) {
  const s = run.data.stages.find(s => s.id === id);
  if (!s) throw Error('Fase sconosciuta: ' + id);
  return s;
}
function stateFile(run, id) { return path.join(run.stateDir, id + '.json'); }
function digestFiles(run, files) {
  return Object.fromEntries([...new Set(files)].sort().map(p => [p, hash(fs.readFileSync(filePath(run.root, p, true)))]));
}
function inputSnapshot(run, s) {
  const files = digestFiles(run, [s.contract, ...s.inputs]);
  const stamp = hash(JSON.stringify({ version: run.data.version, runId: run.data.runId, stage: s, files,
    dependencies: s.dependsOn.map(d => readJSON(stateFile(run, d)).signature),
  }));
  return { files, stamp };
}
function changedInputFiles(run, s, before) {
  if (!before || typeof before !== 'object' || Array.isArray(before)) return null;
  const current = new Set([s.contract, ...s.inputs]);
  return [...new Set([...Object.keys(before), ...current])].sort().filter(name => {
    if (!current.has(name) || !Object.hasOwn(before, name)) return true;
    try { return before[name] !== digestFiles(run, [name])[name]; }
    catch { return true; }
  });
}
function valid(run, id) {
  try {
    const s = stage(run, id);
    for (const d of s.dependsOn) if (!valid(run, d).ok) return { ok: false, reason: 'dipendenza non valida: ' + d };
    const f = stateFile(run, id);
    if (!fs.existsSync(f)) return { ok: false, reason: 'mai verificata' };
    const record = readJSON(f);
    if (record.status !== 'pass') return { ok: false, reason: record.reason || 'verifica fallita' };
    const current = inputSnapshot(run, s).stamp, outputs = digestFiles(run, s.outputs);
    if (record.inputStamp !== current || JSON.stringify(record.outputs) !== JSON.stringify(outputs)) return { ok: false, reason: 'input, contratto, configurazione o output modificati' };
    if (record.signature !== hash(JSON.stringify({ inputStamp: current, outputs }))) return { ok: false, reason: 'ricevuta incoerente' };
    return { ok: true, reason: 'pass attuale' };
  } catch (e) { return { ok: false, reason: e.message }; }
}
function status(run) {
  const stages = run.data.stages.map(s => {
    const result = valid(run, s.id);
    let record = null;
    try { record = readJSON(stateFile(run, s.id)); } catch {}
    const changed = result.ok && record?.inputFiles ? [] : changedInputFiles(run, s, record?.inputFiles);
    const evidence = record ? {
      status: record.status,
      at: record.at || null,
      log: fs.existsSync(path.join(run.stateDir, s.id + '.log')) ? path.relative(run.root, path.join(run.stateDir, s.id + '.log')) : null,
      current: result.ok,
    } : null;
    return {
      id: s.id,
      objective: typeof s.objective === 'string' ? s.objective : null,
      objectiveAvailable: typeof s.objective === 'string',
      ...result,
      evidence,
      changedInputs: changed,
      changeAttribution: 'unavailable',
      nextStep: result.ok ? 'nessuna: fase verificata' : `rileggi contratto e input della fase ${s.id}, poi esegui la verifica dichiarata`,
    };
  });
  const next = stages.find(s => !s.ok) || null;
  const lastValid = [...stages].reverse().find(s => s.ok) || null;
  return {
    runId: run.data.runId,
    objective: typeof run.data.objective === 'string' ? run.data.objective : null,
    objectiveAvailable: typeof run.data.objective === 'string',
    lastValidEvidence: lastValid ? { stage: lastValid.id, ...lastValid.evidence } : null,
    observedChange: next?.changedInputs ?? (next ? 'non disponibile: nessuna impronta precedente per file' : []),
    next: next?.id || null,
    nextStep: next?.nextStep || 'run completato: tutte le fasi hanno una ricevuta valida',
    stages,
  };
}
function gate(run, id) {
  const s = stage(run, id);
  for (const d of s.dependsOn) {
    const result = valid(run, d);
    if (!result.ok) throw Error(`ICM BLOCCATO ${id}: ${d}, ${result.reason}`);
  }
  digestFiles(run, [s.contract, ...s.inputs]);
  return s;
}
function save(run, id, record) {
  fs.mkdirSync(run.stateDir, { recursive: true });
  const f = stateFile(run, id), tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
  fs.renameSync(tmp, f);
  fs.writeFileSync(path.join(run.stateDir, id + '-check.md'), (record.status === 'pass' ? 'pass' : 'fail: ' + record.reason) + '\n\n' + `Run: ${run.data.runId}\nVerifica: ${id}.log\nData: ${record.at}\n`);
}
function check(run, id) {
  const s = stage(run, id);
  fs.mkdirSync(run.stateDir, { recursive: true });
  const lock = path.join(run.stateDir, '.lock'), fd = fs.openSync(lock, 'wx');
  try {
    save(run, id, { status: 'fail', reason: 'verifica in corso o interrotta', at: new Date().toISOString() });
    gate(run, id);
    const before = inputSnapshot(run, s), log = path.join(run.stateDir, id + '.log');
    const logFd = fs.openSync(log, 'w'); let result;
    try {
      result = spawnSync(s.verify.command, s.verify.args, { cwd: run.root, shell: false,
        timeout: s.verify.timeoutMs || 120000, stdio: ['ignore', logFd, logFd], windowsHide: true });
    } finally { fs.closeSync(logFd); }
    if (result.error || result.status !== 0) throw Error(result.error?.message || 'comando terminato con exit ' + result.status);
    gate(run, id);
    if (before.stamp !== inputSnapshot(run, s).stamp) throw Error('Input modificati durante la verifica; ripetere.');
    const outputs = digestFiles(run, s.outputs);
    const record = { status: 'pass', at: new Date().toISOString(), inputStamp: before.stamp,
      inputFiles: before.files, outputs,
      signature: hash(JSON.stringify({ inputStamp: before.stamp, outputs })) };
    save(run, id, record);
    return { stage: id, status: 'pass', log: path.relative(run.root, log) };
  } catch (e) {
    save(run, id, { status: 'fail', reason: e.message, at: new Date().toISOString() });
    throw e;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function main() {
  try {
    const [action, manifest, id] = process.argv.slice(2);
    if (!['status', 'gate', 'check'].includes(action) || !manifest) throw Error('Uso: node .claude/routing/icm.cjs status|gate|check manifest.json [fase]');
    const run = loadRun(process.env.CLAUDE_PROJECT_DIR || process.cwd(), manifest); let result;
    if (action === 'status') {
      result = status(run);
    } else if (action === 'gate') { gate(run, id); result = { stage: id, ready: true }; }
    else result = check(run, id);
    console.log(JSON.stringify(result));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
if (require.main === module) main();
module.exports = { filePath, loadRun, valid, gate, check, status };
