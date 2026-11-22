'use strict';
// Ricerca BM25 di sola lettura sull'indice FastSkillRetrieval (SQLite FTS5).
// Python costruisce l'indice; qui lo si interroga con node:sqlite, senza processi esterni.
const fs = require('node:fs');
const path = require('node:path');

const STOP = new Set(`a ad agli al all alla alle allo anche che chi col come con da dai dal dall dalla dalle
dallo dei del dell della delle dello di due e è ed fra gia già gli ha hanno ho i il in l la
le lo ma mi ne nei nel nell nella nelle nello non o per perche perché piu più quale quali
quest se si sia sono su sui sul sull sulla sulle sullo ti tra un una uno cosi così
the of to and for with an is are was were be been on at by from in as or its this that
these those into about my your our their`.split(/\s+/));
const ELISION = /\b(?:c|l|d|dov|cos|com|quell|quest|dell|all|dall|nell|sull|un|anch)['’](?=[\p{L}\p{N}_])/gu;
const WEIGHTS = '0,5,4,4,3,2'; // come registry.py: capability_id, description, capabilities, use_when, aliases, technologies
// Soglie tarate su 14 richieste reali/sintetiche: pertinenti <= -16, rumore >= -9.
const DEFAULTS = { threshold: -12, relative: 0.6, limit: 3, minTerms: 2 };

function queryTerms(text) {
  let v = String(text).normalize('NFC').toLowerCase().replace(ELISION, ' ');
  v = v.replace(/\bc\+\+/g, ' cpp ').replace(/\bc#/g, ' csharp ');
  const seen = new Set();
  for (const t of v.match(/[\p{L}\p{N}]+/gu) || []) if (!STOP.has(t)) seen.add(t);
  return [...seen].slice(0, 64);
}

function openIndex(dir) {
  const file = path.join(dir, 'registry.sqlite3');
  if (!fs.existsSync(file)) return null;
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(file, { readOnly: true });
}

// Restituisce [{ name, kind, score }] già filtrati da soglia e numero minimo di termini; [] se nulla è pertinente.
function search(db, query, options = {}) {
  const { threshold, relative, limit, minTerms } = { ...DEFAULTS, ...options };
  const terms = queryTerms(query);
  if (terms.length < minTerms) return [];
  const expression = terms.map(t => `"${t.replaceAll('"', '')}"`).join(' OR ');
  const rows = db.prepare(
    `SELECT c.name AS name, c.kind AS kind, bm25(capability_fts,${WEIGHTS}) AS score
     FROM capability_fts f JOIN capabilities c ON c.id = f.capability_id
     WHERE capability_fts MATCH ? AND c.status = 'enabled'
     ORDER BY score LIMIT ?`).all(expression, limit * 3);
  const best = rows.length ? rows[0].score : 0;
  return rows.filter(r => r.score <= threshold && r.score <= best * relative).slice(0, limit)
    .map(r => ({ name: r.name, kind: r.kind, score: Number(r.score.toFixed(2)) }));
}

module.exports = { queryTerms, openIndex, search, DEFAULTS };
