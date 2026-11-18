const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const telemetry = require('../.claude/routing/telemetry.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte telemetry '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  const dir = path.join(root, '.git', 'caronte-telemetry');
  const rows = () => fs.readdirSync(dir).filter(x => x.endsWith('.jsonl'))
    .map(x => fs.readFileSync(path.join(dir, x), 'utf8')).join('');
  return { root, dir, rows };
}

const shell = (id, tool = 'Bash') => ({
  tool_name: tool, tool_use_id: id,
  session_id: 'private-session-id',
  agent_id: 'private-agent-id',
  agent_type: 'private-custom-agent',
  tool_input: { command: 'echo private-command-value', file_path: '/private/project/path' },
  tool_response: { out: 'private-response-value' },
});

test('startup enables telemetry by default, off persists and purge removes data', t => {
  const { root, dir, rows } = fixture(t);
  telemetry.toolEvent(root, shell('one'), 'blocked', 'worker_command');
  assert.equal(fs.existsSync(dir), false);

  assert.equal(telemetry.initialize(root), true);
  telemetry.toolEvent(root, shell('one'), 'blocked', 'worker_command');
  assert.match(rows(), /worker_command/);
  assert.doesNotMatch(rows(), /private|echo/);

  telemetry.setMode(root, false);
  assert.equal(telemetry.initialize(root), false);
  const after = rows();
  telemetry.toolEvent(root, shell('two'), 'blocked', 'worker_command');
  assert.equal(rows(), after);
  const script = path.join(__dirname, '../.claude/routing/telemetry.cjs');
  const result = spawnSync(process.execPath, [script, 'purge'], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(rows(), '');
  assert.equal(telemetry.initialize(root), false);
});

test('an explicit off before the first startup prevents automatic activation', t => {
  const { root } = fixture(t);
  telemetry.setMode(root, false);
  assert.equal(telemetry.initialize(root), false);
});

test('distinct repeated tool calls count once per call and edits reset retry comparison', t => {
  const { root } = fixture(t);
  telemetry.setMode(root, true);

  telemetry.toolEvent(root, shell('one'), 'blocked', 'worker_command');
  telemetry.toolEvent(root, shell('one'), 'blocked', 'permission_denied');
  telemetry.toolEvent(root, shell('two'), 'blocked', 'worker_command');
  telemetry.toolEvent(root, shell('edit', 'Edit'), 'ok');
  telemetry.toolEvent(root, shell('three'), 'blocked', 'worker_command');

  const report = telemetry.summarize(root);
  assert.deepEqual(report.blocks, { worker_command: 3 });
  assert.deepEqual(report.retries, { worker_command: 1 });
  assert.equal(report.usage.tokens, null);
});

test('usage reads only allowlisted fields, excludes history before opt-in and deduplicates API messages', t => {
  const { root, rows } = fixture(t);
  const now = Date.now();
  telemetry.setMode(root, true, now - 50);
  const transcript = path.join(root, 'transcript.jsonl');
  const sample = (id, timestamp, output) => ({
    type: 'assistant', sessionId: 'private-session-id', timestamp: new Date(timestamp).toISOString(),
    message: { id, model: 'claude-sonnet-5-5', content: 'private source code',
      usage: { input_tokens: 110, output_tokens: output, cache_read_input_tokens: 500, cache_creation_input_tokens: 80 } },
  });
  fs.writeFileSync(transcript, [
    sample('msg_old', now - 60000, 9), sample('msg_same', now, 5), sample('msg_same', now, 17),
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  const event = { hook_event_name: 'SessionEnd', session_id: 'private-session-id', transcript_path: transcript };
  telemetry.collectUsage(root, event);
  telemetry.collectUsage(root, event);
  const report = telemetry.summarize(root);
  assert.equal(report.usage.calls, 1);
  assert.deepEqual(report.usage.tokens, { input: 110, output: 17, cache_read: 500, cache_write: 80 });
  assert.equal(report.usage.sessions, 1);
  assert.doesNotMatch(rows(), /private|transcript\.jsonl|msg_same/);
});

test('reports drop expired days without fabricating usage', t => {
  const { root, dir } = fixture(t);
  telemetry.setMode(root, true);
  const file = path.join(dir, '1999-01-01.jsonl');
  fs.writeFileSync(file, '{}\n');
  assert.equal(telemetry.summarize(root, 30).usage.tokens, null);
  assert.equal(fs.existsSync(file), false);
});
