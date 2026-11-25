'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { queryTerms, openIndex, search } = require('../.claude/routing/skill-suggest.cjs');
const { makeIndex } = require('./helpers/fsr-index.cjs');
const { run } = require('../.claude/hooks/suggest-skills.cjs');

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

test('hook: il contesto FSR è sempre iniettato (CARONTE_SKILL_MODE ignorata) e indice mancante segnalato', () => {
  const dir = makeIndex();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte-root-'));
  fs.mkdirSync(path.join(root, '.claude'));
  const event = { prompt: 'write tests first for a bug regression', cwd: root };
  const env = { CARONTE_SKILL_INDEX: dir, CLAUDE_PROJECT_DIR: root };
  try {
    for (const mode of [undefined, 'suggest', 'off', 'inject']) {
      const out = run(event, mode ? { ...env, CARONTE_SKILL_MODE: mode } : { ...env });
      assert.match(out.hookSpecificOutput.additionalContext, /Strumenti FSR pertinenti per questa richiesta.*tdd-workflow/);
    }
    const log = fs.readFileSync(path.join(root, '.claude', 'skill-suggestions.jsonl'), 'utf8').trim().split('\n');
    assert.equal(JSON.parse(log[0]).hits[0].name, 'tdd-workflow');
    assert.match(run(event, { CLAUDE_PROJECT_DIR: root }).hookSpecificOutput.additionalContext, /Indice FastSkillRetrieval non ancora disponibile/);
    assert.match(run(event, { ...env, CARONTE_SKILL_INDEX: path.join(dir, 'nope') }).hookSpecificOutput.additionalContext, /non ancora disponibile/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});

test('validatore: suggestTools cerca sull\'OBIETTIVO, toglie i prefissi e degrada a [] senza indice', () => {
  const { suggestTools } = require('../.claude/hooks/validate-agent-brief.cjs');
  const dir = makeIndex();
  try {
    assert.deepEqual(suggestTools('postgres query optimization', { CARONTE_SKILL_INDEX: dir }), ['postgres-patterns']);
    assert.deepEqual(suggestTools('postgres query optimization', { FSR_HOME: path.join(dir, 'vuoto') }), []);
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

test('checkFsr: ECC_QUERY, indice, ECC_TOOLS e FSR_SKIP obbligatori; restituisce gli agent trovati', () => {
  const { checkFsr } = require('../.claude/hooks/validate-agent-brief.cjs');
  const dir = makeIndex([{ name: 'ecc:java-reviewer', kind: 'agent', description: 'java spring boot code reviewer agent' }]);
  const env = { CARONTE_SKILL_INDEX: dir };
  const q = 'java spring boot reviewer';
  const call = (meta, e = env) => { try { return checkFsr(meta, { OBIETTIVO: 'x' }, process.cwd(), e); } catch (err) { return err; } };
  try {
    assert.match(call({}).message, /ECC_QUERY/);
    const noIndex = call({ ECC_QUERY: q }, { CARONTE_SKILL_INDEX: path.join(dir, 'nope') });
    assert.equal(noIndex.reason, 'fsr_index');
    assert.match(call({ ECC_QUERY: q }).message, /ECC_TOOLS.*java-reviewer/);
    assert.match(call({ ECC_QUERY: q, ECC_TOOLS: '"x"' }).message, /array JSON/);
    assert.equal(call({ ECC_QUERY: q, ECC_TOOLS: '["altro"]' }).reason, 'fsr_tools');
    assert.equal(call({ ECC_QUERY: q, ECC_TOOLS: '["altro"]', FSR_SKIP: 'corto' }).reason, 'fsr_tools');
    assert.deepEqual(call({ ECC_QUERY: q, ECC_TOOLS: '["altro"]', FSR_SKIP: 'lo strumento trovato non copre il caso' }), ['ecc:java-reviewer']);
    assert.deepEqual(call({ ECC_QUERY: q, ECC_TOOLS: '["ecc:java-reviewer"]' }), ['ecc:java-reviewer']);
    assert.deepEqual(call({ ECC_QUERY: 'zzqq wwvv', ECC_TOOLS: '[]' }), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
