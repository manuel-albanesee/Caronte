const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
// Isola la suite dalla configurazione dello sviluppatore.
delete process.env.CARONTE_ECC_FULL;
delete process.env.CARONTE_DELEGATION;
delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte config vuota-'));
const { validate } = require('../.claude/hooks/validate-agent-brief.cjs');
const policyRules = require('../.claude/routing/policy.cjs');
const { plan } = require('../.claude/routing/delivery.cjs');
const { loadRun } = require('../.claude/routing/icm.cjs');
const budget = require('../.claude/hooks/coordinator-budget.cjs');
const suggest = require('../.claude/hooks/suggest-skills.cjs');
const { makeIndex } = require('./helpers/fsr-index.cjs');
// Indice FSR di prova: la query dei brief non produce hit, quindi ECC_TOOLS: [] è valido.
const fsrDir = makeIndex([{ name: 'ecc:java-reviewer', kind: 'agent', description: 'java spring reviewer agent' }]);
process.env.CARONTE_SKILL_INDEX = fsrDir;
test.after(() => fs.rmSync(fsrDir, { recursive: true, force: true }));

const kit = path.resolve(__dirname, '..');
const base = 'OBIETTIVO: trova il chiamante\nINPUT: nessuno\nFATTI: errore riproducibile\nVINCOLI: sola lettura\nUSCITA: percorso e riga\nVERIFICA: identifica il chiamante e fermati';
const fsrInput = ['ECC_QUERY: zzqq wwvv', 'ECC_TOOLS: []'];
const stageInput = ['ICM_RUN: .icm/task/run.json', 'ICM_STAGE: a'];
const brief = ({ input = [], constraints = [], fsr = true } = {}) => base
  .replace('INPUT: nessuno', ['INPUT: nessuno', ...(fsr ? fsrInput : []), ...input].join('\n'))
  .replace('VINCOLI: sola lettura', ['VINCOLI: perimetro limitato', ...constraints].join('\n'));
const agent = (subagent_type, prompt, extra = {}) => ({ tool_name: 'Agent', session_id: 'sessione-test', tool_input: { subagent_type, prompt, ...extra } });
function write(root, name, text) { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function project(t, { policy = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  fs.cpSync(path.join(kit, '.claude', 'agents'), path.join(root, '.claude', 'agents'), { recursive: true });
  if (policy) {
    fs.mkdirSync(path.join(root, '.claude', 'routing'), { recursive: true });
    fs.copyFileSync(path.join(kit, '.claude', 'routing', 'policy.json'), path.join(root, '.claude', 'routing', 'policy.json'));
  }
  return root;
}
function icm(root, stageA = {}) {
  for (const [n, v] of Object.entries({ 'input.txt': 'a', 'contract-a.md': 'A', 'contract-b.md': 'B', 'out-a.txt': 'A', 'out-b.txt': 'B' })) write(root, n, v);
  write(root, '.icm/task/run.json', JSON.stringify({ version: 1, runId: 'policy-001', stages: [
    { id: 'a', contract: 'contract-a.md', inputs: ['input.txt'], outputs: ['out-a.txt'], dependsOn: [], verify: { command: process.execPath, args: ['-e', 'process.exit(0)'] }, ...stageA },
    { id: 'b', contract: 'contract-b.md', inputs: ['out-a.txt'], outputs: ['out-b.txt'], dependsOn: ['a'], verify: { command: process.execPath, args: ['-e', 'process.exit(0)'] } },
  ] }));
}
const denied = (fn, pattern) => assert.throws(fn, error => pattern.test(error.message) || assert.fail(error.message));

test('policy.json obbligatorio; CARONTE_DELEGATION=off ignorato, valori ammessi balanced e strict', t => {
  const root = project(t, { policy: false });
  assert.throws(() => policyRules.load(root), /policy\.json mancante/);
  assert.throws(() => validate(agent('ricerca-haiku', brief({ constraints: ['ROUTING: ricerca'] })), root), /policy\.json mancante/);
  const withPolicy = project(t);
  assert.equal(policyRules.load(withPolicy, { CARONTE_DELEGATION: 'off' }).mode, 'balanced');
  assert.equal(policyRules.load(withPolicy, { CARONTE_DELEGATION: 'strict' }).mode, 'strict');
  assert.throws(() => policyRules.load(withPolicy, { CARONTE_DELEGATION: 'massima' }), /Modalità di delega non valida/);
  assert.equal(policyRules.load(withPolicy, {}).mode, 'balanced');
});

test('agent generici negati se esiste uno specialista; specialistsFor esclude generici, non installati e oltre il tetto', t => {
  const root = project(t);
  const policy = policyRules.load(root, {});
  assert.ok(policyRules.isGeneric(policy, 'general-purpose') && policyRules.isGeneric(policy, 'claude') && policyRules.isGeneric(policy, undefined));
  assert.ok(!policyRules.isGeneric(policy, 'Explore'));
  const found = policyRules.specialistsFor(policy, root, 'ricerca', [], {});
  assert.ok(found.includes('ricerca-haiku') && !found.includes('general-purpose'));
  // decisione-opus supera il tetto della classe ricerca; ecc:inesistente non è installato.
  const extra = policyRules.specialistsFor(policy, root, 'ricerca', ['decisione-opus', 'ecc:inesistente', 'general-purpose'], {});
  assert.ok(!extra.includes('decisione-opus') && !extra.includes('ecc:inesistente') && !extra.includes('general-purpose'));
  const r = brief({ constraints: ['ROUTING: ricerca'] });
  assert.throws(() => validate(agent('general-purpose', r), root), e => e.reason === 'specialist_required' && /ricerca-haiku/.test(e.message));
  assert.throws(() => validate(agent('general-purpose', r, { model: 'haiku' }), root), e => e.reason === 'specialist_required');
  assert.throws(() => validate({ tool_name: 'Agent', session_id: 's', tool_input: { prompt: r } }, root), e => e.reason === 'specialist_required');
  validate(agent('ricerca-haiku', r), root);
});

test('nessun agent specialista respinto per nome: vale il tetto di modello della classe', t => {
  const root = project(t);
  const r = cls => brief({ constraints: ['ROUTING: ' + cls] });
  // Explore del kit è Haiku in sola lettura: ammesso per la ricerca.
  validate(agent('Explore', r('ricerca')), root);
  // Plan eredita il modello della sessione (inheritedModel: opus).
  denied(() => validate(agent('Plan', r('ricerca')), root), /opus.*tetto haiku/);
  validate(agent('Plan', r('ricerca'), { model: 'haiku' }), root);
  validate(agent('Plan', r('decisione')), root);
  // CLAUDE_CODE_SUBAGENT_MODEL abbassa il modello ereditato.
  const policy = policyRules.load(root, {});
  const parsed = { constraints: { ROUTING: 'sviluppo' }, meta: {}, stage: null, run: null, plan: null, activeRuns: [] };
  policyRules.checkRouting(policy, root, agent('Plan', base), parsed, { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
  assert.throws(() => policyRules.checkRouting(policy, root, agent('Plan', base), parsed, {}), /tetto sonnet/);
  // strict non filtra per nome.
  policyRules.checkAgentType(policyRules.load(root, { CARONTE_DELEGATION: 'strict' }), root, agent('ecc:planner', 'x'));
});

test('agent di utente e plugin risolti dai file installati', t => {
  const root = project(t);
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte config-'));
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  const plugin = path.join(config, 'plugins', 'cache', 'ecc', 'ecc', '9.9.9');
  write(plugin, 'agents/python-reviewer.md', '---\nname: python-reviewer\nmodel: sonnet\n---\nx');
  write(plugin, 'agents/architect.md', '---\nname: architect\nmodel: opus\n---\nx');
  write(config, 'agents/mio-scanner.md', '---\nname: mio-scanner\nmodel: haiku\n---\nx');
  write(config, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'ecc@ecc': [{ scope: 'user', installPath: plugin }] } }));
  const env = { CLAUDE_CONFIG_DIR: config };
  const policy = policyRules.load(root, {});
  assert.deepEqual(policyRules.agentInfo(root, 'ecc:architect', policy, env), { model: 'opus', effort: null, file: path.join(plugin, 'agents', 'architect.md'), source: 'plugin' });
  assert.equal(policyRules.agentInfo(root, 'mio-scanner', policy, env).source, 'user');
  assert.equal(policyRules.agentInfo(root, 'claude-code-guide', policy, env).model, 'haiku');
  const parsed = cls => ({ constraints: { ROUTING: cls }, meta: {}, stage: null, run: null, plan: null, activeRuns: [] });
  policyRules.checkRouting(policy, root, agent('ecc:python-reviewer', base), parsed('revisione'), env);
  policyRules.checkRouting(policy, root, agent('mio-scanner', base), parsed('ricerca'), env);
  assert.throws(() => policyRules.checkRouting(policy, root, agent('ecc:architect', base), parsed('revisione'), env), /opus.*tetto sonnet/);
  policyRules.checkRouting(policy, root, agent('ecc:architect', base), parsed('decisione'), env);
  // Agent sconosciuto: conta il modello ereditato.
  assert.throws(() => policyRules.checkRouting(policy, root, agent('ecc:inesistente', base), parsed('revisione'), env), /ereditato/);
  const list = policyRules.listAgents(root, policy, env);
  const reviewer = list.find(a => a.name === 'ecc:python-reviewer');
  assert.equal(reviewer.model, 'sonnet');
  assert.ok(reviewer.classes.includes('revisione') && !reviewer.classes.includes('ricerca'));
  assert.ok(list.some(a => a.name === 'ricerca-haiku' && a.source === 'project'));
  assert.ok(list.some(a => a.name === 'general-purpose' && a.modelFrom.includes('ereditato')));
});

test('ROUTING obbligatorio e classe nota', t => {
  const root = project(t);
  denied(() => validate(agent('ricerca-haiku', brief()), root), /ROUTING: <classe>.*ricerca/);
  denied(() => validate(agent('ricerca-haiku', brief({ constraints: ['ROUTING: inventata'] })), root), /sconosciuta/);
  denied(() => validate(agent('decisione-opus', brief({ constraints: ['ROUTING: ricerca'] })), root), /tetto haiku/);
  validate(agent('ricerca-haiku', brief({ constraints: ['ROUTING: ricerca'] })), root);
  validate(agent('ricerca-haiku', brief({ constraints: ['ROUTING: decisione'] })), root);
  validate(agent('decisione-opus', brief({ constraints: ['ROUTING: decisione'] })), root);
});

test('salire di modello o effort rispetto ad agent o classe richiede ESCALATION motivata', t => {
  const root = project(t);
  const p = brief({ constraints: ['ROUTING: ricerca'] });
  denied(() => validate(agent('ricerca-haiku', p, { model: 'opus' }), root), /ESCALATION/);
  denied(() => validate(agent('ricerca-haiku', p, { effort: 'high' }), root), /ESCALATION/);
  denied(() => validate(agent('ricerca-haiku', brief({ constraints: ['ROUTING: ricerca', 'ESCALATION: serve'] }), { model: 'opus' }), root), /ESCALATION/);
  validate(agent('ricerca-haiku', p, { model: 'haiku' }), root);
  validate(agent('ricerca-haiku', brief({ constraints: ['ROUTING: ricerca', 'ESCALATION: haiku ha mancato due chiamanti dinamici nel tentativo precedente'] }), { model: 'sonnet' }), root);
  // meccanica: Sonnet ammesso solo con effort low.
  icm(root, { profile: 'implementazione-sonnet', class: 'meccanica' });
  const id = plan(root, { profile: 'implementazione-sonnet', files: ['out-a.txt'], tests: [], noTestsReason: 'testo' }).id;
  const m = brief({ input: stageInput, constraints: ['ROUTING: meccanica', 'CAPABILITY: write', 'REVIEW_ID: ' + id] });
  denied(() => validate(agent('implementazione-sonnet', m), root), /effort medium oltre il tetto low/);
  validate(agent('implementazione-sonnet', m, { effort: 'low' }), root);
});

test('una ricevuta ICM fallita della fase giustifica l\'escalation', t => {
  const root = project(t);
  icm(root, { profile: 'implementazione-sonnet', class: 'meccanica' });
  const id = plan(root, { profile: 'implementazione-sonnet', files: ['out-a.txt'], tests: [], noTestsReason: 'testo' }).id;
  const p = brief({ input: stageInput, constraints: ['CAPABILITY: write', 'REVIEW_ID: ' + id] });
  denied(() => validate(agent('implementazione-sonnet', p), root), /effort medium oltre il tetto low.*ricevuta check fallita/);
  write(root, '.icm/task/.state-policy-001/a.json', JSON.stringify({ status: 'fail', reason: 'comando terminato con exit 1' }));
  validate(agent('implementazione-sonnet', p), root);
});


test('implementazione-haiku: al massimo 2 file e test mirato obbligatorio', t => {
  const root = project(t);
  icm(root, { outputs: ['a.txt', 'b.txt', 'c.txt'] });
  for (const f of ['a.txt', 'b.txt', 'c.txt']) write(root, f, f);
  const wide = plan(root, { profile: 'implementazione-haiku', files: ['a.txt', 'b.txt', 'c.txt'], tests: [], noTestsReason: 'testo' });
  const writing = (id, cls = 'meccanica') => brief({ input: stageInput, constraints: ['ROUTING: ' + cls, 'CAPABILITY: write', 'REVIEW_ID: ' + id] });
  denied(() => validate(agent('implementazione-haiku', writing(wide.id)), root), /al massimo 2 file/);
  const untested = plan(root, { profile: 'implementazione-haiku', files: ['a.txt'], tests: [], noTestsReason: 'testo' });
  denied(() => validate(agent('implementazione-haiku', writing(untested.id)), root), /test mirato/);
  const sonnet = plan(root, { profile: 'implementazione-sonnet', files: ['a.txt', 'b.txt', 'c.txt'], tests: [], noTestsReason: 'testo' });
  validate(agent('implementazione-sonnet', writing(sonnet.id, 'sviluppo')), root);
});

test('ICM obbligatorio: la scrittura dichiara la fase, ICM_SKIP è negato; profilo, classe e output della fase vincolano la delega', t => {
  const root = project(t);
  icm(root, { profile: 'implementazione-sonnet', class: 'sviluppo' });
  write(root, 'other.txt', 'x');
  const outside = plan(root, { profile: 'implementazione-sonnet', files: ['other.txt'], tests: [], noTestsReason: 'testo' });
  const p = (id, input = []) => brief({ input, constraints: ['CAPABILITY: write', 'REVIEW_ID: ' + id] });
  assert.throws(() => validate(agent('implementazione-sonnet', p(outside.id)), root), e => e.reason === 'icm_gate' && /\.icm\/task\/run\.json → a/.test(e.message));
  // ICM_SKIP non è più ammesso, nemmeno in sola lettura.
  assert.throws(() => validate(agent('implementazione-sonnet', p(outside.id, ['ICM_SKIP: correzione indipendente dal run'])), root), e => e.reason === 'icm_gate' && /ICM_SKIP/.test(e.message));
  assert.throws(() => validate(agent('ricerca-haiku', brief({ input: ['ICM_SKIP: nessun run necessario qui'], constraints: ['ROUTING: ricerca'] })), root), e => e.reason === 'icm_gate');
  denied(() => validate(agent('implementazione-sonnet', p(outside.id, stageInput)), root), /non dichiarati negli output/);
  const inside = plan(root, { profile: 'implementazione-sonnet', files: ['out-a.txt'], tests: [], noTestsReason: 'testo' });
  const haiku = plan(root, { profile: 'implementazione-haiku', files: ['out-a.txt'], tests: [], noTestsReason: 'testo' });
  denied(() => validate(agent('implementazione-haiku', p(haiku.id, stageInput)), root), /assegnata a implementazione-sonnet/);
  // La classe viene dalla fase quando il brief non indica ROUTING.
  validate(agent('implementazione-sonnet', p(inside.id, stageInput)), root);
});

test('il manifest ICM valida profile e class delle fasi', t => {
  const root = project(t);
  icm(root, { class: 'due parole' });
  assert.throws(() => loadRun(root, '.icm/task/run.json'), /class di fase non valida/);
  icm(root, { profile: 'ecc:tdd-guide', class: 'regressione' });
  assert.equal(loadRun(root, '.icm/task/run.json').data.stages[0].profile, 'ecc:tdd-guide');
  assert.deepEqual(policyRules.activeRuns(root).map(r => [r.next, r.profile, r.class]), [['a', 'ecc:tdd-guide', 'regressione']]);
});

test('soglie del coordinatore: modifiche e letture oltre il limite negate, esenzioni e reset per turno e delega', t => {
  const root = project(t);
  const env = { CLAUDE_PROJECT_DIR: root };
  const ev = (tool_name, tool_input, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: root, tool_name, tool_input, ...extra });
  const lines = n => Array.from({ length: n }, (_, i) => 'riga ' + i).join('\n');
  assert.equal(budget.run(ev('Write', { file_path: 'a.js', content: lines(30) }), env), null);
  assert.equal(budget.run(ev('Edit', { file_path: 'b.js', old_string: 'x', new_string: lines(20) }), env), null);
  assert.equal(budget.run(ev('Write', { file_path: 'docs/nota.md', content: lines(500) }), env), null);
  assert.equal(budget.run(ev('Write', { file_path: '.icm/task/run.json', content: lines(500) }), env), null);
  assert.equal(budget.run(ev('Edit', { file_path: 'c.js', old_string: 'x', new_string: lines(20) }), env).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(budget.run(ev('Edit', { file_path: 'c.js', old_string: 'x', new_string: 'y' }, { agent_id: 'worker' }), env), null);
  suggest.run({ session_id: 's1', cwd: root, prompt: 'nuovo turno' }, { ...env, CARONTE_SKILL_MODE: 'off' });
  assert.equal(budget.run(ev('Edit', { file_path: 'c.js', old_string: 'x', new_string: lines(20) }), env), null);
  for (let i = 0; i < 25; i++) assert.equal(budget.run(ev('Read', { file_path: 'src/f' + i + '.js' }), env), null);
  assert.equal(budget.run(ev('Read', { file_path: '.claude/routing/policy.json' }), env), null);
  assert.equal(budget.run(ev('Read', { file_path: path.join(os.homedir(), 'fuori.txt') }), env), null);
  const read = budget.run(ev('Grep', { pattern: 'x', path: 'src' }), env).hookSpecificOutput;
  assert.equal(read.permissionDecision, 'deny');
  assert.match(read.permissionDecisionReason, /ricerca-haiku/);
  budget.run({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: root, tool_name: 'Agent', tool_input: {} }, env);
  assert.equal(budget.run(ev('Read', { file_path: 'src/g.js' }), env), null);
  // off non è più ammesso: CARONTE_DELEGATION=off è ignorato e valgono le soglie di balanced.
  assert.equal(budget.run(ev('Edit', { file_path: 'z.js', old_string: 'x', new_string: lines(80) }), { ...env, CARONTE_DELEGATION: 'off' }).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(budget.run(ev('Edit', { file_path: 'z.js', old_string: 'x', new_string: 'y' }), { ...env, CARONTE_DELEGATION: 'strict' }).hookSpecificOutput.permissionDecision, 'deny');
  // Una procedura ECC nativa sospende le soglie in balanced, non in strict.
  suggest.run({ session_id: 's1', cwd: root, prompt: '/ecc:tdd aggiungi il caso limite' }, { ...env, CARONTE_SKILL_MODE: 'off' });
  assert.equal(budget.run(ev('Edit', { file_path: 'z.js', old_string: 'x', new_string: lines(200) }), env), null);
  assert.equal(budget.run(ev('Edit', { file_path: 'z.js', old_string: 'x', new_string: 'y' }), { ...env, CARONTE_DELEGATION: 'strict' }).hookSpecificOutput.permissionDecision, 'deny');
});

test('classificazione deterministica e suggerimento di routing con obblighi e avviso FSR senza indice', t => {
  const root = project(t);
  const policy = policyRules.load(root, {});
  assert.equal(policyRules.classify(policy, 'rinomina la funzione load in app.js').class, 'meccanica');
  assert.equal(policyRules.classify(policy, 'decidi l\'architettura della cache').class, 'decisione');
  assert.equal(policyRules.classify(policy, 'correggi il bug del parser, il test fallisce').class, 'regressione');
  assert.equal(policyRules.classify(policy, 'implementa la feature in più fasi').size, 'large');
  icm(root, { profile: 'implementazione-sonnet' });
  const env = { CLAUDE_PROJECT_DIR: root, CARONTE_SKILL_MODE: 'off' };
  const context = suggest.run({ session_id: 's2', cwd: root, prompt: 'cerca dove viene chiamato parse' }, env).hookSpecificOutput.additionalContext;
  assert.match(context, /ROUTING: ricerca\): qualsiasi agent fino a haiku\/low;.*ricerca-haiku/);
  assert.match(context, /prossima fase a → implementazione-sonnet/);
  assert.match(context, /obblighi: /);
  assert.match(context, /Indice FastSkillRetrieval non ancora disponibile/);
  // Una procedura ECC nativa non produce il suggerimento di routing, solo l'avviso FSR.
  assert.doesNotMatch(suggest.run({ session_id: 's2', cwd: root, prompt: '/ecc:plan' }, env).hookSpecificOutput.additionalContext, /ROUTING: /);
  // off è ignorato: il suggerimento resta attivo.
  assert.match(suggest.run({ session_id: 's2', cwd: root, prompt: 'cerca x' }, { ...env, CARONTE_DELEGATION: 'off' }).hookSpecificOutput.additionalContext, /ROUTING: ricerca/);
});
