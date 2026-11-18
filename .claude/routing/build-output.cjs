const { stripVTControlCharacters } = require('node:util');

const MIN_STDOUT_BYTES = 8 * 1024;
const MIN_REMOVED_BYTES = 2 * 1024;
const RUNNERS = [
  /^(?:npm|pnpm|yarn|bun)(?:\.cmd)? (?:run )?(?:test|build)(?: |$)/i,
  /^vitest(?:\.cmd)? run(?: |$)/i,
  /^vite(?:\.cmd)? build(?: |$)/i,
  /^jest(?:\.cmd)?(?: |$)/i,
  /^node(?:\.exe)? --test(?: |$)/i,
  /^(?:python(?:3)?(?:\.exe)? -m )?pytest(?:\.exe)?(?: |$)/i,
  /^dotnet(?:\.exe)? (?:test|build)(?: |$)/i,
  /^(?:mvnw?|gradlew?)(?:\.cmd|\.bat)? (?:-[BNq] )*(?:test|verify|package|compile|build)(?: |$)/,
  /^(?:go|cargo)(?:\.exe)? (?:test|build)(?: |$)/i,
];
const REPORT_OPTION = /(?:^| )["']?-{1,2}(?:json(?:-report)?|junitxml|output(?:-file|file)?|reporter|test-reporter(?:-destination)?|format|message-format|logger|log-file|bl)(?:[ =:"']|$)/i;
const DIAGNOSTICS = [
  /^\s*(?:FAIL(?:ED|URE)?\b|warn(?:ing)?\b|error\b|not ok\b|✖|Traceback \()/i,
  /\[(?:warn(?:ing)?|error|fatal)\]|\b(?:warn(?:ing)?|error|fatal)\s+(?:[A-Z]{1,8}\d{3,}|\[)/i,
  /\b[\w.]*(?:Error|Warning|Exception):|\b(?:warn|fatal|panic):/i,
  /\b(?:tests?(?: files| suites| run)?|snapshots|passed|skipped|fail(?:ed|ures)?)\s*:/i,
  /\b(?:build (?:succeeded|successful|failed)|\d+ (?:passed|failed|skipped|warnings?)|no tests?)\b/i,
];

function isTestOrBuild(command) {
  // Ignore compound commands, shell substitutions, redirections and explicit reports.
  if (typeof command !== 'string' || /[;&|<>`$\r\n]/.test(command)) return false;
  let invocation = command.trim().replace(/[ \t]+/g, ' ');
  invocation = invocation.replace(/^rtk(?:\.exe)? /i, '').replace(/^\.[/\\]/, '');
  const humanReport = invocation.replace(/ --test-reporter(?:=| )spec(?= |$)/g, '');
  if (REPORT_OPTION.test(humanReport)) return false;
  const runner = invocation.replace(/^(?:npx(?:\.cmd)?(?: --no-install)? |pnpm(?:\.cmd)? exec |bunx )/i, '');
  return RUNNERS.some(pattern => pattern.test(runner));
}

function filterBuildOutput(event) {
  if (!['Bash', 'PowerShell'].includes(event.tool_name) || event.tool_input?.run_in_background ||
      !isTestOrBuild(event.tool_input?.command)) return null;

  const result = event.tool_response;
  if (typeof result?.stdout !== 'string' || typeof result.stderr !== 'string' ||
      result.isImage || result.interrupted || result.backgroundTaskId || result.assistantAutoBackgrounded ||
      result.persistedOutputPath || result.timedOutAfterMs || result.returnCodeInterpretation ||
      result.noOutputExpected || result.isError ||
      (result.exitCode != null && result.exitCode !== 0)) return null;
  const before = Buffer.byteLength(result.stdout);
  if (before < MIN_STDOUT_BYTES) return null;

  const prefix = stripVTControlCharacters(result.stdout.trimStart().slice(0, 256)).trimStart();
  if (/^(?:\{\s*(?:"|})|\[\s*(?:[{\["\d\]-]|true|false|null)|<\?xml|TAP version\b)/i.test(prefix)) return null;
  const eol = result.stdout.includes('\r\n') ? '\r\n' : '\n';
  const lines = result.stdout.split(/\r?\n/);
  const hasFinalNewline = lines.at(-1) === '';
  if (hasFinalNewline) lines.pop();
  if (lines.length <= 28) return null;

  const keep = new Uint8Array(lines.length);
  keep.fill(1, 0, 8);
  keep.fill(1, lines.length - 20);
  for (const [index, line] of lines.entries()) {
    const plain = stripVTControlCharacters(line);
    if (DIAGNOSTICS.some(pattern => pattern.test(plain))) {
      keep.fill(1, Math.max(0, index - 2), index + 7);
    }
  }
  const compact = [];
  let omitted = 0;
  for (let index = 0; index < lines.length; index++) {
    if (keep[index]) compact.push(lines[index]);
    else {
      if (keep[index - 1]) compact.push('[Caronte omitted verbose stdout lines]');
      omitted++;
    }
  }

  const stdout = compact.join(eol) + (hasFinalNewline ? eol : '');
  const after = Buffer.byteLength(stdout);
  if (before - after < MIN_REMOVED_BYTES) return null;
  return { output: { ...result, stdout }, metrics: { stdout_before_bytes: before, stdout_after_bytes: after, lines_omitted: omitted } };
}

module.exports = { filterBuildOutput };
