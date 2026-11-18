const fs = require('node:fs');
const { sync } = require('../routing/dependencies.cjs');

async function main() {
  const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  if (!['startup', 'resume'].includes(event.source)) return;
  const result = await sync(process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd());
  const messages = Object.entries(result)
    .filter(([, status]) => status.changed)
    .map(([name, status]) => name.toUpperCase() + ' aggiornato a ' + status.version);
  if (messages.length) process.stdout.write(JSON.stringify({ systemMessage: messages.join('. ') + '.' }));
}
main().catch(error => process.stderr.write('Aggiornamento dipendenze del kit: ' + error.message + '\n'));
