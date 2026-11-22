'use strict';
// UserPromptSubmit: cerca skill pertinenti nell'indice FastSkillRetrieval (sola lettura).
// CARONTE_SKILL_INDEX = cartella di stato con registry.sqlite3; se manca o è illeggibile non fa nulla.
// CARONTE_SKILL_MODE = suggest (default: scrive solo il log) | inject (aggiunge il contesto al prompt) | off.
const fs = require('node:fs');
const path = require('node:path');
const { openIndex, search } = require('../routing/skill-suggest.cjs');

function run(event, env = process.env) {
  const mode = env.CARONTE_SKILL_MODE || 'suggest';
  const dir = env.CARONTE_SKILL_INDEX;
  if (mode === 'off' || !dir || typeof event.prompt !== 'string') return null;
  let db;
  try {
    db = openIndex(dir);
    if (!db) return null;
    const started = process.hrtime.bigint();
    const hits = search(db, event.prompt);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const root = env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
    const log = path.join(root, '.claude', 'skill-suggestions.jsonl');
    fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), mode, ms: Number(ms.toFixed(2)), query: event.prompt.slice(0, 200), hits }) + '\n');
    if (mode !== 'inject' || !hits.length) return null;
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'Strumenti ECC possibili per questa richiesta (per ECC_TOOLS): ' + hits.map(h => `${h.name} (${h.kind})`).join(', '),
      },
    };
  } catch { return null; } finally { try { db?.close(); } catch { /* ignora */ } }
}

function main() {
  let event;
  try { event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '')); } catch { return; }
  const out = run(event);
  if (out) process.stdout.write(JSON.stringify(out));
}
if (require.main === module) main();
module.exports = { run };
