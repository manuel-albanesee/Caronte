'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { queryTerms, openIndex, search } = require('../.claude/routing/skill-suggest.cjs');
const { run } = require('../.claude/hooks/suggest-skills.cjs');

function makeIndex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte-skill-'));
  const db = new DatabaseSync(path.join(dir, 'registry.sqlite3'));
  db.exec(`CREATE TABLE capabilities(id TEXT PRIMARY KEY, name TEXT, kind TEXT, status TEXT DEFAULT 'enabled');
    CREATE VIRTUAL TABLE capability_fts USING fts5(capability_id UNINDEXED, description, capabilities, use_when, aliases, technologies);`);
  const add = (id, name, description, use) => {
    db.prepare('INSERT INTO capabilities(id,name,kind) VALUES(?,?,?)').run(id, name, 'skill');
    db.prepare('INSERT INTO capability_fts VALUES(?,?,?,?,?,?)').run(id, description, description, use, name, 'postgresql');
  };
  add('a', 'postgres-patterns', 'postgres query optimization indexes schema design performance tuning', 'postgres query optimization slow query');
  add('b', 'tdd-workflow', 'write tests first test driven development regression bug fix', 'write tests first regression');
  for (let i = 0; i < 20; i++) add('f' + i, 'filler-' + i, 'generic text number ' + i + ' about unrelated things', 'filler');
  db.close();
  return dir;
}

test('queryTerms rimuove stop-word ed elisioni e mantiene C++/C#', () => {
  assert.deepEqual(queryTerms("c'è un errore nel build C++"), ['errore', 'build', 'cpp']);
  assert.deepEqual(queryTerms('the fix of C#'), ['fix', 'csharp']);
});

test('search restituisce la skill pertinente e scarta le richieste senza match', () => {
  const dir = makeIndex();
  const db = openIndex(dir);
  try {
    const hit = search(db, 'postgres query optimization');
    assert.equal(hit[0].name, 'postgres-patterns');
    assert.deepEqual(search(db, 'ciao come stai oggi'), []);
    assert.deepEqual(search(db, 'sì procedi'), []);
    assert.deepEqual(search(db, 'postgres'), [], 'un solo termine non basta (minTerms)');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('openIndex senza indice restituisce null e la query non può essere iniettata come sintassi FTS', () => {
  assert.equal(openIndex(path.join(os.tmpdir(), 'caronte-inesistente-xyz')), null);
  const dir = makeIndex();
  const db = openIndex(dir);
  try { assert.doesNotThrow(() => search(db, '"OR NEAR( * ) AND postgres query')); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hook: suggest scrive solo il log, inject aggiunge il contesto, off e indice mancante non fanno nulla', () => {
  const dir = makeIndex();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte-root-'));
  fs.mkdirSync(path.join(root, '.claude'));
  const event = { prompt: 'write tests first for a bug regression', cwd: root };
  const env = { CARONTE_SKILL_INDEX: dir, CLAUDE_PROJECT_DIR: root };
  try {
    assert.equal(run(event, { ...env }), null);
    const log = fs.readFileSync(path.join(root, '.claude', 'skill-suggestions.jsonl'), 'utf8').trim().split('\n');
    assert.equal(JSON.parse(log[0]).hits[0].name, 'tdd-workflow');
    const out = run(event, { ...env, CARONTE_SKILL_MODE: 'inject' });
    assert.match(out.hookSpecificOutput.additionalContext, /tdd-workflow/);
    assert.equal(run(event, { ...env, CARONTE_SKILL_MODE: 'off' }), null);
    assert.equal(run(event, { CLAUDE_PROJECT_DIR: root }), null);
    assert.equal(run(event, { ...env, CARONTE_SKILL_INDEX: path.join(dir, 'nope') }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});

test('validatore: suggestTools cerca sull\'OBIETTIVO, toglie i prefissi e degrada a [] senza indice', () => {
  const { suggestTools } = require('../.claude/hooks/validate-agent-brief.cjs');
  const dir = makeIndex();
  try {
    assert.deepEqual(suggestTools('postgres query optimization', { CARONTE_SKILL_INDEX: dir }), ['postgres-patterns']);
    assert.deepEqual(suggestTools('postgres query optimization', {}), []);
    assert.deepEqual(suggestTools('postgres query optimization', { CARONTE_SKILL_INDEX: path.join(dir, 'x') }), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('validatore: con ECC_QUERY il rifiuto per ECC_TOOLS mancante propone gli strumenti, senza chiede la query inglese', () => {
  const { validate } = require('../.claude/hooks/validate-agent-brief.cjs');
  const dir = makeIndex();
  const saved = { i: process.env.CARONTE_SKILL_INDEX, f: process.env.CARONTE_ECC_FULL };
  process.env.CARONTE_SKILL_INDEX = dir; process.env.CARONTE_ECC_FULL = '1';
  const brief = input => `OBIETTIVO: ottimizza una query lenta\nINPUT: ${input}\nFATTI: x\nVINCOLI: x\nUSCITA: x\nVERIFICA: x`;
  const message = input => { try { validate({ tool_name: 'Agent', tool_input: { subagent_type: 'ricerca-haiku', prompt: brief(input) } }, process.cwd()); } catch (e) { return e.message; } return ''; };
  try {
    assert.match(message('ECC_QUERY: postgres query optimization'), /\["postgres-patterns"\]/);
    assert.match(message('nessun dato'), /ECC_QUERY/);
  } finally {
    for (const [k, v] of [['CARONTE_SKILL_INDEX', saved.i], ['CARONTE_ECC_FULL', saved.f]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
