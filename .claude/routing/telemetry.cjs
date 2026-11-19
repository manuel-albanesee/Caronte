const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { fileContextScan, summarizeFileContext } = require('./file-context.cjs');

const DAY = 86400000;
const RETENTION_DAYS = 30;
const MAX_DAY_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const TOOLS = new Set(['Agent', 'Task', 'Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Monitor', 'Skill']);
const REASONS = new Set(['brief_invalid', 'review_plan', 'icm_gate', 'worker_scope', 'worker_command', 'permission_denied', 'tool_failure']);
const PROFILES = new Set([
  'ricerca-haiku', 'decisione-opus', 'implementazione-haiku', 'implementazione-sonnet',
  'ecc-tdd-guide', 'ecc-build-error-resolver', 'ecc-java-build-resolver', 'ecc-typescript-reviewer',
  'ecc-java-reviewer', 'ecc-csharp-reviewer', 'ecc-code-reviewer',
]);
const date = timestamp => new Date(timestamp).toISOString().slice(0, 10);
const profile = value => PROFILES.has(value) ? value : 'other';
const model = value => typeof value === 'string' &&
  /^(?:claude-)?(?:haiku|sonnet|opus)-\d{1,2}(?:-\d{1,2})?(?:-\d{8})?$/.test(value) ? value : 'other';

function directory(root) {
  const dotGit = path.join(root, '.git');
  const entry = fs.lstatSync(dotGit, { throwIfNoEntry: false });
  if (!entry) throw Error('Local telemetry requires the root of a Git worktree.');
  let gitDir = dotGit;
  if (!entry.isDirectory()) {
    const result = spawnSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: root, encoding: 'utf8', timeout: 2000, windowsHide: true,
    });
    if (result.status !== 0) throw Error('Cannot locate Git metadata.');
    gitDir = result.stdout.trim();
  }
  const dir = path.join(fs.realpathSync(gitDir), 'caronte-telemetry');
  const local = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (local && !local.isDirectory()) throw Error('Unexpected telemetry storage path.');
  return dir;
}

function config(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    if (raw.enabled === true && /^[0-9a-f]{64}$/.test(raw.key) && Number.isSafeInteger(raw.since)) return { ...raw, initialized: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { enabled: false, initialized: false };
    // An invalid configuration stays off until explicitly changed.
  }
  return { enabled: false, initialized: true };
}

function cleanup(dir, now) {
  const cutoff = date(now - (RETENTION_DAYS - 1) * DAY);
  for (const name of fs.readdirSync(dir)) {
    if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) < cutoff) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }
}

function setMode(root, enabled, now = Date.now()) {
  const dir = directory(root);
  const old = config(dir);
  if (old.initialized && old.enabled === enabled) return { enabled };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const next = enabled ? { enabled, since: now, key: crypto.randomBytes(32).toString('hex') } : { enabled };
  const temp = path.join(dir, crypto.randomUUID() + '.tmp');
  fs.writeFileSync(temp, JSON.stringify(next) + '\n', { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(temp, path.join(dir, 'config.json')); }
  finally { fs.rmSync(temp, { force: true }); }
  cleanup(dir, now);
  return { enabled };
}

function initialize(root, now = Date.now()) {
  try {
    const dir = directory(root);
    const state = config(dir);
    if (state.initialized) return state.enabled;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const initial = { enabled: true, since: now, key: crypto.randomBytes(32).toString('hex') };
    try { fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(initial) + '\n', { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return config(dir).enabled;
  } catch { return false; }
}

function readStatus(root) {
  try { return config(directory(root)).enabled; }
  catch { return false; }
}

function capture(root, build) {
  try {
    const dir = directory(root);
    const state = config(dir);
    if (!state.enabled) return;
    const now = Date.now();
    const fingerprint = value => typeof value === 'string' && value.length
      ? crypto.createHmac('sha256', state.key).update(value).digest('hex').slice(0, 24) : undefined;
    const rows = build(fingerprint, state.since);
    if (!rows?.length || config(dir).key !== state.key) return;
    const file = path.join(dir, date(now) + '.jsonl');
    const size = fs.lstatSync(file, { throwIfNoEntry: false });
    if (size && (!size.isFile() || size.size >= MAX_DAY_BYTES)) return;
    if (!size) cleanup(dir, now);
    let remaining = MAX_DAY_BYTES - (size?.size || 0);
    const batch = [];
    for (const row of rows) {
      const line = JSON.stringify({ v: 1, at: now, ...row }) + '\n';
      remaining -= Buffer.byteLength(line);
      if (remaining < 0) break;
      batch.push(line);
    }
    if (batch.length) fs.appendFileSync(file, batch.join(''), { mode: 0o600 });
  } catch {
    // Telemetry is optional and must never block the parent workflow.
  }
}

function operation(event) {
  const input = event.tool_input || {};
  if (event.tool_name === 'Agent' || event.tool_name === 'Task') {
    return JSON.stringify([String(input.prompt || '').trim(), profile(input.subagent_type)]);
  }
  if (event.tool_name === 'Bash' || event.tool_name === 'PowerShell') return String(input.command || '').trim();
  return JSON.stringify(input);
}

function toolEvent(root, event, outcome, reason, outputFilter) {
  if (!TOOLS.has(event.tool_name)) return;
  if (!['ok', 'failed', 'blocked'].includes(outcome)) return;
  capture(root, hash => [{
    type: 'tool', outcome, tool: event.tool_name, reason: REASONS.has(reason) ? reason : undefined,
    run: hash(event.session_id), actor: event.agent_id ? hash(event.agent_id) : 'main',
    profile: event.agent_id ? profile(event.agent_type) : 'orchestrator',
    call: hash(event.tool_use_id),
    op: hash(event.tool_name + '\0' + operation(event)),
    output_filter: outcome === 'ok' && outputFilter ? {
      stdout_before_bytes: outputFilter.stdout_before_bytes,
      stdout_after_bytes: outputFilter.stdout_after_bytes,
      lines_omitted: outputFilter.lines_omitted,
    } : undefined,
  }]);
}

function deliveryEvent(root, { type, session, actor, profile: agentProfile, id, inputTree, outcome, durationMs, checks }) {
  if (!['test', 'review'].includes(type)) return;
  if (!['pass', 'fail', 'stale', 'not-run', 'not-applicable'].includes(outcome)) return;
  capture(root, hash => [{
    type, run: hash(session), actor: hash(actor) || 'main', plan: hash(id),
    profile: type === 'review' ? 'orchestrator' : profile(agentProfile),
    outcome, inputs: hash(inputTree), duration_ms: Number.isSafeInteger(durationMs) ? durationMs : undefined,
    checks: Number.isSafeInteger(checks) ? checks : undefined,
  }]);
}

function tail(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('.jsonl')) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    const start = Math.max(0, stat.size - MAX_TRANSCRIPT_BYTES);
    const bytes = Buffer.alloc(stat.size - start);
    const read = fs.readSync(fd, bytes, 0, bytes.length, start);
    const lines = bytes.subarray(0, read).toString('utf8').split('\n');
    if (start) lines.shift();
    return { lines, truncated: start > 0 };
  } finally { fs.closeSync(fd); }
}

function collectUsage(root, event) {
  capture(root, (hash, since) => {
    const isChild = event.hook_event_name === 'SubagentStop';
    const reading = tail(isChild ? event.agent_transcript_path : event.transcript_path);
    if (!reading) return [];
    const rows = new Map();
    const scope = {
      run: hash(event.session_id),
      actor: isChild ? hash(event.agent_id) : 'main',
      profile: isChild ? profile(event.agent_type) : 'orchestrator',
    };
    const files = fileContextScan(hash, scope);
    for (const line of reading.lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record?.sessionId !== event.session_id) continue;
      const at = Date.parse(record.timestamp);
      if (!(at >= since)) continue;
      if (isChild || !record.isSidechain) files.observe(record, at);
      if (record.type !== 'assistant') continue;
      const msg = record.message;
      const usage = msg?.usage;
      if (!usage || typeof msg.id !== 'string' || !msg.id.startsWith('msg_')) continue;
      if (!Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens)) continue;
      const get = key => Number.isSafeInteger(usage[key]) && usage[key] >= 0 ? usage[key] : 0;
      const key = hash(event.session_id + '\0' + msg.id);
      rows.set(key, {
        type: 'usage', ...scope, sample: key, model: model(msg.model), occurred_at: at,
        input: get('input_tokens'), output: get('output_tokens'),
        cache_read: get('cache_read_input_tokens'), cache_write: get('cache_creation_input_tokens'),
      });
    }
    return [
      { type: 'coverage', ...scope, usage_found: rows.size > 0, transcript_truncated: reading.truncated,
        file_context_text_reads: files.textReadsFound },
      ...rows.values(),
      ...files.rows.values(),
    ];
  });
}

function count(map, key) { map[key] = (map[key] || 0) + 1; }

function summarize(root, days = 7, now = Date.now()) {
  if (!Number.isInteger(days) || days < 1 || days > RETENTION_DAYS) throw Error('Use a time range from 1 to 30 days.');
  const dir = directory(root);
  const rows = [];
  const from = date(now - (days - 1) * DAY);
  const to = date(now);
  if (fs.existsSync(dir)) {
    cleanup(dir, now);
    for (const file of fs.readdirSync(dir).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) || file.slice(0, 10) < from || file.slice(0, 10) > to) continue;
      const full = path.join(dir, file);
      const stat = fs.lstatSync(full);
      if (!stat.isFile() || stat.size > MAX_DAY_BYTES + 8192) continue;
      for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        try { const row = JSON.parse(line); if (row.v === 1 && Number.isSafeInteger(row.at)) rows.push(row); } catch {}
      }
    }
  }
  rows.sort((a, b) => a.at - b.at);
  const sessions = new Set();
  const usages = new Map();
  const fileSamples = new Map();
  const coverage = new Map();
  const failures = new Map();
  const toolCalls = new Set();
  const filteredCalls = new Set();
  const outputFilter = { calls: 0, stdoutBytesBefore: 0, stdoutBytesAfter: 0, stdoutBytesRemoved: 0, linesOmitted: 0 };
  const blocks = {};
  const retries = {};
  const generations = new Map();
  const targetedChecks = { pass: 0, fail: 0, stale: 0 };
  const reviews = { pass: 0, fail: 0, stale: 0, 'not-run': 0, 'not-applicable': 0 };
  for (const row of rows) {
    if (row.run) sessions.add(row.run);
    if (['usage', 'file_context'].includes(row.type) && row.sample && Number.isSafeInteger(row.occurred_at)) {
      const day = date(row.occurred_at);
      if (day >= from && day <= to) (row.type === 'usage' ? usages : fileSamples).set(row.sample, row);
    }
    if (row.type === 'coverage') coverage.set((row.run || '') + ':' + (row.actor || 'main'), row);
    if (row.type === 'test') count(targetedChecks, row.outcome);
    if (row.type === 'review') count(reviews, row.outcome);
    if (row.type !== 'tool') continue;
    const measurement = row.output_filter;
    if (row.outcome === 'ok' && measurement && (!row.call || !filteredCalls.has(row.call))) {
      const { stdout_before_bytes: before, stdout_after_bytes: after, lines_omitted: lines } = measurement;
      if ([before, after, lines].every(Number.isSafeInteger) && after >= 0 && before > after && lines > 0) {
        if (row.call) filteredCalls.add(row.call);
        outputFilter.calls++;
        outputFilter.stdoutBytesBefore += before;
        outputFilter.stdoutBytesAfter += after;
        outputFilter.stdoutBytesRemoved += before - after;
        outputFilter.linesOmitted += lines;
      }
    }
    if (row.call && toolCalls.has(row.call)) continue;
    if (row.call) toolCalls.add(row.call);
    const generation = generations.get(row.run) || 0;
    const operation = [row.run, generation, row.actor, row.tool, row.op].join(':');
    if (row.outcome === 'ok') {
      failures.delete(operation);
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(row.tool)) generations.set(row.run, generation + 1);
      continue;
    }
    if (row.outcome === 'blocked') count(blocks, row.reason);
    if (!row.run || !row.op || !row.call) continue;
    const previous = failures.get(operation);
    if (previous && previous.reason === row.reason && row.at - previous.at <= 15 * 60 * 1000) count(retries, row.reason);
    failures.set(operation, row);
  }
  const byModel = {};
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const usageSessions = new Set();
  const usageByDay = new Map();
  for (const row of usages.values()) {
    const key = model(row.model);
    const day = date(row.occurred_at);
    usageByDay.set(day, (usageByDay.get(day) || 0) + 1);
    const totals = byModel[key] ??= { input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 };
    for (const field of Object.keys(tokens)) {
      if (!Number.isSafeInteger(row[field]) || row[field] < 0) continue;
      totals[field] += row[field];
      tokens[field] += row[field];
    }
    if (row.run) usageSessions.add(row.run);
    totals.calls++;
  }
  return {
    schema: 1, enabled: config(dir).enabled, from, to, sessions: sessions.size,
    usage: { sessions: usageSessions.size, calls: usages.size, tokens: usages.size ? tokens : null, byModel,
      truncatedScans: [...coverage.values()].filter(row => row.transcript_truncated).length },
    blocks, retries, targetedChecks, reviews, outputFilter,
    usageDaily: Array.from({ length: (Date.parse(to) - Date.parse(from)) / DAY + 1 }, (_, index) => {
      const day = date(Date.parse(from) + index * DAY);
      return { day, calls: usageByDay.get(day) ?? null };
    }),
    fileContext: summarizeFileContext(fileSamples.values(), coverage.values()),
  };
}

function writeDashboard(root) {
  const dir = directory(root);
  const now = Date.now();
  const reports = { 7: summarize(root, 7, now), 30: summarize(root, 30, now) };
  const data = JSON.stringify(reports).replaceAll('<', '\\u003c');
  const template = fs.readFileSync(path.join(__dirname, 'telemetry-dashboard.html'), 'utf8');
  const html = template.replace('/* CARONTE_REPORTS */ null', () => data);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'dashboard.html');
  const temp = path.join(dir, crypto.randomUUID() + '.tmp');
  fs.writeFileSync(temp, html, { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return file;
}

if (require.main === module) {
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const [command = 'status', days] = process.argv.slice(2);
    if (command === 'on') {
      setMode(root, true);
      console.log('Caronte: telemetria locale attiva per questo worktree. Disattiva con /caronte-telemetry-off.');
    } else if (command === 'off') {
      setMode(root, false);
      console.log('Caronte: telemetria locale disattivata. I dati già raccolti restano locali.');
    } else if (command === 'status') {
      console.log(JSON.stringify({ enabled: readStatus(root) }));
    } else if (command === 'report') {
      console.log(JSON.stringify(summarize(root, days === undefined ? 7 : Number(days)), null, 2));
    } else if (command === 'dashboard') {
      console.log(writeDashboard(root));
    } else if (command === 'purge') {
      const dir = directory(root);
      setMode(root, false);
      if (fs.existsSync(dir)) for (const file of fs.readdirSync(dir)) {
        if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) || file === 'dashboard.html') fs.rmSync(path.join(dir, file), { force: true });
      }
      console.log('Caronte: dati di telemetria del worktree eliminati, raccolta disattivata.');
    } else throw Error('Usage: node .claude/routing/telemetry.cjs on|off|status|report [days]|dashboard|purge');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { initialize, setMode, readStatus, toolEvent, deliveryEvent, collectUsage, summarize, directory };
