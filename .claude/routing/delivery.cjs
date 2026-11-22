const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { deliveryEvent } = require('./telemetry.cjs');
const { filePath } = require('./icm.cjs');

const runner = 'node .claude/routing/delivery.cjs';
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const writingProfiles = new Set(['implementazione-haiku', 'implementazione-sonnet', 'ecc-tdd-guide', 'ecc-build-error-resolver', 'ecc-java-build-resolver']);
const readingProfiles = new Set(['ricerca-haiku', 'decisione-opus', 'ecc-typescript-reviewer', 'ecc-java-reviewer', 'ecc-csharp-reviewer', 'ecc-code-reviewer']);
const eccFull = () => process.env.CARONTE_ECC_FULL === '1';
const isKitProfile = profile => writingProfiles.has(profile) || readingProfiles.has(profile);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function save(file, data) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function git(root, args, env = process.env) {
  const result = spawnSync('git', ['--literal-pathspecs', ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 24 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0) throw Error((result.stderr || result.error?.message || 'Git non riuscito').trim());
  return result.stdout;
}
function locate(root) {
  root = fs.realpathSync.native(root);
  const gitRoot = fs.realpathSync.native(git(root, ['rev-parse', '--show-toplevel']).trim());
  if (gitRoot !== root) throw Error('Esegui dalla root del worktree Git del progetto.');
  return { root, state: path.join(git(root, ['rev-parse', '--absolute-git-dir']).trim(), 'claude-routing-work') };
}
function relativeFile(root, name, write = false) {
  if (typeof name !== 'string' || /[\\\x00-\x1f]/.test(name) || name.split('/').some(part => ['', '.', '..'].includes(part))) {
    throw Error('Usa un percorso file relativo con slash: ' + name);
  }
  if (/^\.git(?:\/|$)/i.test(name) ||
      (write && /^\.claude\/(?:routing\/|hooks\/|settings[^/]*\.json$)/i.test(name))) {
    throw Error('File di controllo riservato all’orchestratore: ' + name);
  }
  const file = filePath(root, name);
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file)) {
    throw Error('Il piano richiede file regolari, senza link: ' + name);
  }
  return file;
}
function tree(root, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-routing-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
    git(root, ['read-tree', '--empty'], env);
    const existing = files.filter(name => fs.existsSync(relativeFile(root, name)));
    if (existing.length) git(root, ['add', '-f', '--', ...existing], env);
    return git(root, ['write-tree'], env).trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function testCommand(root, test) {
  if (!test || typeof test.because !== 'string' || !test.because.trim()) throw Error('Indica perché ogni test è impattato.');
  const identified = (value, pattern) => {
    if (typeof value !== 'string' || !pattern.test(value)) throw Error('Selettore di test mancante o troppo ampio.');
    return value;
  };
  const fullName = /^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)+$/;
  const exactName = () => {
    const text = identified(test.selector, /^[^\x00-\x1f]{1,200}$/);
    return '^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  };
  const fileFor = suffix => {
    const file = relativeFile(root, test.file);
    if (!suffix.test(test.file)) throw Error('File test/progetto inadatto a ' + test.runner);
    return file;
  };
  switch (test.runner) {
    case 'node':
      return [process.execPath, ['--test', '--test-reporter=tap', ...(test.selector ? ['--test-name-pattern', exactName()] : []), fileFor(/\.[cm]?js$/i)], root];
    case 'vitest':
      return [process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...(test.selector ? ['-t', exactName()] : []), fileFor(/\.[cm]?[jt]sx?$/i)], root];
    case 'jest':
      return [process.execPath, [path.join(root, 'node_modules/jest/bin/jest.js'), '--runInBand', '--runTestsByPath', ...(test.selector ? ['-t', exactName()] : []), fileFor(/\.[cm]?[jt]sx?$/i)], root];
    case 'pytest':
      return [process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pytest', fileFor(/\.py$/i) +
        (test.selector ? '::' + identified(test.selector, /^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)?$/) : '')], root];
    case 'dotnet':
      return ['dotnet', ['test', fileFor(/\.(?:cs|fs|vb)proj$/i), '--filter', 'FullyQualifiedName=' + identified(test.selector, fullName)], root];
    case 'maven': {
      const dir = path.dirname(fileFor(/(?:^|\/)pom\.xml$/i));
      const selector = identified(test.selector, /^[A-Za-z_][\w.]*(?:#[A-Za-z_]\w*)?$/);
      const args = ['-Dtest=' + selector, 'test'];
      return process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'mvn', ...args], dir] : ['mvn', args, dir];
    }
    case 'gradle': {
      const dir = path.dirname(fileFor(/(?:^|\/)gradlew(?:\.bat)?$/));
      const task = identified(test.task, /^(?::[A-Za-z][\w-]*)*:test$/);
      const args = [task, '--tests', identified(test.selector, fullName)];
      return process.platform === 'win32'
        ? ['cmd.exe', ['/d', '/c', 'gradlew.bat', ...args], dir]
        : [path.join(dir, 'gradlew'), args, dir];
    }
    default:
      throw Error('Runner mirato non previsto: ' + test.runner + '. La verifica alternativa spetta all’orchestratore.');
  }
}

function plan(root, spec) {
  const repo = locate(root);
  if (!spec || typeof spec.profile !== 'string' || !/^[\w:.-]+$/.test(spec.profile) || readingProfiles.has(spec.profile)) throw Error('Profilo di scrittura mancante.');
  if (!Array.isArray(spec.files) || !spec.files.length || !Array.isArray(spec.tests)) throw Error('Indica i file scrivibili e il piano dei test.');
  for (const name of spec.files) relativeFile(repo.root, name, true);
  for (const test of spec.tests) testCommand(repo.root, test);
  if (!spec.tests.length && (typeof spec.noTestsReason !== 'string' || !spec.noTestsReason.trim())) {
    throw Error('Indica un motivo se la modifica non ha test applicativi pertinenti.');
  }
  if (spec.inputs !== undefined && !Array.isArray(spec.inputs)) throw Error('inputs deve essere un array di file.');
  if (spec.criteria !== undefined && (!Array.isArray(spec.criteria) || spec.criteria.some(c =>
    !c || typeof c.id !== 'string' || !/^[\w.-]{1,80}$/.test(c.id) ||
    typeof c.description !== 'string' || !c.description.trim()) ||
    new Set(spec.criteria.map(c => c.id)).size !== spec.criteria.length)) {
    throw Error('criteria deve contenere ID univoci e descrizioni non vuote.');
  }
  const files = [...new Set(spec.files)];
  const inputs = [...new Set([...files, ...spec.tests.map(t => t.file), ...(spec.inputs || [])])];
  const id = randomUUID();
  const baseline = tree(repo.root, files);
  for (const input of inputs) relativeFile(repo.root, input);
  fs.mkdirSync(path.join(repo.state, id), { recursive: true, mode: 0o700 });
  save(path.join(repo.state, id, 'plan.json'), { ...spec, id, files, inputs, baseline });
  return { id, files, tests: spec.tests, command: runner + ' check ' + id };
}
function handoff(root, id, report) {
  const repo = locate(root), spec = load(repo, id);
  if (!Array.isArray(spec.criteria) || !spec.criteria.length) throw Error('Il piano non dichiara criteri di accettazione.');
  if (!report || !Array.isArray(report.criteria)) throw Error('Il resoconto deve contenere l’esito di ogni criterio.');
  const expected = new Map(spec.criteria.map(item => [item.id, item]));
  if (report.criteria.length !== expected.size) throw Error('Il resoconto deve coprire tutti i criteri, senza duplicati.');
  const seen = new Set();
  const criteria = report.criteria.map(item => {
    if (!item || !expected.has(item.id) || seen.has(item.id)) throw Error('Criterio sconosciuto o duplicato: ' + item?.id);
    seen.add(item.id);
    if (!['soddisfatto', 'non soddisfatto', 'non verificato'].includes(item.outcome) ||
        typeof item.evidence !== 'string' || !item.evidence.trim() ||
        !(item.openConstraint === null || item.openConstraint === undefined ||
          (typeof item.openConstraint === 'string' && item.openConstraint.trim()))) {
      throw Error('Ogni criterio richiede outcome, prova e vincolo aperto (testo o null): ' + item.id);
    }
    return { id: item.id, description: expected.get(item.id).description, outcome: item.outcome,
      evidence: item.evidence.trim(), openConstraint: item.openConstraint ?? null };
  });
  const file = path.join(repo.state, id, 'worker-handoff.json');
  save(file, { criteria, reportedAt: new Date().toISOString() });
  return { file, criteria };
}
function load(repo, id) {
  if (!idPattern.test(id || '')) throw Error('REVIEW_ID non valido.');
  return read(path.join(repo.state, id, 'plan.json'));
}
function active(repo) {
  try { return read(path.join(repo.state, 'active.json')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function assignmentFor(repo, event) {
  const grant = active(repo);
  if (!grant || grant.session !== event.session_id) return null;
  return { grant, spec: load(repo, grant.id) };
}
function matchesAssignment(assignment, event) {
  if (!assignment) return false;
  return assignment.spec.profile === event.agent_type || assignment.grant.agent === event.agent_id;
}
function isManagedWorker(root, event) {
  if (!event.agent_id) return false;
  if (isKitProfile(event.agent_type)) return true;
  return matchesAssignment(assignmentFor(locate(root), event), event);
}
function authorize(root, id, event) {
  const repo = locate(root), spec = load(repo, id);
  if (event.agent_id || !event.session_id) throw Error('Solo la sessione orchestratore può aprire una delega scrivibile.');
  if (event.tool_input?.isolation === 'worktree') throw Error('Prepara ed esegui il piano nello stesso worktree del worker.');
  if (spec.profile !== event.tool_input?.subagent_type) throw Error('Il profilo della delega deve corrispondere al piano.');
  if (fs.existsSync(path.join(repo.state, id, 'review.json'))) throw Error('Piano già revisionato. Prepara un nuovo REVIEW_ID.');
  const grant = active(repo);
  if (grant?.id === id && grant.session === event.session_id && !grant.agent) return;
  if (grant) throw Error('Chiudi la delega scrivibile precedente con review ' + grant.id + '.');
  if (spec.baseline !== tree(repo.root, spec.files)) throw Error('Baseline superata. Ricrea il piano prima di delegare.');
  fs.writeFileSync(path.join(repo.state, 'active.json'), JSON.stringify({ id, session: event.session_id }), { flag: 'wx', mode: 0o600 });
}
function enforceWorker(root, event) {
  if (!event.agent_id) return;
  const repo = locate(root);
  const assignment = assignmentFor(repo, event);
  if (eccFull() && !isKitProfile(event.agent_type) && !matchesAssignment(assignment, event)) return;
  const shell = ['Bash', 'PowerShell'].includes(event.tool_name);
  const edit = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(event.tool_name);
  if (!shell && !edit) throw Error('Usa gli strumenti del profilo; per shell e test usa il piano mirato dell’orchestratore.');
  if (!assignment) throw Error('Nessun piano scrivibile attivo per questo worker.');
  const { grant, spec } = assignment;
  if (spec.profile !== event.agent_type || (grant.agent && grant.agent !== event.agent_id)) throw Error('Il piano è assegnato a un altro worker.');
  if (shell) {
    if (!spec.tests.length || event.tool_input?.command !== runner + ' check ' + grant.id) {
      throw Error('Il worker può eseguire solo il comando di test mirato del brief. La suite completa spetta all’orchestratore.');
    }
    if (fs.realpathSync.native(event.cwd || root) !== repo.root) throw Error('Esegui il test dalla root del piano.');
    if (event.tool_input?.run_in_background) throw Error('Il test mirato deve terminare prima della consegna.');
  } else {
    const target = event.tool_input?.file_path ?? event.tool_input?.notebook_path;
    if (typeof target !== 'string') throw Error('Percorso di modifica mancante.');
    const absolute = path.resolve(event.cwd || repo.root, target);
    if (!spec.files.some(file => relativeFile(repo.root, file, true) === absolute)) throw Error('File fuori dal perimetro scrivibile: ' + target);
  }
  if (!grant.agent) save(path.join(repo.state, 'active.json'), { ...grant, agent: event.agent_id });
}
function check(root, id) {
  const started = Date.now();
  const repo = locate(root), spec = load(repo, id);
  const grant = active(repo);
  if (grant?.id !== id || !grant.agent || !spec.tests.length) throw Error('Nessun test mirato autorizzato per questo piano.');
  const dir = path.join(repo.state, id);
  const receipt = path.join(dir, 'test.json');
  fs.rmSync(receipt, { force: true });
  const before = tree(repo.root, spec.inputs);
  const runDir = fs.mkdtempSync(path.join(dir, 'check-'));
  const results = spec.tests.map((test, index) => {
    const [command, args, cwd] = testCommand(repo.root, test);
    const report = path.join(runDir, (index + 1) + '.json');
    if (test.runner === 'vitest') args.push('--reporter=json', '--outputFile', report);
    if (test.runner === 'jest') args.push('--json', '--outputFile', report);
    const log = path.join(runDir, (index + 1) + '.log');
    const fd = fs.openSync(log, 'w', 0o600);
    let result;
    try {
      const env = { ...process.env, DOTNET_CLI_UI_LANGUAGE: 'en-US' };
      if (test.runner === 'node') delete env.NODE_TEST_CONTEXT;
      result = spawnSync(command, args, {
        cwd, stdio: ['ignore', fd, fd], timeout: 300000, windowsHide: true,
        env,
      });
    } finally { fs.closeSync(fd); }
    let noMatches = false, tail;
    if (['dotnet', 'node'].includes(test.runner) || result.status !== 0) {
      const end = fs.statSync(log).size;
      const n = Math.min(end, 8192);
      const last = Buffer.alloc(n);
      const stream = fs.openSync(log, 'r');
      try { fs.readSync(stream, last, 0, n, end - n); }
      finally { fs.closeSync(stream); }
      tail = last.toString('utf8');
      noMatches = test.runner === 'dotnet' && /no test matches|no test is available|total:\s*0\b/i.test(tail);
      if (test.runner === 'node') noMatches = /^1\.\.0\r?$/m.test(tail) || !/^# pass [1-9]\d*\r?$/m.test(tail);
    }
    if (result.status === 0 && ['vitest', 'jest'].includes(test.runner)) {
      noMatches = !fs.existsSync(report) || !(read(report).numPassedTests > 0);
    }
    const error = result.error?.code || (noMatches ? 'Filtro senza test corrispondenti' : undefined);
    return { runner: test.runner, file: test.file, selector: test.selector, exitCode: result.status, error, log,
      ...((result.status !== 0 || error) && tail ? { tail: tail.slice(-1200) } : {}) };
  });
  const unchanged = before === tree(repo.root, spec.inputs);
  const ok = unchanged && results.every(r => r.exitCode === 0 && !r.error);
  save(receipt, { tree: before, ok, results });
  deliveryEvent(repo.root, { type: 'test', session: grant.session, actor: grant.agent, profile: spec.profile,
    id, inputTree: before, outcome: !unchanged ? 'stale' : ok ? 'pass' : 'fail',
    durationMs: Date.now() - started, checks: results.length });
  return { ok, unchanged, results, receipt };
}
function review(root, id) {
  const repo = locate(root), spec = load(repo, id);
  const dir = path.join(repo.state, id);
  const current = tree(repo.root, spec.files);
  const patch = path.join(dir, 'review.diff');
  fs.writeFileSync(patch, git(repo.root, ['diff', '--no-ext-diff', '--no-textconv', '--binary', spec.baseline, current]), { mode: 0o600 });
  let checks = 'not-run', freshness = 'unverified', testEvidence = [];
  const receipt = path.join(dir, 'test.json');
  if (!spec.tests.length) checks = 'not-applicable';
  else if (fs.existsSync(receipt)) {
    const report = read(receipt);
    freshness = report.tree === tree(repo.root, spec.inputs) ? 'current' : 'obsolete';
    checks = freshness === 'obsolete' ? 'stale' : report.ok ? 'pass' : 'fail';
    testEvidence = (report.results || []).map(result => ({
      runner: result.runner, file: result.file, selector: result.selector || null,
      outcome: result.exitCode === 0 && !result.error ? 'pass' : 'fail',
      exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
      error: result.error || null,
      log: result.log,
    }));
  }
  const changed = git(repo.root, ['diff', '--name-only', '-z', spec.baseline, current]).split('\0').filter(Boolean);
  const result = {
    patch, changed, diff: changed.length ? 'present' : 'empty', checks,
    testEvidence,
    suite: 'not-run',
    freshness,
    nextCheck: checks === 'pass' ? 'orchestratore: revisione del diff; poi suite completa se pertinente'
      : checks === 'stale' ? 'ripetere i test mirati dopo le modifiche successive'
        : checks === 'fail' ? 'risolvere il fallimento e ripetere i test mirati'
          : spec.tests.length ? 'eseguire i test mirati dichiarati nel piano' : 'nessun test applicativo: ' + (spec.noTestsReason || 'motivo non disponibile'),
    ...(fs.existsSync(receipt) ? { receipt } : {}), noTestsReason: spec.noTestsReason,
  };
  if (Array.isArray(spec.criteria) && spec.criteria.length) {
    let report = null;
    try { report = read(path.join(dir, 'worker-handoff.json')); } catch {}
    const reported = new Map((Array.isArray(report?.criteria) ? report.criteria : [])
      .filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
    result.criteria = spec.criteria.map(item => reported.get(item.id) || {
      ...item, outcome: 'non verificato', evidence: null, openConstraint: 'handoff del worker non registrato',
    });
    result.acceptance = result.criteria.every(item => item.outcome === 'soddisfatto' && item.evidence && !item.openConstraint)
      ? 'worker-reported-met-pending-coordinator-review' : 'blocked';
    if (result.acceptance === 'blocked' && ['pass', 'not-applicable'].includes(checks)) {
      result.nextCheck = 'chiarire o verificare i criteri di accettazione aperti prima di accettare il lavoro';
    }
    result.workerHandoff = report ? path.join(dir, 'worker-handoff.json') : null;
  }
  save(path.join(dir, 'review.json'), result);
  const grant = active(repo);
  if (grant?.id === id) {
    fs.unlinkSync(path.join(repo.state, 'active.json'));
    if (changed.length) deliveryEvent(repo.root, { type: 'review', session: grant.session, id, inputTree: current, outcome: checks });
  }
  return result;
}
if (require.main === module) {
  try {
    const [action, value, reportPath] = process.argv.slice(2), root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let result;
    if (action === 'plan') result = plan(root, read(value === '-' ? 0 : value));
    else if (action === 'check') {
      result = check(root, value);
      if (!result.ok) process.exitCode = 1;
    } else if (action === 'review') result = review(root, value);
    else if (action === 'handoff') {
      if (!reportPath) throw Error('Uso: ' + runner + ' handoff <id> <file.json>');
      result = handoff(root, value, read(reportPath));
    }
    else throw Error('Uso: ' + runner + ' plan <file.json|-> | check <id> | handoff <id> <file.json> | review <id>');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {
  plan, authorize, enforceWorker, check, handoff, review, readingProfiles, writingProfiles,
  eccFull, isKitProfile, isManagedWorker,
};
