const fs = require('node:fs');
const { toolEvent } = require('../routing/telemetry.cjs');
const { gate, loadRun, filePath } = require('../routing/icm.cjs');
const { authorize, writingProfiles, readingProfiles, eccFull, isKitProfile, isManagedWorker, loadPlan } = require('../routing/delivery.cjs');
const policyRules = require('../routing/policy.cjs');
const fields = ['OBIETTIVO', 'INPUT', 'FATTI', 'VINCOLI', 'USCITA', 'VERIFICA'];
const empty = /^(?:todo|tbd|n\/?a|da (?:definire|compilare)|placeholder|\.{3}|…|\?|<[^>]+>|\{[^}]+\})[.!]?$/i;
function parseBrief(prompt) {
  if (typeof prompt !== 'string') throw Error('Il prompt deve essere testo.');
  const sections = {}; let current; let fence;
  for (const line of prompt.replace(/\r\n?/g, '\n').trim().split('\n')) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      sections[current].push(line);
      if (mark && mark[1][0] === fence.char && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
      continue;
    }
    if (mark) {
      if (!current) throw Error('Inizia con OBIETTIVO:.');
      fence = { char: mark[1][0], length: mark[1].length };
      sections[current].push(line); continue;
    }
    const h = line.match(/^(OBIETTIVO|INPUT|FATTI|VINCOLI|USCITA|VERIFICA):[ \t]*(.*)$/);
    if (h) {
      if (h[1] !== fields[Object.keys(sections).length]) throw Error('Campi duplicati o fuori ordine.');
      current = h[1]; sections[current] = [h[2]];
    } else if (current) sections[current].push(line);
    else if (line.trim()) throw Error('Inizia con OBIETTIVO:.');
  }
  if (fence) throw Error('Blocco di codice non chiuso.');
  if (Object.keys(sections).length !== fields.length) throw Error('Mancano campi obbligatori.');
  for (const key of fields) {
    sections[key] = sections[key].join('\n').trim();
    const value = sections[key];
    if (!value || empty.test(value) || (!['INPUT', 'FATTI', 'VINCOLI'].includes(key) && /^nessuno[.!]?$/i.test(value))) throw Error('Completa ' + key + ' con informazioni concrete.');
  }
  return sections;
}
function inputMetadata(section, keys = ['INPUT_FILES', 'ICM_RUN', 'ICM_STAGE', 'ECC_TOOLS', 'ECC_QUERY', 'ICM_SKIP', 'FSR_SKIP']) {
  const meta = {}; let fence;
  for (const line of section.split('\n')) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence.char && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
      continue;
    }
    if (mark) { fence = { char: mark[1][0], length: mark[1].length }; continue; }
    const m = line.match(new RegExp('^(' + keys.join('|') + '):[ \\t]*(.*)$'));
    if (m) {
      if (Object.hasOwn(meta, m[1])) throw Error('Metadato duplicato: ' + m[1]);
      meta[m[1]] = m[2].trim();
    }
  }
  return meta;
}
// Ricerca nell'indice FastSkillRetrieval (CARONTE_SKILL_INDEX, FSR_HOME o <root>/.caronte/.fsr).
// Restituisce [{ name, kind }] oppure null se l'indice manca o non è leggibile.
function fsrHits(query, root, env = process.env) {
  try {
    const { openIndex, search, defaultIndex, displayName } = require('../routing/skill-suggest.cjs');
    const dir = defaultIndex(env, root);
    const db = openIndex(dir);
    if (!db) return null;
    try { return search(db, query).map(h => ({ name: displayName(dir, h.name), kind: h.kind })); } finally { db.close(); }
  } catch { return null; }
}
// Compatibilità: solo i nomi, [] se l'indice manca.
function suggestTools(objective, env = process.env, root) {
  return (fsrHits(objective, root, env) || []).map(h => h.name);
}
// FSR obbligatorio: ECC_QUERY e ECC_TOOLS in INPUT. ECC_TOOLS elenca gli strumenti dell'indice FSR (skill, agent e comandi, ECC compresi);
// se FSR trova strumenti pertinenti almeno uno va incluso, salvo FSR_SKIP: <motivo di almeno 20 caratteri>.
function checkFsr(meta, sections, root, env = process.env) {
  if (!meta.ECC_QUERY) {
    const found = suggestTools(sections.OBIETTIVO, env, root);
    throw Error('Aggiungi in INPUT ECC_QUERY: <3-6 parole chiave in inglese> per la ricerca FSR (le descrizioni degli strumenti sono in inglese) ' +
      'ed ECC_TOOLS: ["nome"] con gli strumenti trovati.' + (found.length ? ` Ricerca sull'OBIETTIVO (poco affidabile): ${JSON.stringify(found)}.` : ''));
  }
  const hits = fsrHits(meta.ECC_QUERY, root, env);
  if (hits === null) {
    const err = Error('Indice FastSkillRetrieval assente o illeggibile: FSR è obbligatorio. Attendi la costruzione avviata a inizio sessione oppure esegui /fsr-init-index, poi ripeti la delega.');
    err.reason = 'fsr_index';
    throw err;
  }
  const names = hits.map(h => h.name);
  if (meta.ECC_TOOLS === undefined) {
    throw Error('Indica in INPUT ECC_TOOLS: ["nome"] con gli strumenti FSR pertinenti' + (names.length ? `: trovati ${JSON.stringify(names)} per «${meta.ECC_QUERY}».` : ', oppure ECC_TOOLS: [] (nessun risultato per la query).'));
  }
  let tools;
  try { tools = JSON.parse(meta.ECC_TOOLS); } catch { tools = null; }
  if (!Array.isArray(tools) || tools.some(t => typeof t !== 'string' || !t.trim())) throw Error('ECC_TOOLS deve essere un array JSON di nomi di strumenti FSR.');
  const skip = (meta.FSR_SKIP || '').trim();
  if (names.length && !tools.some(t => names.includes(t)) && skip.length < 20) {
    const err = Error(`FSR ha trovato strumenti pertinenti per «${meta.ECC_QUERY}»: ${JSON.stringify(names)}. Includine almeno uno in ECC_TOOLS ` +
      'oppure motiva l\'esclusione in INPUT con FSR_SKIP: <motivo di almeno 20 caratteri>.');
    err.reason = 'fsr_tools';
    throw err;
  }
  return hits.filter(h => h.kind === 'agent').map(h => h.name);
}
function validate(event, root) {
  if (!['Agent', 'Task'].includes(event.tool_name)) return;
  const { subagent_type: profile, prompt } = event.tool_input || {};
  // Routing obbligatorio: la policy deve esistere e ogni delega porta un brief completo.
  const policy = policyRules.load(root);
  const coexist = eccFull();
  const kitProfile = isKitProfile(profile);
  if (coexist) {
    const managedCaller = isManagedWorker(root, event);
    if (managedCaller && !kitProfile) throw Error('Usa un profilo Caronte per una sotto-delega gestita dal kit.');
    const kitBrief = typeof prompt === 'string' && prompt.trimStart().startsWith('OBIETTIVO:');
    // Solo una procedura ECC nativa delega con i propri prompt: avviata da poco nel thread principale (es. /ecc:tdd)
    // oppure sotto-delega interna di un agent ECC nativo non gestito da un piano Caronte.
    const nativeCaller = Boolean(event.agent_id) && !isKitProfile(event.agent_type) && !managedCaller;
    if (!kitProfile && !kitBrief && (nativeCaller || policyRules.recentNativeFlow(policy, root, event))) return;
  }
  const sections = parseBrief(prompt), meta = inputMetadata(sections.INPUT);
  const fsrAgents = checkFsr(meta, sections, root);
  if (meta.INPUT_FILES !== undefined) {
    const files = JSON.parse(meta.INPUT_FILES);
    if (!Array.isArray(files) || files.some(f => typeof f !== 'string')) throw Error('INPUT_FILES deve essere un array JSON di percorsi.');
    for (const f of files) filePath(root, f, true);
  }
  let stage = null, run = null;
  if (meta.ICM_RUN !== undefined || meta.ICM_STAGE !== undefined) {
    if (!meta.ICM_RUN || !meta.ICM_STAGE) throw Error('Specifica sia ICM_RUN sia ICM_STAGE.');
    run = loadRun(root, meta.ICM_RUN);
    stage = gate(run, meta.ICM_STAGE);
  }
  const constraints = inputMetadata(sections.VINCOLI, ['CAPABILITY', 'REVIEW_ID', 'ROUTING', 'ESCALATION']);
  const { CAPABILITY, REVIEW_ID } = constraints;
  if (writingProfiles.has(profile) && CAPABILITY !== 'write') throw Error('Il profilo di sviluppo richiede CAPABILITY: write e REVIEW_ID.');
  const write = CAPABILITY === 'write' || REVIEW_ID !== undefined;
  if (write) {
    if (readingProfiles.has(profile)) throw Error('Destinatario in sola lettura. Usa un worker implementazione.');
    if (CAPABILITY !== 'write' || !REVIEW_ID) throw Error('Una delega di scrittura richiede CAPABILITY: write e REVIEW_ID: <id>.');
  }
  // Prima di authorize, che registra la delega attiva: classe, specialista, modello, limiti e fase ICM.
  let plan = null;
  if (write) { try { plan = loadPlan(root, REVIEW_ID); } catch { /* il piano mancante è segnalato da authorize */ } }
  policyRules.checkRouting(policy, root, event, { constraints, meta, stage, run, plan, activeRuns: write ? policyRules.activeRuns(root) : [], fsrAgents });
  if (write) authorize(root, REVIEW_ID, event);
}
function main() {
  let event, root;
  try {
    event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
    validate(event, root);
  } catch (error) {
    if (event && root) {
      const message = error.message;
      const reason = error.reason || (/ICM|manifest|dipendenz/i.test(message) ? 'icm_gate'
        : /REVIEW_ID|piano|baseline|orchestratore|delega scrivibile/i.test(message) ? 'review_plan' : 'brief_invalid');
      toolEvent(root, event, 'blocked', reason);
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${error.message} Brief: ${fields.join(', ')}. Conserva i letterali in blocchi di codice.` } }));
  }
}
if (require.main === module) main();
module.exports = { parseBrief, inputMetadata, validate, suggestTools, fsrHits, checkFsr };
