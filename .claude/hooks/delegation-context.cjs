const fs = require('node:fs');
const { profileReference } = require('../routing/dependencies.cjs');
const { eccFull, isManagedWorker } = require('../routing/delivery.cjs');
const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
if (event.hook_event_name === 'SubagentStart') {
  const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  if (eccFull() && !isManagedWorker(root, event)) return;
  const source = profileReference(root, event.agent_type);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'SubagentStart',
    additionalContext: 'Usa un esito verificabile, letture mirate e un brief autosufficiente OBIETTIVO, INPUT, FATTI, VINCOLI, USCITA, VERIFICA. Se scrivi usa il REVIEW_ID, i file e il comando di test mirato assegnati. La suite completa e la revisione del diff Git spettano all’orchestratore. Se INPUT elenca ECC_TOOLS, usa prima quegli strumenti ECC invece di cercarne altri. Segnala un prerequisito mancante con BLOCCATO e il dato preciso.' +
      (source ? ' Riferimento ECC, consulta solo le sezioni utili senza cambiare i vincoli del kit: ' + source : ''),
  } }));
}
