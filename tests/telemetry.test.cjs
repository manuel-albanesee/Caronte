const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const telemetry = require('../.claude/routing/telemetry.cjs');
const recordHook = path.join(__dirname, '../.claude/hooks/record-telemetry.cjs');

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

function buildEvent(tool = 'Bash', command = 'npm run build') {
  const lines = Array.from({ length: 240 }, (_, n) => 'Compiling source module ' + n + ' private-source-label');
  lines.splice(100, 3, 'private diagnostic source', '\x1b[33mwarning CS1234: private warning\x1b[0m', 'private source location');
  lines.push('Build succeeded.');
  return {
    ...shell('build', tool), hook_event_name: 'PostToolUse',
    tool_input: { command },
    tool_response: {
      stdout: lines.join('\r\n') + '\r\n', stderr: 'private-stderr',
      interrupted: false, isImage: false, exitCode: 0,
    },
  };
}

function runHook(root, event, filter = '1') {
  const result = spawnSync(process.execPath, [recordHook], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, CARONTE_FILTER_BUILD_OUTPUT: filter },
    input: JSON.stringify(event), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

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
  assert.deepEqual(report.usageDaily.find(day => day.day === new Date(now).toISOString().slice(0, 10)),
    { day: new Date(now).toISOString().slice(0, 10), calls: 1 });
  assert.ok(report.usageDaily.some(day => day.calls === null));
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

test('the installed PostToolUse contract preserves diagnostics, stderr and metadata and only records sizes', t => {
  const { root, rows } = fixture(t);
  telemetry.initialize(root);
  const event = buildEvent();
  const result = runHook(root, event);
  assert.equal(result.hookEventName, 'PostToolUse');
  const output = result.updatedToolOutput;
  assert.deepEqual({ ...output, stdout: event.tool_response.stdout }, event.tool_response);
  assert.match(output.stdout, /^Compiling source module 0 /);
  assert.match(output.stdout, /private diagnostic source\r\n.*warning CS1234: private warning.*\r\nprivate source location/);
  assert.match(output.stdout, /Build succeeded\.\r\n$/);
  assert.match(output.stdout, /Caronte omitted verbose stdout lines/);
  assert.doesNotMatch(output.stdout, /Compiling source module 50 /);
  assert.deepEqual(runHook(root, event), result);

  const before = Buffer.byteLength(event.tool_response.stdout);
  const after = Buffer.byteLength(output.stdout);
  assert.deepEqual(telemetry.summarize(root).outputFilter, {
    calls: 1, stdoutBytesBefore: before, stdoutBytesAfter: after,
    stdoutBytesRemoved: before - after, linesOmitted: 204,
  });
  assert.equal(telemetry.summarize(root).usage.tokens, null);
  assert.doesNotMatch(rows(), /private|npm|Caronte omitted/);
});

test('telemetry off also applies to a subagent in another worktree and leaves filtering available', t => {
  const { root, dir } = fixture(t);
  const child = path.join(root, 'child-worktree');
  fs.mkdirSync(path.join(child, '.git'), { recursive: true });
  const event = { ...buildEvent('PowerShell', '.\\gradlew.bat build'), cwd: child };
  telemetry.setMode(root, false);
  assert.ok(runHook(root, event)?.updatedToolOutput);
  assert.equal(runHook(root, event, '0'), null);
  assert.equal(fs.existsSync(path.join(child, '.git', 'caronte-telemetry')), false);
  assert.equal(fs.readdirSync(dir).some(file => file.endsWith('.jsonl')), false);
});

test('an explicit filter opt-out still records ordinary tool use', t => {
  const { root, rows } = fixture(t);
  telemetry.initialize(root);
  assert.equal(runHook(root, buildEvent(), '0'), null);
  assert.equal(telemetry.summarize(root).outputFilter.calls, 0);
  assert.equal(JSON.parse(rows()).tool, 'Bash');
});

test('the filter leaves failures, explicit reports, unrelated commands and output pointers alone', t => {
  const { root } = fixture(t);
  telemetry.initialize(root);
  const event = buildEvent();
  for (const command of [
    'git diff', 'npm test && npm run build', 'rtk proxy npm test', 'node --test --test-reporter=tap',
    'npx jest --json', 'dotnet test --logger trx', 'npm run build > build.log',
  ]) assert.equal(runHook(root, { ...event, tool_input: { command } }), null, command);

  for (const response of [
    { exitCode: 1 }, { backgroundTaskId: 'task' }, { persistedOutputPath: '/path/to/output' },
    { interrupted: true }, { stdout: 'Build succeeded.' }, { stdout: 'TAP version 13\n' + event.tool_response.stdout },
    { stdout: JSON.stringify(Array(1000).fill({ passed: true }), null, 2) },
  ]) assert.equal(runHook(root, { ...event, tool_response: { ...event.tool_response, ...response } }), null);
  assert.equal(runHook(root, { ...event, hook_event_name: 'PostToolUseFailure', error: 'Command failed' }), null);
  assert.equal(telemetry.summarize(root).outputFilter.calls, 0);
  assert.ok(runHook(root, buildEvent('Bash', 'rtk npm test'))?.updatedToolOutput);
  assert.ok(runHook(root, buildEvent('Bash', 'node --test --test-reporter=spec'))?.updatedToolOutput);
});

function fileTranscript(root) {
  const now = Date.now();
  const sessionId = 'fixture-session';
  const transcript = path.join(root, 'fixture-transcript.jsonl');
  const records = [];
  const add = (type, fields) => records.push({
    type, sessionId, timestamp: new Date(now - 5000 + records.length).toISOString(), ...fields,
  });
  const call = (id, name, file) => add('assistant', {
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: { file_path: file } }] },
  });
  const result = (id, toolUseResult, content, isError = false) => add('user', {
    toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  });
  return {
    record: add,
    turn: () => add('user', { message: { role: 'user', content: 'fixture prompt' } }),
    notice: (id, file, snippet) => add('attachment', { uuid: id, attachment: { type: 'edited_text_file', filename: file, snippet } }),
    write: (id, file) => { call(id, 'Edit', file); result(id, {}, 'fixture editing result'); },
    read: (id, file, startLine, totalLines, lines, isError) => {
      call(id, 'Read', file);
      result(id, { type: 'text', file: { filePath: file, startLine, totalLines, numLines: lines.length, content: lines.join('\n') } },
        lines.map((line, index) => (startLine + index) + '\t' + line).join('\n'), isError);
    },
    collect: () => {
      fs.writeFileSync(transcript, records.map(row => JSON.stringify(row)).join('\n') + '\n');
      telemetry.collectUsage(root, { hook_event_name: 'SessionEnd', session_id: sessionId, transcript_path: transcript });
    },
    since: now - 10000,
  };
}

test('text snapshots detect changed overlapping lines and count subsequent reads in the same turn', t => {
  const { root, rows } = fixture(t);
  const trace = fileTranscript(root);
  const file = path.join(root, 'fixture-sensitive.txt');
  telemetry.setMode(root, true, trace.since);
  trace.turn();
  trace.read('read-1', file, 1, 3, ['first', 'old private text', 'last']);
  trace.turn();
  trace.read('read-2', file, 2, 3, ['new private text']);
  trace.read('read-3', file, 1, 3, ['first', 'new private text', 'last']);
  trace.read('failed', file, 3, 3, ['last'], true);
  trace.turn();
  trace.read('repeat', file, 1, 3, ['first', 'new private text', 'last']);
  trace.collect();
  trace.collect();
  const { fileContext } = telemetry.summarize(root);
  assert.deepEqual(fileContext, {
    scans: 1, scansWithTextReads: 1, truncatedScans: 0, changeEpisodes: 1, changesDetectedByComparison: 1,
    notices: 0, measuredNotices: 0, noticeSnippetBytes: 0,
    rereads: 2, fullReads: 1, partialReads: 1, rereadLines: 4, measuredRereads: 2,
    rereadBytes: Buffer.byteLength('2\tnew private text') + Buffer.byteLength('1\tfirst\n2\tnew private text\n3\tlast'),
  });
  assert.doesNotMatch(rows(), /fixture-sensitive|private text|read-[123]|fixture-session/);
});

test('native notices are counted, known edits reset observation, and disjoint reads alone do not imply a change', t => {
  const { root } = fixture(t);
  const trace = fileTranscript(root);
  const file = path.join(root, 'sample.txt');
  telemetry.setMode(root, true, trace.since);
  trace.turn();
  trace.read('first', file, 1, 10, ['first line']);
  trace.read('disjoint', file, 8, 10, ['another line']);
  trace.write('edited', file);
  trace.notice('own-notice', file, 'fixture');
  trace.read('after-edit', file, 8, 10, ['changed by Edit']);
  trace.turn();
  trace.notice('native-notice', file, 'Un estratto è qui.');
  trace.read('after-native', file, 8, 10, ['changed externally']);
  trace.collect();
  const { fileContext } = telemetry.summarize(root);
  assert.equal(fileContext.changeEpisodes, 1);
  assert.equal(fileContext.notices, 2);
  assert.equal(fileContext.noticeSnippetBytes, Buffer.byteLength('fixtureUn estratto è qui.'));
  assert.equal(fileContext.changesDetectedByComparison, 0);
  assert.equal(fileContext.rereads, 1);
  assert.equal(fileContext.partialReads, 1);
});

test('dashboard embeds both periods and purge removes the local snapshot', t => {
  const { root, dir } = fixture(t);
  const trace = fileTranscript(root);
  telemetry.setMode(root, true, trace.since);
  trace.read('before', path.join(root, 'fixture.txt'), 1, 1, ['one']);
  trace.read('after', path.join(root, 'fixture.txt'), 1, 1, ['two']);
  trace.collect();
  const cli = command => spawnSync(process.execPath, [path.join(__dirname, '../.claude/routing/telemetry.cjs'), command], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8',
  });
  const result = cli('dashboard');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(dir, 'dashboard.html'));
  const html = fs.readFileSync(result.stdout.trim(), 'utf8');
  const reports = JSON.parse(html.match(/const reports = (.*);/)[1]);
  assert.equal(reports[7].fileContext.rereads, 1);
  assert.equal(reports[30].fileContext.fullReads, 1);
  assert.doesNotMatch(html, /fixture\.txt|fixture-session/);
  assert.equal(cli('purge').status, 0);
  assert.equal(fs.existsSync(result.stdout.trim()), false);
  assert.equal(telemetry.summarize(root).fileContext.scans, 0);
});
