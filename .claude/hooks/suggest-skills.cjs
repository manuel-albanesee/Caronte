'use strict';
// UserPromptSubmit: azzera le soglie del coordinatore per il nuovo turno, aggiunge il suggerimento di routing deterministico
// (classe → profilo, run ICM aperti, lavoro ampio) e cerca skill pertinenti nell'indice FastSkillRetrieval (sola lettura).
// Indice: CARONTE_SKILL_INDEX, altrimenti ~/.fsr/index/claude (FastSkillRetrieval); se manca o è illeggibile la parte skill non fa nulla.
// CARONTE_SKILL_MODE = suggest (default: scrive solo il log delle skill) | inject (aggiunge anche le skill al contesto) | off (nessuna skill).
// Il suggerimento di routing dipende da policy.json e CARONTE_DELEGATION, non da CARONTE_SKILL_MODE.
const fs = require('node:fs');
const path = require('node:path');
const { openIndex, search, defaultIndex, displayName } = require('../routing/skill-suggest.cjs');
const policyRules = require('../routing/policy.cjs');

function routing(event, root, env) {
  try {
    const policy = policyRules.load(root, env);
    if (!policy) return null;
    policyRules.newTurn(policy, root, event);
    return policyRules.routingHint(policy, root, event.prompt);
  } catch { return null; }
}

function skills(event, root, env) {
  const mode = env.CARONTE_SKILL_MODE || 'suggest';
  if (mode === 'off') return null;
  const dir = defaultIndex(env);
  let db;
  try {
    db = openIndex(dir);
    if (!db) return null;
    const started = process.hrtime.bigint();
    const hits = search(db, event.prompt).map(hit => ({ ...hit, name: displayName(dir, hit.name) }));
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const log = path.join(root, '.claude', 'skill-suggestions.jsonl');
    fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), mode, ms: Number(ms.toFixed(2)), query: event.prompt.slice(0, 200), hits }) + '\n');
    if (mode !== 'inject' || !hits.length) return null;
    return 'Strumenti ECC possibili per questa richiesta (per ECC_TOOLS): ' + hits.map(h => `${h.name} (${h.kind})`).join(', ');
  } catch { return null; } finally { try { db?.close(); } catch { /* ignora */ } }
}

function run(event, env = process.env) {
  if (!event || typeof event.prompt !== 'string') return null;
  const root = env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  const parts = [routing(event, root, env), skills(event, root, env)].filter(Boolean);
  if (!parts.length) return null;
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: parts.join('\n') } };
}

function main() {
  let event;
  try { event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '')); } catch { return; }
  const out = run(event);
  if (out) process.stdout.write(JSON.stringify(out));
}
if (require.main === module) main();
module.exports = { run };
