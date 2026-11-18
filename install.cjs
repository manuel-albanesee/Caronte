const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { filePath } = require('./.claude/routing/icm.cjs');
const { prepareRtk } = require('./rtk-setup.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const begin = '<!-- claude-routing-kit:begin -->', end = '<!-- claude-routing-kit:end -->';
function install(target, dry = false, configureRtk = null) {
  const root = fs.realpathSync(target), source = __dirname;
  if (root === fs.realpathSync(source)) throw Error('Scegli la root del progetto, non la cartella del kit.');
  const previous = JSON.parse(fs.readFileSync(path.join(source, 'previous-files.json'), 'utf8'));
  const changes = [];
  function plan(rel, content) {
    const p = filePath(root, rel), before = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (before && before.equals(content)) return;
    changes.push({ rel, p, before, content });
  }
  function walk(folder) {
    for (const entry of fs.readdirSync(path.join(source, folder), { withFileTypes: true })) {
      const rel = folder + '/' + entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) {
        const content = fs.readFileSync(path.join(source, rel)), p = filePath(root, rel);
        if (fs.existsSync(p)) {
          const before = fs.readFileSync(p);
          const known = [previous.hashes[rel], previous.v2Hashes[rel], previous.v21Hashes[rel], previous.v232Hashes?.[rel]];
          const digest = hash(before);
          const normalized = hash(before.toString('utf8').replace(/\r\n/g, '\n'));
          if (!before.equals(content) && !known.includes(digest) && !known.includes(normalized)) throw Error('Conflitto, file personalizzato: ' + rel + '. Nessuna modifica applicata.');
        }
        plan(rel, content);
      }
    }
  }
  walk('.claude');
  const claude = filePath(root, 'CLAUDE.md');
  let text = fs.existsSync(claude) ? fs.readFileSync(claude, 'utf8') : '';
  const block = begin + '\n' + fs.readFileSync(path.join(source, 'CLAUDE.md'), 'utf8').trim() + '\n' + end;
  if (text.includes(begin) || text.includes(end)) {
    if (text.split(begin).length !== 2 || text.split(end).length !== 2 || text.indexOf(begin) > text.indexOf(end)) throw Error('Marker routing incoerenti in CLAUDE.md.');
    text = text.slice(0, text.indexOf(begin)) + block + text.slice(text.indexOf(end) + end.length);
  } else if (text.includes(previous.claude.trim())) text = text.replace(previous.claude.trim(), block);
  else {
    if (/^# Routing dei modelli e ICM\s*$/m.test(text)) throw Error('Blocco routing personalizzato in CLAUDE.md: integrare il diff prima di installare.');
    text = text.trimEnd() + (text.trim() ? '\n\n' : '') + block + '\n';
  }
  plan('CLAUDE.md', Buffer.from(text));
  const settingsPath = filePath(root, '.claude/settings.local.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '')) : {};
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw Error('settings.local.json deve essere un oggetto JSON.');
  const sample = JSON.parse(fs.readFileSync(path.join(source, '.claude/settings.routing.example.json'), 'utf8'));
  const projectPath = filePath(root, '.claude/settings.json');
  let project = {};
  if (fs.existsSync(projectPath)) {
    project = JSON.parse(fs.readFileSync(projectPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!project || Array.isArray(project) || typeof project !== 'object') throw Error('settings.json deve essere un oggetto.');
    const before = JSON.stringify(project);
    for (const [event, incoming] of Object.entries(sample.hooks)) {
      const names = incoming.flatMap(g => g.hooks.flatMap(h => h.args || [])).map(a => a.split('/').pop());
      if (project.hooks?.[event]) {
        if (!Array.isArray(project.hooks[event])) throw Error('Evento hook di progetto non valido.');
        project.hooks[event] = project.hooks[event].map(g => ({...g, hooks:(g.hooks || []).filter(h => !names.some(n => (h.args || []).some(a => a.replaceAll('\\', '/').endsWith('/' + n))))})).filter(g => g.hooks.length);
      }
    }
    if (JSON.stringify(project) !== before) plan('.claude/settings.json', Buffer.from(JSON.stringify(project, null, 2) + '\n'));
  }
  settings.model ??= sample.model; settings.effortLevel ??= sample.effortLevel;
  settings.autoCompactEnabled = sample.autoCompactEnabled;
  settings.autoCompactWindow = sample.autoCompactWindow;
  for (const model of Object.values(settings.modelSettings || {})) {
    if (model && Object.hasOwn(model, 'autoCompactWindow')) model.autoCompactWindow = sample.autoCompactWindow;
  }
  settings.env = { ...settings.env, ...sample.env };
  const overrides = ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', 'DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT']
    .filter(key => [process.env, settings.env, project.env].some(env => env?.[key]));
  const summary = { model: settings.model, autoCompactWindow: settings.autoCompactWindow };
  if (overrides.length) summary.checkEnvironmentOverrides = overrides;
  settings.hooks ??= {};
  if (Array.isArray(settings.hooks) || typeof settings.hooks !== 'object') throw Error('hooks non valido.');
  for (const [event, incoming] of Object.entries(sample.hooks)) {
    const old = settings.hooks[event] || [];
    if (!Array.isArray(old)) throw Error('Evento hook non valido: ' + event);
    const ownNames = incoming.flatMap(x => x.hooks.flatMap(h => h.args || [])).map(x => x.split('/').pop());
    const retained = old.map(group => ({ ...group, hooks: (group.hooks || []).filter(h => !ownNames.some(n => (h.args || []).some(a => a.replaceAll('\\', '/').endsWith('/' + n)))) })).filter(g => g.hooks.length);
    settings.hooks[event] = [...retained, ...incoming];
  }
  if (configureRtk) {
    const { entry, ...status } = configureRtk({ dry, settings, project });
    if (entry) settings.hooks.PreToolUse.unshift(entry);
    summary.rtk = status;
  }
  plan('.claude/settings.local.json', Buffer.from(JSON.stringify(settings, null, 2) + '\n'));
  summary.changed = changes.map(x => x.rel);
  if (dry || !changes.length) return { dryRun: dry, ...summary };
  const backupName = '.claude-routing-backups/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const backup = filePath(root, backupName); fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(changes.map(x => ({ path: x.rel, existed: !!x.before })), null, 2));
  for (const c of changes) if (c.before) { const p = path.join(backup, c.rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c.before); }
  const applied = [];
  try {
    for (const c of changes) { applied.push(c); fs.mkdirSync(path.dirname(c.p), { recursive: true }); fs.writeFileSync(c.p, c.content); }
  } catch (e) {
    for (const c of applied.reverse()) { if (c.before) fs.writeFileSync(c.p, c.before); else fs.rmSync(c.p, { force: true }); }
    throw e;
  }
  return { ...summary, backup: backupName };
}
if (require.main === module) {
  try {
    const usage = 'Caronte — node install.cjs <project-root> [--dry-run | --verify]';
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) console.log(usage);
    else {
      const flags = args.filter(arg => arg.startsWith('--'));
      const targets = args.filter(arg => !arg.startsWith('--'));
      if (targets.length !== 1 || flags.length > 1 || flags.some(flag => !['--dry-run', '--verify'].includes(flag))) throw Error(usage);
      if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Caronte requires Node.js 22 or later.');
      const dry = flags.includes('--dry-run'), verify = flags.includes('--verify');
      const result = install(targets[0], dry || verify, prepareRtk);
      if (verify) {
        result.verified = result.changed.length === 0 && result.rtk.hook === 'reused' && !result.rtk.pathNote;
        if (!result.verified) process.exitCode = 1;
      } else if (!dry && result.rtk.error) process.exitCode = 1;
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { install };
