const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { showLogo, installationProgress } = require('./terminal-ui.cjs');
const { filePath } = require('./.claude/routing/icm.cjs');
const { prepareRtk, removeStandaloneRtk } = require('./rtk-setup.cjs');
const { location: eccLocation, planEcc } = require('./ecc-setup.cjs');
const { location: headroomLocation, planHeadroom, resolveHeadroomPython, setupHeadroom } = require('./headroom-setup.cjs');
const { applyRepositories } = require('./repository-setup.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const begin = '<!-- claude-routing-kit:begin -->', end = '<!-- claude-routing-kit:end -->';
const localSettingsFile = '.claude/settings.local.json';
const installationFile = '.claude-routing-backups/caronte-install.json';
const sidebarPath = '.claude/skills/caronte-panel/';
function kitAsset(rel) {
  return rel.startsWith('.claude/') &&
    !['.claude/settings.json', localSettingsFile].includes(rel.toLowerCase()) &&
    ![eccLocation, headroomLocation].some(location => rel.toLowerCase() === location || rel.toLowerCase().startsWith(location + '/')) &&
    !rel.startsWith('.claude/skills/caronte-panel/.claude-plugin/types/') &&
    rel !== '.claude/skills/caronte-panel/tsconfig.json';
}

function atomicWrite(file, content, mode = 0o666) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, content, { flag: 'wx', mode });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function install(target, dry = false, configureRtk = null, enableFullEcc = false, {
  snapshot, installedFiles, automatic = false, manageEcc = false, progress, dependencyPaths = {}, headroomPython,
} = {}) {
  const root = fs.realpathSync(target), source = __dirname;
  if (root === fs.realpathSync(source)) throw Error('Scegli la root del progetto, non la cartella del kit.');
  const readSource = rel => snapshot ? snapshot.files.get(rel) : fs.readFileSync(path.join(source, rel));
  const previous = JSON.parse(readSource('previous-files.json'));
  const changes = [];
  const backedUpSidebar = [];
  function readTarget(rel) {
    const p = filePath(root, rel);
    const stat = fs.lstatSync(p, { throwIfNoEntry: false });
    if (stat && !stat.isFile()) throw Error('Percorso di installazione non regolare: ' + rel);
    return { p, before: stat ? fs.readFileSync(p) : null, mode: stat?.mode };
  }
  function plan(rel, content, { p, before, mode } = readTarget(rel)) {
    if (before && before.equals(content)) return;
    changes.push({ rel, p, before, content, mode });
  }
  const claude = readTarget('CLAUDE.md');
  let text = claude.before?.toString('utf8') ?? '';
  const installed = text.indexOf(begin) >= 0 && text.indexOf(end) > text.indexOf(begin) &&
    (readTarget(installationFile).before !== null || readTarget('.claude/hooks/sync-dependencies.cjs').before !== null);
  function planAsset(rel) {
    const content = readSource(rel), target = readTarget(rel), { before } = target;
    if (before && !before.equals(content)) {
      const known = [previous.hashes[rel], previous.v2Hashes[rel], previous.v21Hashes[rel],
        previous.v232Hashes?.[rel], previous.v24Hashes?.[rel], previous.outputFilterHashes?.[rel],
        previous.dashboardHashes?.[rel], previous.v25Hashes?.[rel], previous.preEccFullHashes?.[rel], ...(previous.sidebarHashes?.[rel] ?? [])];
      const installedAsset = installedFiles?.get(rel);
      if (installedAsset) known.push(hash(installedAsset), hash(installedAsset.toString('utf8').replace(/\r\n/g, '\n')));
      const digest = hash(before);
      const normalized = hash(before.toString('utf8').replace(/\r\n/g, '\n'));
      if (![digest, normalized].some(value => known.includes(value))) {
        if (!installed || !rel.startsWith(sidebarPath)) {
          throw Error('Conflitto, file personalizzato: ' + rel + '. Nessuna modifica applicata.');
        }
        backedUpSidebar.push(rel);
      }
    }
    plan(rel, content, target);
  }
  function walk(folder) {
    for (const entry of fs.readdirSync(path.join(source, folder), { withFileTypes: true })) {
      const rel = folder + '/' + entry.name;
      if (!kitAsset(rel) || rel === '.claude/skills/caronte-panel/.claude-plugin/types') continue;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) planAsset(rel);
    }
  }
  if (snapshot) {
    for (const rel of snapshot.files.keys()) if (kitAsset(rel)) planAsset(rel);
  } else walk('.claude');
  const block = begin + '\n' + readSource('CLAUDE.md').toString('utf8').trim() + '\n' + end;
  if (text.includes(begin) || text.includes(end)) {
    if (text.split(begin).length !== 2 || text.split(end).length !== 2 || text.indexOf(begin) > text.indexOf(end)) throw Error('Marker routing incoerenti in CLAUDE.md.');
    text = text.slice(0, text.indexOf(begin)) + block + text.slice(text.indexOf(end) + end.length);
  } else if (text.includes(previous.claude.trim())) text = text.replace(previous.claude.trim(), block);
  else {
    if (/^# Routing dei modelli e ICM\s*$/m.test(text)) throw Error('Blocco routing personalizzato in CLAUDE.md: integrare il diff prima di installare.');
    text = text.trimEnd() + (text.trim() ? '\n\n' : '') + block + '\n';
  }
  plan('CLAUDE.md', Buffer.from(text), claude);
  const settingsPath = filePath(root, localSettingsFile);
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '')) : {};
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw Error('settings.local.json deve essere un oggetto JSON.');
  const sample = JSON.parse(readSource('.claude/settings.routing.example.json'));
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
  if (automatic) {
    settings.autoCompactEnabled ??= sample.autoCompactEnabled;
    settings.autoCompactWindow ??= sample.autoCompactWindow;
  } else {
    settings.autoCompactEnabled = sample.autoCompactEnabled;
    settings.autoCompactWindow = sample.autoCompactWindow;
    for (const model of Object.values(settings.modelSettings || {})) {
      if (model && Object.hasOwn(model, 'autoCompactWindow')) model.autoCompactWindow = sample.autoCompactWindow;
    }
  }
  const configuredPaths = {};
  if (manageEcc) {
    for (const name of ['ecc', 'headroom', 'rtk']) {
      const key = 'CARONTE_' + name.toUpperCase() + '_PATH';
      const value = dependencyPaths[name] ?? settings.env?.[key] ?? process.env[key];
      if (value) configuredPaths[name] = path.resolve(root, value);
      if (dependencyPaths[name]) settings.env = { ...settings.env, [key]: configuredPaths[name] };
    }
  }
  const ecc = manageEcc ? planEcc(root, settings, project, configuredPaths.ecc) : null;
  if (headroomPython) progress?.('Headroom: verifico il runtime tramite Python da ' + headroomPython + '.', undefined, 'Headroom', 0);
  const headroom = manageEcc ? planHeadroom(root, configuredPaths.headroom, headroomPython) : null;
  const repositories = [ecc, headroom].filter(plan => plan?.spec);
  for (const repo of repositories) {
    if (repo.report.status === 'present') progress?.(repo.spec.name + ': repository già presente, riuso la copia locale.', undefined, repo.spec.name, repo.spec.name === 'ECC' ? 100 : 25);
  }
  if (enableFullEcc || ecc) settings.env = { ...settings.env, CARONTE_ECC_FULL: '1' };
  const fullEcc = (settings.env?.CARONTE_ECC_FULL ?? project.env?.CARONTE_ECC_FULL) === '1';
  settings.env = fullEcc ? { ...settings.env } : automatic
    ? { ...sample.env, ...settings.env } : { ...settings.env, ...sample.env };
  const overrides = ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', 'DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT']
    .filter(key => [process.env, settings.env, project.env].some(env => env?.[key]));
  const summary = { model: settings.model, autoCompactWindow: settings.autoCompactWindow };
  if (fullEcc) summary.eccFull = true;
  if (ecc) {
    summary.ecc = ecc.report;
    if (ecc.report.status === 'external') progress?.('ECC: riuso il plugin già abilitato da ' + ecc.report.path + '.', undefined, 'ECC', 100);
  }
  if (headroom) {
    summary.headroom = headroom.report;
    if (headroom.report.runtime === 'present') {
      const detail = headroom.report.status === 'external' ? 'riuso ' + headroom.report.executable + '.' : 'ambiente Python già installato.';
      progress?.('Headroom ' + headroom.report.version + ': ' + detail, undefined, 'Headroom', 100);
    } else if (headroom.report.runtime === 'planned') {
      progress?.('Headroom: runtime del progetto da completare.');
    }
  }
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
    progress?.('Controllo RTK e il collegamento a GateGuard.', 1, 'RTK', 0);
    const { entry, ...status } = configureRtk({ dry, settings, project, bundledGateGuard: ecc?.gateGuard, progress, rtkPath: configuredPaths.rtk });
    if (entry) settings.hooks.PreToolUse.unshift(entry);
    summary.rtk = status;
    if (status.executable && !status.error) settings.env = { ...settings.env, CARONTE_RTK_EXECUTABLE: status.executable };
  } else if (automatic) {
    removeStandaloneRtk(settings);
  }
  plan(localSettingsFile, Buffer.from(JSON.stringify(settings, null, 2) + '\n'));
  if (snapshot) plan(installationFile, Buffer.from(JSON.stringify({ revision: snapshot.revision }) + '\n'));
  summary.changed = changes.map(x => x.rel);
  if (snapshot) summary.revision = snapshot.revision;
  if (backedUpSidebar.length) summary.backedUpSidebar = backedUpSidebar;
  for (const repo of repositories) {
    if (repo.report.status === 'planned' || repo.exclude || repo.report.runtime === 'planned') summary.changed.push(repo.spec.location);
  }
  if (dry || !summary.changed.length) return { dryRun: dry, ...summary };
  if (changes.length) progress?.('Aggiorno i file di Caronte nel progetto.', 2);
  const backupName = '.claude-routing-backups/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const backup = filePath(root, backupName); fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(changes.map(x => ({ path: x.rel, existed: !!x.before })), null, 2));
  for (const c of changes) if (c.before) { const p = path.join(backup, c.rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c.before); }
  const applied = [];
  try {
    for (const c of changes) {
      fs.mkdirSync(path.dirname(c.p), { recursive: true });
      atomicWrite(c.p, c.content, c.mode);
      applied.push(c);
    }
    if (repositories.length) applyRepositories(root, repositories, atomicWrite, progress);
  } catch (e) {
    for (const c of applied.reverse()) {
      if (c.before) atomicWrite(c.p, c.before, c.mode);
      else fs.rmSync(c.p, { force: true });
    }
    throw e;
  }
  if (headroom?.report.runtime === 'planned') setupHeadroom(root, headroom, false, progress);
  return { ...summary, backup: backupName };
}
async function cli(args) {
  const usage = 'Caronte — node install.cjs <project-root> [--dry-run | --verify] [--ecc-full] [--gate-rtk=<percorso-gateguard>]\n' +
    '         [--ecc-path=<directory>] [--headroom-path=<eseguibile>] [--rtk-path=<eseguibile>]\n' +
    '         [--headroom-python[=<percorso assoluto>]]\n' +
    '         node install.cjs --enable-auto-update | --disable-auto-update';
  if (args.includes('--help') || args.includes('-h')) return console.log(usage);
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Caronte requires Node.js 22 or later.');
  const { configureAutoUpdate, installFromCheckout } = require('./auto-update.cjs');
  if (args.length === 1 && ['--enable-auto-update', '--disable-auto-update'].includes(args[0])) {
    return console.log(JSON.stringify(configureAutoUpdate(args[0] === '--enable-auto-update'), null, 2));
  }
  const named = {};
  const flags = [];
  const targets = [];
  for (const arg of args) {
    const option = /^--(gate-rtk|ecc-path|headroom-path|headroom-python|rtk-path)=(.*)$/.exec(arg);
    if (option) {
      const [, name, value] = option;
      if (!value.trim() || Object.hasOwn(named, name)) throw Error(usage);
      named[name] = value;
    } else if (arg.startsWith('--')) flags.push(arg);
    else targets.push(arg);
  }
  if (targets.length !== 1 || new Set(flags).size !== flags.length ||
      flags.some(flag => !['--dry-run', '--verify', '--ecc-full', '--headroom-python'].includes(flag)) ||
      (flags.includes('--dry-run') && flags.includes('--verify')) ||
      (flags.includes('--headroom-python') && named['headroom-python'])) throw Error(usage);
  const pythonOption = named['headroom-python'] ?? flags.includes('--headroom-python');
  if (pythonOption && named['headroom-path']) throw Error('Scegli --headroom-path oppure --headroom-python.');
  const headroomPython = pythonOption ? resolveHeadroomPython(pythonOption) : undefined;
  const dependencyPaths = { ecc: named['ecc-path'], headroom: named['headroom-path'], rtk: named['rtk-path'] };
  const dry = flags.includes('--dry-run'), verify = flags.includes('--verify');
  const progress = dry || verify ? undefined : installationProgress();
  if (progress) await showLogo();
  progress?.('Preparo l’installazione in ' + targets[0] + '.');
  const result = installFromCheckout(targets[0], dry || verify,
    config => prepareRtk({ ...config, gateGuard: named['gate-rtk'] }), flags.includes('--ecc-full'),
    { manageEcc: true, progress, dependencyPaths, headroomPython });
  if (verify) {
    result.verified = result.changed.length === 0 && result.headroom.runtime === 'present' &&
      result.rtk.hook === 'reused';
    if (!result.verified) process.exitCode = 1;
  } else if (!dry) {
    if (result.rtk.error || result.headroom.error) {
      process.exitCode = 1;
      progress('Installazione incompleta. Il riepilogo indica le dipendenze da verificare.');
    } else {
      progress(result.changed.length || result.rtk.binary === 'installed' ? 'Installazione completata.' : 'Installazione già aggiornata.', 7);
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { install, atomicWrite, kitAsset, installationFile, begin, end, cli };
if (require.main === module) {
  cli(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
