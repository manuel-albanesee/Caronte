const fs = require('node:fs');
const { initialize, readStatus } = require('../routing/telemetry.cjs');
const { sync } = require('../routing/dependencies.cjs');
const { isGateGuardDisabled } = require('./gateguard-rtk.cjs');
const { startIndexing } = require('../routing/fsr-index.cjs');
const path = require('node:path');

function gateRtkStatus(root, env = process.env) {
  const files = [
    path.join(root, '.claude/settings.local.json'), path.join(root, '.claude/settings.json'),
    path.join(env.CLAUDE_CONFIG_DIR || path.join(require('node:os').homedir(), '.claude'), 'settings.json'),
  ];
  const hooks = [];
  try {
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const groups = settings.hooks?.PreToolUse || [];
      if (!Array.isArray(groups)) return 'indeterminato: hook PreToolUse non valido';
      hooks.push(...groups.filter(group => {
        try { return !group.matcher || new RegExp(group.matcher).test('Bash'); } catch { return false; }
      }).flatMap(group => group.hooks || []));
    }
  } catch { return 'indeterminato: settings non leggibili'; }
  const coordinator = hooks.find(hook => (hook.args || []).some(arg => /gateguard-rtk\.cjs$/.test(arg)));
  const autonomous = hooks.some(hook => {
    if (hook.type !== 'command') return false;
    const command = (hook.command || '').replaceAll('\\', '/');
    if (Array.isArray(hook.args)) return /(?:^|\/)rtk(?:\.exe)?$/i.test(command) &&
      hook.args[0] === 'hook' && hook.args[1] === 'claude';
    return /(?:^|[\s/"'])rtk(?:\.exe)?["']?\s+hook\s+claude(?:\s|$)/i.test(command) ||
      /(?:^|[\s/"'])rtk-rewrite\.sh(?:["'\s]|$)/i.test(command);
  });
  if (coordinator && autonomous) return 'conflitto: hook RTK autonomo rilevato';
  if (!coordinator) return autonomous ? 'conflitto: RTK autonomo senza GateGuard' : 'disattivata: hook sequenziale assente';
  if (isGateGuardDisabled(env)) return 'disattivata: opt-out GateGuard nell’ambiente';
  const gate = coordinator.args?.find(arg => path.basename(arg).toLowerCase() === 'gateguard-fact-force.js');
  const rtk = coordinator.args?.find(arg => ['rtk', 'rtk.exe'].includes(path.basename(arg).toLowerCase()));
  if (!gate || !fs.existsSync(gate) || !rtk || !fs.existsSync(rtk)) return 'indeterminato: eseguibile o modulo non trovato';
  return 'configurata: GateGuard → RTK su Bash';
}

async function main() {
  const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  if (!['startup', 'resume'].includes(event.source)) return;
  const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  initialize(root);
  const result = await sync(root).catch(error => {
    process.stderr.write('Aggiornamento dipendenze del kit: ' + error.message + '\n');
    return {};
  });
  const labels = { ecc: 'ECC', rtk: 'RTK', fsr: 'FastSkillRetrieval', headroom: 'Headroom' };
  const messages = Object.entries(result)
    .filter(([, status]) => status.changed)
    .map(([name, status]) => (labels[name] || name) + ' aggiornato a ' + status.version);
  const pending = Object.entries(result)
    .filter(([name, status]) => !status.changed && status.pending && ['fsr', 'headroom'].includes(name))
    .map(([name, status]) => labels[name] + ' ' + status.pending);
  if (pending.length) messages.push('Disponibili ' + pending.join(', ') + ': esegui caronte update nella root del progetto a sessione chiusa');
  const indexing = startIndexing(root);
  if (indexing.started && indexing.firstBuild) {
    messages.push('FastSkillRetrieval: primo indice di skill, agent e comandi in costruzione in background (circa 3 minuti). Poi si aggiorna da solo quando cambia qualcosa');
  }
  messages.unshift('Caronte: GateGuard → RTK ' + gateRtkStatus(root));
  messages.unshift(readStatus(root)
    ? 'Caronte: telemetria locale attiva nei metadati Git del worktree; copre questa sessione e i suoi subagent. Registra esiti e conteggi, non prompt o codice. Disattiva con /caronte-telemetry-off'
    : 'Caronte: telemetria locale disattivata per questo worktree. Riattiva con /caronte-telemetry-on.');
  if (messages.length) process.stdout.write(JSON.stringify({ systemMessage: messages.join('. ') + '.' }));
}
if (require.main === module) main().catch(error => process.stderr.write('Aggiornamento dipendenze del kit: ' + error.message + '\n'));
module.exports = { gateRtkStatus };
