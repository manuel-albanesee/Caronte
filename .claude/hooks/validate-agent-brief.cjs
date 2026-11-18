const fs = require('node:fs');
const { gate, loadRun, filePath } = require('../routing/icm.cjs');
const { authorize, writingProfiles, readingProfiles } = require('../routing/delivery.cjs');
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
function inputMetadata(section, keys = ['INPUT_FILES', 'ICM_RUN', 'ICM_STAGE']) {
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
function validate(event, root) {
  if (!['Agent', 'Task'].includes(event.tool_name)) return;
  const sections = parseBrief(event.tool_input?.prompt), meta = inputMetadata(sections.INPUT);
  if (meta.INPUT_FILES !== undefined) {
    const files = JSON.parse(meta.INPUT_FILES);
    if (!Array.isArray(files) || files.some(f => typeof f !== 'string')) throw Error('INPUT_FILES deve essere un array JSON di percorsi.');
    for (const f of files) filePath(root, f, true);
  }
  if (meta.ICM_RUN !== undefined || meta.ICM_STAGE !== undefined) {
    if (!meta.ICM_RUN || !meta.ICM_STAGE) throw Error('Specifica sia ICM_RUN sia ICM_STAGE.');
    gate(loadRun(root, meta.ICM_RUN), meta.ICM_STAGE);
  }
  const profile = event.tool_input?.subagent_type;
  const { CAPABILITY, REVIEW_ID } = inputMetadata(sections.VINCOLI, ['CAPABILITY', 'REVIEW_ID']);
  if (writingProfiles.has(profile) && CAPABILITY !== 'write') throw Error('Il profilo di sviluppo richiede CAPABILITY: write e REVIEW_ID.');
  if (CAPABILITY === 'write' || REVIEW_ID !== undefined) {
    if (readingProfiles.has(profile)) throw Error('Destinatario in sola lettura. Usa un worker implementazione.');
    if (CAPABILITY !== 'write' || !REVIEW_ID) throw Error('Una delega di scrittura richiede CAPABILITY: write e REVIEW_ID: <id>.');
    authorize(root, REVIEW_ID, event);
  }
}
function main() {
  try {
    const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    validate(event, process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd());
  } catch (error) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${error.message} Brief: ${fields.join(', ')}. Conserva i letterali in blocchi di codice.` } }));
  }
}
if (require.main === module) main();
module.exports = { parseBrief, inputMetadata, validate };
