const fs = require('node:fs');
const { toolEvent } = require('../routing/telemetry.cjs');
const { gate, loadRun, filePath } = require('../routing/icm.cjs');
const { authorize, writingProfiles, readingProfiles, eccFull, isKitProfile, isManagedWorker } = require('../routing/delivery.cjs');
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
function inputMetadata(section, keys = ['INPUT_FILES', 'ICM_RUN', 'ICM_STAGE', 'ECC_TOOLS', 'ECC_QUERY']) {
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
// Suggerimenti opzionali: richiedono CARONTE_SKILL_INDEX; qualsiasi problema produce [] e non blocca il validatore.
function suggestTools(objective, env = process.env) {
  try {
    if (!env.CARONTE_SKILL_INDEX || env.CARONTE_SKILL_MODE === 'off') return [];
    const { openIndex, search } = require('../routing/skill-suggest.cjs');
    const db = openIndex(env.CARONTE_SKILL_INDEX);
    if (!db) return [];
    try { return search(db, objective).map(h => h.name.replace(/^(?:agent|cmd)--/, '')); } finally { db.close(); }
  } catch { return []; }
}
function validate(event, root) {
  if (!['Agent', 'Task'].includes(event.tool_name)) return;
  const { subagent_type: profile, prompt } = event.tool_input || {};
  const coexist = eccFull();
  const kitProfile = isKitProfile(profile);
  if (coexist) {
    const managedCaller = isManagedWorker(root, event);
    if (managedCaller && !kitProfile) throw Error('Usa un profilo Caronte per una sotto-delega gestita dal kit.');
    const kitBrief = typeof prompt === 'string' && prompt.trimStart().startsWith('OBIETTIVO:');
    if (!kitProfile && !kitBrief) return;
  }
  const sections = parseBrief(prompt), meta = inputMetadata(sections.INPUT);
  if (coexist) {
    // Con ECC completo il coordinatore cerca gli strumenti ECC pertinenti (skill, agent, comandi) prima di delegare e li passa al subagent.
    if (meta.ECC_TOOLS === undefined) {
      // L'indice è in inglese: ECC_QUERY (parole chiave inglesi scelte dal coordinatore) rende la ricerca molto più precisa dell'OBIETTIVO in italiano.
      const found = suggestTools(meta.ECC_QUERY || sections.OBIETTIVO);
      throw Error('Cerca gli strumenti ECC pertinenti e indicali in INPUT con ECC_TOOLS: ["nome"], oppure ECC_TOOLS: [] se nessuno è pertinente.' +
        (found.length ? ` Suggeriti dall'indice${meta.ECC_QUERY ? '' : ' (ricerca sull\'OBIETTIVO in italiano: poco affidabile)'} (verifica la pertinenza): ${JSON.stringify(found)}.` : '') +
        (meta.ECC_QUERY ? '' : ' Per un risultato migliore aggiungi in INPUT ECC_QUERY: <3-6 parole chiave in inglese>, perché le descrizioni degli strumenti sono in inglese.'));
    }
    let tools;
    try { tools = JSON.parse(meta.ECC_TOOLS); } catch { tools = null; }
    if (!Array.isArray(tools) || tools.some(t => typeof t !== 'string' || !t.trim())) throw Error('ECC_TOOLS deve essere un array JSON di nomi di strumenti ECC.');
  }
  if (meta.INPUT_FILES !== undefined) {
    const files = JSON.parse(meta.INPUT_FILES);
    if (!Array.isArray(files) || files.some(f => typeof f !== 'string')) throw Error('INPUT_FILES deve essere un array JSON di percorsi.');
    for (const f of files) filePath(root, f, true);
  }
  if (meta.ICM_RUN !== undefined || meta.ICM_STAGE !== undefined) {
    if (!meta.ICM_RUN || !meta.ICM_STAGE) throw Error('Specifica sia ICM_RUN sia ICM_STAGE.');
    gate(loadRun(root, meta.ICM_RUN), meta.ICM_STAGE);
  }
  const { CAPABILITY, REVIEW_ID } = inputMetadata(sections.VINCOLI, ['CAPABILITY', 'REVIEW_ID']);
  if (coexist && !kitProfile && CAPABILITY !== 'write' && REVIEW_ID === undefined) {
    throw Error('Usa un profilo Caronte per una delega gestita in sola lettura, oppure assegna un piano di scrittura con REVIEW_ID.');
  }
  if (writingProfiles.has(profile) && CAPABILITY !== 'write') throw Error('Il profilo di sviluppo richiede CAPABILITY: write e REVIEW_ID.');
  if (CAPABILITY === 'write' || REVIEW_ID !== undefined) {
    if (readingProfiles.has(profile)) throw Error('Destinatario in sola lettura. Usa un worker implementazione.');
    if (CAPABILITY !== 'write' || !REVIEW_ID) throw Error('Una delega di scrittura richiede CAPABILITY: write e REVIEW_ID: <id>.');
    authorize(root, REVIEW_ID, event);
  }
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
      const reason = /ICM|manifest|dipendenz/i.test(message) ? 'icm_gate'
        : /REVIEW_ID|piano|baseline|orchestratore|delega scrivibile/i.test(message) ? 'review_plan' : 'brief_invalid';
      toolEvent(root, event, 'blocked', reason);
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${error.message} Brief: ${fields.join(', ')}. Conserva i letterali in blocchi di codice.` } }));
  }
}
if (require.main === module) main();
module.exports = { parseBrief, inputMetadata, validate, suggestTools };
