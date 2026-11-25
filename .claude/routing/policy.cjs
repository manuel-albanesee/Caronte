'use strict';
// Policy di delega obbligatoria: classe di lavoro con tetto di modello, risoluzione del modello di qualsiasi agent installato,
// specialista obbligatorio al posto dell'agent generico, run ICM per ogni scrittura e soglie del coordinatore.
// Configurazione in .claude/routing/policy.json; CARONTE_DELEGATION (balanced | strict) sostituisce il campo mode.
// Il routing non si disattiva: il valore off è ignorato e una policy.json mancante blocca le deleghe.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const MODES = new Set(['balanced', 'strict']);
const GENERIC_AGENTS = ['general-purpose', 'claude'];
const TIERS = [['fable', 4], ['opus', 3], ['sonnet', 2], ['haiku', 1]];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
function policyError(message, reason = 'routing_policy') {
  const error = Error(message);
  error.reason = reason;
  return error;
}
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));

function load(root, env = process.env) {
  let data;
  try { data = readJSON(path.join(root, '.claude', 'routing', 'policy.json')); }
  catch (error) {
    if (error.code === 'ENOENT') throw policyError('policy.json mancante in .claude/routing: il routing di Caronte è obbligatorio. Ripristinalo con caronte update o caronte install-project.');
    throw policyError('policy.json non leggibile: ' + error.message);
  }
  // off non è più ammesso: un CARONTE_DELEGATION=off residuo è ignorato a favore del mode della policy.
  const pick = value => value && value !== 'off' ? value : null;
  const mode = pick(env.CARONTE_DELEGATION) || pick(data.mode) || 'balanced';
  if (!MODES.has(mode)) throw policyError('Modalità di delega non valida: ' + mode + ' (balanced, strict).');
  if (data.version !== 1 || !data.classes || typeof data.classes !== 'object') throw policyError('policy.json non valido.');
  for (const [name, cls] of Object.entries(data.classes)) {
    if (tierOf(cls.maxModel) === null) throw policyError('Classe senza maxModel valido (haiku, sonnet, opus, fable): ' + name);
    if (cls.maxEffort !== undefined && effortRank(cls.maxEffort) === null) throw policyError('maxEffort non valido nella classe ' + name);
  }
  return { ...data, mode };
}

function tier(model) { return tierOf(model); }
function tierOf(model) {
  if (typeof model !== 'string') return null;
  const m = model.toLowerCase();
  for (const [name, value] of TIERS) if (m.includes(name)) return value;
  return null;
}
function effortRank(value) {
  const i = EFFORTS.indexOf(String(value || '').toLowerCase());
  return i < 0 ? null : i;
}
function frontmatter(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const head = text.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!head) return null;
  const field = key => head[1].match(new RegExp('^' + key + ':[ \\t]*(.+)$', 'm'))?.[1].trim().replace(/^["']|["']$/g, '');
  return { model: field('model') || null, effort: field('effort') || null, file };
}
function configDir(env = process.env) {
  const dir = (env.CLAUDE_CONFIG_DIR || '').trim();
  return dir ? path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir())) : path.join(os.homedir(), '.claude');
}
// Cartelle agents dei plugin installati, per nome del plugin (chiave plugin@marketplace di installed_plugins.json).
function pluginAgentDirs(env = process.env) {
  const result = {};
  let data;
  try { data = readJSON(path.join(configDir(env), 'plugins', 'installed_plugins.json')); } catch { return result; }
  for (const [key, entries] of Object.entries(data.plugins || {})) {
    const name = key.split('@')[0];
    for (const e of Array.isArray(entries) ? entries : []) {
      if (typeof e?.installPath === 'string') (result[name] ??= []).push(path.join(e.installPath, 'agents'));
    }
  }
  return result;
}
// Modello ed effort dichiarati da un agent installato. source: project | user | plugin | builtin | unknown.
function agentInfo(root, name, policy = {}, env = process.env) {
  if (typeof name !== 'string' || !/^[\w:.-]+$/.test(name)) return { source: 'unknown', model: null, effort: null };
  const [plugin, agent] = name.includes(':') ? name.split(/:(.*)/s) : [null, name];
  const files = plugin
    ? (pluginAgentDirs(env)[plugin] || []).map(d => path.join(d, agent + '.md'))
    : [path.join(root, '.claude', 'agents', name + '.md'), path.join(configDir(env), 'agents', name + '.md')];
  for (const [i, f] of files.entries()) {
    const info = frontmatter(f);
    if (info) return { ...info, source: plugin ? 'plugin' : i === 0 ? 'project' : 'user' };
  }
  const builtin = policy.builtinModels || {};
  if (Object.hasOwn(builtin, name)) return { source: 'builtin', model: builtin[name], effort: null };
  return { source: 'unknown', model: null, effort: null };
}
// Compatibilità: solo i profili del progetto.
function profileInfo(root, name) {
  const info = frontmatter(path.join(root, '.claude', 'agents', String(name) + '.md'));
  return info && { model: info.model, effort: info.effort };
}
// Modello effettivo: model della chiamata, poi frontmatter; inherit o assente → CLAUDE_CODE_SUBAGENT_MODEL, poi inheritedModel della policy.
function effectiveModel(policy, info, input, env = process.env) {
  if (input.model && input.model !== 'inherit') return { model: input.model, from: 'chiamata' };
  if (info.model && info.model !== 'inherit') return { model: info.model, from: 'agent' };
  if (env.CLAUDE_CODE_SUBAGENT_MODEL) return { model: env.CLAUDE_CODE_SUBAGENT_MODEL, from: 'CLAUDE_CODE_SUBAGENT_MODEL' };
  return { model: policy.inheritedModel || 'opus', from: 'modello ereditato dalla sessione' };
}
// Una ricevuta ICM fallita della fase giustifica l'escalation senza motivazione scritta (cascata low → high).
function failedReceipt(run, stage) {
  if (!run || !stage) return false;
  try {
    const record = readJSON(path.join(run.stateDir, stage.id + '.json'));
    return record.status === 'fail' && record.reason !== 'verifica in corso o interrotta';
  } catch { return false; }
}

// ---- Stato del coordinatore per sessione (sotto la cartella Git, mai versionato) ----
function stateDir(root) {
  const r = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (r.status !== 0) return null;
  return path.join(r.stdout.trim(), 'caronte-routing');
}
function stateFile(root, session) {
  if (typeof session !== 'string' || !session) return null;
  const dir = stateDir(root);
  if (!dir) return null;
  return path.join(dir, 'session-' + crypto.createHash('sha256').update(session).digest('hex').slice(0, 16) + '.json');
}
function readState(root, session) {
  const file = stateFile(root, session);
  if (!file) return null;
  let state = {};
  try { state = readJSON(file); } catch { /* stato nuovo */ }
  return { file, state: { turn: 0, reads: 0, editLines: 0, editFiles: [], nativeFlowAt: 0, ...state } };
}
function writeState({ file, state }) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state) + '\n', { mode: 0o600 });
  try { fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
function cleanupStates(dir, now = Date.now()) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (/^session-[0-9a-f]{16}\.json$/.test(name) && now - fs.statSync(p).mtimeMs > 3 * 86400000) fs.rmSync(p, { force: true });
    }
  } catch { /* pulizia facoltativa */ }
}

function nativeFlowName(policy, text) {
  const pattern = new RegExp(policy.nativeFlow?.skillPattern || '^ecc:');
  const name = String(text || '').trim().replace(/^\//, '').split(/\s/)[0];
  return name && pattern.test(name) ? name : null;
}
function recentNativeFlow(policy, root, event) {
  const s = readState(root, event.session_id);
  const window = (policy.nativeFlow?.windowMinutes ?? 30) * 60000;
  return Boolean(s && s.state.nativeFlowAt && Date.now() - s.state.nativeFlowAt <= window);
}

// ---- Nessun agent è respinto per nome: il costo si governa con classe e tetto di modello ----
function checkAgentType() {}

// ---- Specialisti: agent generici e candidati specialisti per una classe ----
function genericAgents(policy) {
  return new Set(Array.isArray(policy.genericAgents) ? policy.genericAgents : GENERIC_AGENTS);
}
function isGeneric(policy, name) { return genericAgents(policy).has(name || 'general-purpose'); }
// Specialisti installati per la classe: nomi citati in preferred/specialists della classe più gli agent trovati da FSR,
// esclusi i generici, gli agent non installati e quelli oltre il tetto di modello della classe.
function specialistsFor(policy, root, cls, fsrAgents = [], env = process.env) {
  const rule = policy.classes[cls] || {};
  const named = [...(rule.specialists || []), ...(rule.preferred || [])].flatMap(text => String(text).match(/[\w][\w:.-]*[\w]/g) || []);
  const found = [];
  for (const name of new Set([...named, ...fsrAgents])) {
    if (isGeneric(policy, name)) continue;
    const info = agentInfo(root, name, policy, env);
    if (info.source === 'unknown') continue;
    const eff = effectiveModel(policy, info, {}, env);
    if (tierOf(eff.model) !== null && tierOf(eff.model) > tierOf(rule.maxModel)) continue;
    found.push(name);
  }
  return found;
}

// ---- Dopo il parsing del brief: classe, profilo, specialista, modello, fase ICM ----
function checkRouting(policy, root, event, { constraints, meta, stage, run, plan, activeRuns, fsrAgents }, env = process.env) {
  const input = event.tool_input || {};
  const profile = input.subagent_type;
  const write = constraints.CAPABILITY === 'write' || constraints.REVIEW_ID !== undefined;
  // ICM obbligatorio: ogni delega di scrittura appartiene a una fase di un run ICM.
  if (meta.ICM_SKIP !== undefined) {
    throw policyError('ICM_SKIP non è più ammesso: la metodologia ICM è obbligatoria. Collega la delega a una fase con ICM_RUN e ICM_STAGE in INPUT.', 'icm_gate');
  }
  if (write && (!meta.ICM_RUN || !meta.ICM_STAGE)) {
    const open = (activeRuns || []).filter(r => r.next);
    const list = open.length ? ' Run aperti: ' + open.map(r => `${r.manifest} → ${r.next}${r.profile ? ' (' + r.profile + ')' : ''}`).join('; ') + '.' : '';
    throw policyError('Ogni delega di scrittura richiede un run ICM: aggiungi in INPUT ICM_RUN: <percorso/run.json> e ICM_STAGE: <id>. ' +
      'Se manca, crea il manifest con la skill sviluppo-icm (status, gate, check).' + list, 'icm_gate');
  }
  if (stage?.profile && stage.profile !== profile) {
    throw policyError(`La fase ${stage.id} è assegnata a ${stage.profile}: usa quel profilo o aggiorna il manifest (la ricevuta della fase verrà invalidata).`, 'icm_gate');
  }
  if (stage && plan) {
    const outputs = new Set(stage.outputs);
    const outside = plan.files.filter(f => !outputs.has(f));
    if (outside.length) throw policyError(`Il piano ${plan.id} modifica file non dichiarati negli output della fase ${stage.id}: ${outside.join(', ')}.`, 'icm_gate');
  }
  const classes = Object.keys(policy.classes);
  const cls = constraints.ROUTING || stage?.class;
  if (!cls) throw policyError(`Indica in VINCOLI ROUTING: <classe> (${classes.join(', ')}). Qualsiasi agent installato è ammesso entro il tetto di modello della classe.`);
  if (!Object.hasOwn(policy.classes, cls)) throw policyError(`Classe di routing sconosciuta: ${cls}. Classi: ${classes.join(', ')}.`);
  const name = profile || 'general-purpose';
  // Specialista obbligatorio: un agent generico è negato se esiste uno specialista installato per la classe.
  if (isGeneric(policy, name)) {
    const specialists = specialistsFor(policy, root, cls, fsrAgents, env);
    if (specialists.length) {
      throw policyError(`${name} è un agent generico: per la classe ${cls} usa uno specialista installato (${specialists.join(', ')}). ` +
        'Gli agent generici sono ammessi solo quando nessuno specialista copre la classe.', 'specialist_required');
    }
  }
  const rule = policy.classes[cls], info = agentInfo(root, name, policy, env);
  const eff = effectiveModel(policy, info, input, env);
  const effort = input.effort || info.effort;
  const justified = (constraints.ESCALATION && constraints.ESCALATION.length >= 20) || failedReceipt(run, stage);
  const over = [];
  if (tierOf(eff.model) !== null && tierOf(eff.model) > tierOf(rule.maxModel)) over.push(`modello ${eff.model} (${eff.from}) oltre il tetto ${rule.maxModel} della classe ${cls}`);
  if (rule.maxEffort && effort && effortRank(effort) !== null && effortRank(effort) > effortRank(rule.maxEffort)) over.push(`effort ${effort} oltre il tetto ${rule.maxEffort} della classe ${cls}`);
  if (input.model && tierOf(input.model) !== null && tierOf(info.model) !== null && tierOf(input.model) > tierOf(info.model)) over.push(`modello ${input.model} superiore a quello dell'agent (${info.model})`);
  if (input.effort && effortRank(input.effort) !== null && effortRank(info.effort) !== null && effortRank(input.effort) > effortRank(info.effort)) over.push(`effort ${input.effort} superiore a quello dell'agent (${info.effort})`);
  if (over.length && !justified) {
    throw policyError(`${name}: ${over.join('; ')}. Passa nella chiamata model: ${rule.maxModel}${rule.maxEffort ? ' ed effort: ' + rule.maxEffort : ''}, ` +
      'oppure aggiungi in VINCOLI ESCALATION: <tentativo precedente e nuova evidenza>. In una fase ICM una ricevuta check fallita vale come motivazione.');
  }
  // Limiti di scrittura per livello di modello (es. haiku: pochi file e test mirato obbligatorio).
  const level = TIERS.find(([, v]) => v === tierOf(eff.model))?.[0];
  const limits = level && policy.writeLimits?.[level];
  if (limits && plan) {
    if (limits.maxFiles !== undefined && plan.files.length > limits.maxFiles) {
      throw policyError(`Un worker ${level} accetta al massimo ${limits.maxFiles} file per piano (${plan.files.length} dichiarati): usa un agent Sonnet o dividi il lavoro in fasi.`);
    }
    if (limits.requireTests && !plan.tests?.length) throw policyError(`Un worker ${level} richiede un test mirato nel piano: senza test usa un agent Sonnet.`);
  }
}

// ---- Run ICM aperti sotto .icm (profondità massima 3) ----
function findManifests(root) {
  const base = path.join(root, '.icm'), found = [];
  (function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile() && e.name === 'run.json') found.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
      else if (e.isDirectory() && depth < 3 && !e.name.startsWith('.state-') && e.name !== 'output') walk(path.join(dir, e.name), depth + 1);
    }
  })(base, 1);
  return found.sort();
}
function activeRuns(root) {
  const { loadRun, status } = require('./icm.cjs');
  const result = [];
  for (const manifest of findManifests(root)) {
    try {
      const run = loadRun(root, manifest), s = status(run);
      if (!s.next) continue;
      const stage = run.data.stages.find(x => x.id === s.next);
      result.push({ manifest, runId: s.runId, next: s.next, profile: stage.profile || null, class: stage.class || null });
    } catch { /* un manifest non valido viene segnalato da status, non qui */ }
  }
  return result;
}

// ---- Coordinatore: soglie di lettura e modifica diretta ----
function lineCount(text) { return typeof text === 'string' && text.length ? text.split('\n').length : 0; }
function changedLines(event, absolute) {
  const input = event.tool_input || {};
  switch (event.tool_name) {
    case 'Edit': return Math.max(lineCount(input.old_string), lineCount(input.new_string));
    case 'MultiEdit': return (input.edits || []).reduce((n, e) => n + Math.max(lineCount(e.old_string), lineCount(e.new_string)), 0);
    case 'NotebookEdit': return Math.max(1, lineCount(input.new_source));
    case 'Write': {
      const next = String(input.content || '').split('\n');
      let before = [];
      try { before = fs.readFileSync(absolute, 'utf8').split('\n'); } catch { /* file nuovo */ }
      const old = new Set(before), now = new Set(next);
      return Math.max(next.filter(l => !old.has(l)).length, before.filter(l => !now.has(l)).length);
    }
    default: return 0;
  }
}
function projectRelative(root, event, target) {
  if (typeof target !== 'string' || !target) return null;
  let base;
  try { base = fs.realpathSync(root); } catch { base = path.resolve(root); }
  const absolute = path.resolve(event.cwd || base, target);
  const rel = path.relative(base, absolute);
  if (!rel) return { absolute, rel: '.' };
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return { absolute, rel: null };
  return { absolute, rel: rel.split(path.sep).join('/') };
}
function exempt(policy, rel) {
  const c = policy.coordinator || {};
  return (c.exemptPrefixes || []).some(p => rel.startsWith(p)) || (c.exemptExtensions || []).some(x => rel.toLowerCase().endsWith(x));
}
function coordinatorLimits(policy) {
  return policy.coordinator?.[policy.mode] || { maxEditLines: Infinity, maxEditFiles: Infinity, maxReads: Infinity };
}

function coordinatorPre(policy, root, event) {
  if (event.agent_id) return;
  const holder = readState(root, event.session_id);
  if (!holder) return;
  const { state } = holder, limits = coordinatorLimits(policy), input = event.tool_input || {};
  if (event.tool_name === 'Skill') {
    if (nativeFlowName(policy, input.skill || input.name)) { state.nativeFlowAt = Date.now(); writeState(holder); }
    return;
  }
  // In balanced una procedura ECC nativa avviata da poco (es. /ecc:tdd) segue le proprie regole nel thread principale.
  const window = (policy.nativeFlow?.windowMinutes ?? 30) * 60000;
  if (policy.mode === 'balanced' && state.nativeFlowAt && Date.now() - state.nativeFlowAt <= window) return;
  if (event.tool_name === 'Read' || event.tool_name === 'Grep') {
    const target = projectRelative(root, event, input.file_path || input.path || '.');
    if (target && (!target.rel || exempt(policy, target.rel))) return;
    state.reads += 1;
    writeState(holder);
    if (state.reads > limits.maxReads) {
      throw policyError(`Il coordinatore ha superato ${limits.maxReads} letture dirette dall'ultima delega in questo turno (policy ${policy.mode}). ` +
        'Affida l\'esplorazione a ricerca-haiku o a un altro agent Haiku con un brief (ROUTING: ricerca) e lavora sui riferimenti restituiti; ' +
        'le letture sotto .icm, .claude e .git (diff di review) restano libere.', 'coordinator_budget');
    }
    return;
  }
  if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(event.tool_name)) return;
  const target = projectRelative(root, event, input.file_path ?? input.notebook_path);
  if (!target || !target.rel || exempt(policy, target.rel)) return;
  const lines = changedLines(event, target.absolute);
  const files = new Set(state.editFiles); files.add(target.rel);
  if (state.editLines + lines > limits.maxEditLines || files.size > limits.maxEditFiles) {
    throw policyError(`Modifica diretta oltre la soglia del coordinatore (${state.editLines + lines}/${limits.maxEditLines} righe, ${files.size}/${limits.maxEditFiles} file in questo turno, policy ${policy.mode}). ` +
      'Prepara il piano con node .claude/routing/delivery.cjs plan e delega con ROUTING: <classe> a un agent entro il tetto della classe, ' +
      'preferendo lo specialista installato più adatto. In un run ICM usa il profile della fase.', 'coordinator_budget');
  }
  state.editLines += lines; state.editFiles = [...files];
  writeState(holder);
}
function coordinatorPost(policy, root, event) {
  if (event.agent_id || !['Agent', 'Task'].includes(event.tool_name)) return;
  const holder = readState(root, event.session_id);
  if (!holder) return;
  holder.state.reads = 0;
  writeState(holder);
}
function newTurn(policy, root, event) {
  const holder = readState(root, event.session_id);
  if (!holder) return;
  cleanupStates(path.dirname(holder.file));
  const flow = nativeFlowName(policy, event.prompt);
  holder.state = { ...holder.state, turn: holder.state.turn + 1, reads: 0, editLines: 0, editFiles: [], ...(flow ? { nativeFlowAt: Date.now() } : {}) };
  writeState(holder);
}

// ---- Classificatore deterministico per il suggerimento all'invio del prompt ----
function normalize(text) { return ' ' + String(text).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}#+\-]+/gu, ' ') + ' '; }
function matches(text, keyword) { return text.includes(' ' + normalize(keyword).trim() + ' '); }
function classify(policy, prompt) {
  const text = normalize(prompt);
  let best = null;
  for (const [name, cls] of Object.entries(policy.classes)) {
    const score = (cls.keywords || []).filter(k => matches(text, k)).length;
    if (score && (!best || score > best.score)) best = { name, score, profiles: cls.preferred || [], maxModel: cls.maxModel, maxEffort: cls.maxEffort };
  }
  const large = policy.largeTask || {};
  const paths = (String(prompt).match(/[\w.-]+\/[\w./-]+|\b[\w-]+\.(?:c?js|ts|tsx|py|java|cs|go|rs|md|json)\b/g) || []).length;
  const isLarge = (large.keywords || []).some(k => matches(text, k)) ||
    paths >= (large.minPaths ?? 5) || String(prompt).length >= (large.minLength ?? 1200);
  return { class: best?.name || null, profiles: best?.profiles || [], maxModel: best?.maxModel || null, maxEffort: best?.maxEffort || null, size: isLarge ? 'large' : paths <= 1 && String(prompt).length < 160 ? 'small' : 'standard' };
}
function routingHint(policy, root, prompt) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.trim().startsWith('/')) return null;
  const c = classify(policy, prompt), runs = activeRuns(root), parts = [];
  if (c.class) parts.push(`classe probabile «${c.class}» (ROUTING: ${c.class}): qualsiasi agent fino a ${c.maxModel}${c.maxEffort ? '/' + c.maxEffort : ''}; preferisci lo specialista installato più adatto, altrimenti ${c.profiles.join(' o ')}`);
  if (c.size === 'large') parts.push('lavoro ampio: prepara un run ICM (skill sviluppo-icm) con profile e class per fase, decisione-opus solo per la fase di scelta');
  else if (c.size === 'small' && c.class && ['meccanica', 'ricerca'].includes(c.class)) parts.push('se resta entro le soglie del coordinatore eseguilo direttamente');
  for (const r of runs) parts.push(`run ICM aperto ${r.manifest}: prossima fase ${r.next}${r.profile ? ' → ' + r.profile : ''}`);
  if (c.class) parts.push('obblighi: ogni delega di scrittura in una fase ICM (ICM_RUN, ICM_STAGE), specialista al posto degli agent generici, ECC_QUERY ed ECC_TOOLS dagli strumenti FSR');
  if (!parts.length) return null;
  const l = coordinatorLimits(policy);
  return `Routing Caronte (${policy.mode}): ${parts.join('; ')}. Soglie dirette del coordinatore per turno: ${l.maxEditLines} righe, ${l.maxEditFiles} file, ${l.maxReads} letture.`;
}

// ---- Elenco degli agent installati con modello effettivo e classi ammesse ----
function listAgents(root, policy, env = process.env) {
  const names = new Set(['general-purpose', 'Explore', 'Plan', ...Object.keys(policy.builtinModels || {})]);
  const scan = (dir, prefix = '') => { try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) names.add(prefix + f.slice(0, -3)); } catch { /* cartella assente */ } };
  scan(path.join(root, '.claude', 'agents'));
  scan(path.join(configDir(env), 'agents'));
  for (const [plugin, dirs] of Object.entries(pluginAgentDirs(env))) for (const d of dirs) scan(d, plugin + ':');
  return [...names].sort().map(name => {
    const info = agentInfo(root, name, policy, env), eff = effectiveModel(policy, info, {}, env);
    const classes = Object.entries(policy.classes).filter(([, c]) => tierOf(eff.model) === null || tierOf(eff.model) <= tierOf(c.maxModel)).map(([n]) => n);
    return { name, source: info.source, model: eff.model, modelFrom: eff.from, effort: info.effort, classes };
  });
}
if (require.main === module) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const policy = load(root);
  if (!policy) console.log('Policy di delega disattivata.');
  else for (const a of listAgents(root, policy)) console.log(`${a.name.padEnd(36)} ${String(a.model).padEnd(20)} ${a.source.padEnd(8)} ${a.classes.join(', ')}`);
}

module.exports = {
  load, tier, effortRank, profileInfo, agentInfo, effectiveModel, listAgents, checkAgentType, checkRouting, activeRuns, findManifests,
  coordinatorPre, coordinatorPost, newTurn, classify, routingHint, readState, nativeFlowName, recentNativeFlow, policyError,
  isGeneric, specialistsFor,
};
