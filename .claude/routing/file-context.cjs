const path = require('node:path');

const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const positive = value => Number.isSafeInteger(value) && value > 0;
const fileKey = name => {
  if (typeof name !== 'string' || !path.isAbsolute(name)) return null;
  const normalized = path.normalize(name);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

function textSnapshot(result) {
  const file = result?.file;
  if (result?.type !== 'text' || !file || typeof file.content !== 'string' || !positive(file.startLine) ||
      !positive(file.numLines) || !positive(file.totalLines) || file.startLine - 1 + file.numLines > file.totalLines) return null;
  const lines = file.content.split(/\r?\n/);
  if (lines.length !== file.numLines) return null;
  return { start: file.startLine, total: file.totalLines, lines };
}

function changed(before, after) {
  if (before.total !== after.total) return true;
  const first = Math.max(before.start, after.start);
  const end = Math.min(before.start + before.lines.length, after.start + after.lines.length);
  for (let n = first; n < end; n++) {
    if (before.lines[n - before.start] !== after.lines[n - after.start]) return true;
  }
  return false;
}

function fileContextScan(hash, scope) {
  const calls = new Map();
  const snapshots = new Map();
  const episodes = new Set();
  const knownWrites = new Set();
  const rows = new Map();
  let textReadsFound = false;

  function add(kind, id, at, data) {
    const sample = hash(JSON.stringify([scope.run, scope.actor, kind, id]));
    rows.set(sample, { type: 'file_context', ...scope, kind, sample, occurred_at: at, ...data });
  }

  function open(file, source, id, at) {
    if (episodes.has(file)) return;
    episodes.add(file);
    add('change', id, at, { source });
  }

  function observe(record, at) {
    const attachment = record.attachment;
    if (record.type === 'attachment' && attachment?.type === 'edited_text_file') {
      const file = fileKey(attachment.filename);
      if (!file || typeof record.uuid !== 'string') return;
      const snippetBytes = typeof attachment.snippet === 'string' ? Buffer.byteLength(attachment.snippet) : undefined;
      add('notice', record.uuid, at, { bytes: snippetBytes });
      if (!knownWrites.has(file)) open(file, 'notice', record.uuid, at);
      return;
    }

    const blocks = record.message?.content;
    if (record.type === 'assistant' && Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue;
        const file = fileKey(block.input?.file_path ?? block.input?.notebook_path);
        if (file && (block.name === 'Read' || WRITES.has(block.name))) calls.set(block.id, { file, tool: block.name });
      }
      return;
    }
    if (record.type !== 'user') return;
    const results = Array.isArray(blocks) ? blocks.filter(block => block?.type === 'tool_result') : [];
    if (results.length === 0) {
      if (!record.isMeta && !record.sourceToolAssistantUUID && record.message?.role === 'user') {
        calls.clear();
        episodes.clear();
        knownWrites.clear();
      }
      return;
    }
    // Each built-in result in the CLI transcript has its own user record.
    if (results.length !== 1) return;
    const result = results[0];
    const id = result.tool_use_id;
    const call = calls.get(id);
    calls.delete(id);
    if (!call || result.is_error) return;
    if (WRITES.has(call.tool)) {
      snapshots.delete(call.file);
      episodes.delete(call.file);
      knownWrites.add(call.file);
      return;
    }
    const snapshot = textSnapshot(record.toolUseResult);
    if (!snapshot || fileKey(record.toolUseResult.file.filePath) !== call.file) return;
    textReadsFound = true;
    knownWrites.delete(call.file);
    const previous = snapshots.get(call.file);
    if (previous && changed(previous, snapshot)) open(call.file, 'comparison', id, at);
    snapshots.set(call.file, snapshot);
    if (!episodes.has(call.file)) return;
    const lines = snapshot.lines.length;
    add('read', id, at, {
      extent: snapshot.start === 1 && lines === snapshot.total ? 'full' : 'partial',
      lines, bytes: typeof result.content === 'string' ? Buffer.byteLength(result.content) : undefined,
    });
  }

  return { observe, rows, get textReadsFound() { return textReadsFound; } };
}

function summarizeFileContext(samples, coverage) {
  const report = {
    scans: 0, scansWithTextReads: 0, truncatedScans: 0, changeEpisodes: 0, changesDetectedByComparison: 0,
    notices: 0, measuredNotices: 0, noticeSnippetBytes: 0,
    rereads: 0, fullReads: 0, partialReads: 0, rereadLines: 0, measuredRereads: 0, rereadBytes: 0,
  };
  const measured = value => Number.isSafeInteger(value) && value >= 0;
  for (const row of coverage) {
    if (typeof row.file_context_text_reads !== 'boolean') continue;
    report.scans++;
    if (row.file_context_text_reads) report.scansWithTextReads++;
    if (row.transcript_truncated) report.truncatedScans++;
  }
  for (const row of samples) {
    if (row.kind === 'change') {
      report.changeEpisodes++;
      if (row.source === 'comparison') report.changesDetectedByComparison++;
    } else if (row.kind === 'notice') {
      report.notices++;
      if (measured(row.bytes)) {
        report.measuredNotices++;
        report.noticeSnippetBytes += row.bytes;
      }
    } else if (row.kind === 'read' && ['full', 'partial'].includes(row.extent) && positive(row.lines)) {
      report.rereads++;
      report[row.extent === 'full' ? 'fullReads' : 'partialReads']++;
      report.rereadLines += row.lines;
      if (measured(row.bytes)) {
        report.measuredRereads++;
        report.rereadBytes += row.bytes;
      }
    }
  }
  return report;
}

module.exports = { fileContextScan, summarizeFileContext };
