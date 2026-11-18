const fs = require('node:fs');
const { initialize, readStatus } = require('../routing/telemetry.cjs');
const { sync } = require('../routing/dependencies.cjs');

async function main() {
  const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  if (!['startup', 'resume'].includes(event.source)) return;
  const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  initialize(root);
  const result = await sync(root).catch(error => {
    process.stderr.write('Aggiornamento dipendenze del kit: ' + error.message + '\n');
    return {};
  });
  const messages = Object.entries(result)
    .filter(([, status]) => status.changed)
    .map(([name, status]) => name.toUpperCase() + ' aggiornato a ' + status.version);
  if (readStatus(root)) messages.unshift('Caronte: telemetria locale attiva. Disattiva con /caronte-telemetry-off');
  if (messages.length) process.stdout.write(JSON.stringify({ systemMessage: messages.join('. ') + '.' }));
}
main().catch(error => process.stderr.write('Aggiornamento dipendenze del kit: ' + error.message + '\n'));
