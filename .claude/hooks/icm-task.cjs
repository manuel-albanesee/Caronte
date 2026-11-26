// Hook nativi TaskCreated e TaskCompleted: un task per fase ICM, completato solo con ricevuta valida.
// Marcatore: [ICM:<percorso run.json>/<id fase>] nel titolo o nella descrizione del task.
// Exit 2 + motivo su stderr blocca; ogni errore interno di lettura consente (fail-open).
const fs = require('node:fs');
const { loadRun, valid } = require('../routing/icm.cjs');

const marker = /\[ICM:([^\]\r\n]+)\/([a-zA-Z0-9_-]+)\]/;
function parseMarker(event) {
  for (const key of ['task_subject', 'task_description']) {
    const m = typeof event[key] === 'string' && event[key].match(marker);
    if (m) return { manifest: m[1].trim(), stageId: m[2] };
  }
  return null;
}
// Restituisce null se consentito, altrimenti il motivo del blocco.
function evaluate(event, root) {
  const mark = parseMarker(event);
  if (!mark) return null;
  let run;
  try { run = loadRun(root, mark.manifest); }
  catch (error) {
    // Manifest assente: run inesistente (blocco solo su creazione); altri errori di lettura: fail-open.
    if (event.hook_event_name === 'TaskCreated' && /File necessario assente/.test(error.message)) return `ICM: il run ${mark.manifest} non esiste.`;
    return null;
  }
  if (!run.data.stages.some(s => s.id === mark.stageId)) {
    return event.hook_event_name === 'TaskCreated' ? `ICM: la fase ${mark.stageId} non esiste nel run ${mark.manifest}.` : null;
  }
  if (event.hook_event_name !== 'TaskCompleted') return null;
  const result = valid(run, mark.stageId);
  return result.ok ? null : `ICM: la fase ${mark.stageId} non ha una ricevuta valida (${result.reason}). Esegui il check ICM prima di completare il task.`;
}
function main() {
  let reason = null;
  try {
    const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, ''));
    reason = evaluate(event, process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd());
  } catch { return; }
  if (reason) { process.stderr.write(reason + '\n'); process.exitCode = 2; }
}
if (require.main === module) main();
module.exports = { parseMarker, evaluate };
