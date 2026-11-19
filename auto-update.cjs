const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { filePath } = require('./.claude/routing/icm.cjs');
const { install, atomicWrite, kitAsset, installationFile, begin, end } = require('./install.cjs');

// Last revision before the installer started recording the installed commit.
const legacyRevision = 'ffba232a2e00c3c04428f3776d85ed808da3ce80';
const revisionPattern = /^[0-9a-f]{40}$/;
const script = 'auto-update.cjs';
const source = __dirname;

function git(args, { input, statuses = [0] } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, { GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
  const result = spawnSync('git', args, {
    cwd: source, env, input, timeout: 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (!statuses.includes(result.status)) throw Error('Git: ' + result.stderr.toString('utf8').trim());
  return result;
}

function checkoutRevision() {
  const result = git(['rev-parse', '--show-toplevel'], { statuses: [0, 128] });
  if (result.status !== 0 || fs.realpathSync(result.stdout.toString('utf8').trim()) !== fs.realpathSync(source)) return null;
  const revision = git(['rev-parse', '--verify', 'HEAD']).stdout.toString('ascii').trim();
  if (!revisionPattern.test(revision)) throw Error('Revisione Git di Caronte non riconosciuta.');
  return revision;
}

function snapshotAt(revision) {
  const names = ['CLAUDE.md', 'previous-files.json'];
  const tree = git(['ls-tree', '-rz', revision, '--', '.claude', ...names]).stdout.toString('utf8');
  const entries = [];
  for (const row of tree.split('\0').filter(Boolean)) {
    const [mode, type, object] = row.slice(0, row.indexOf('\t')).split(' ');
    const name = row.slice(row.indexOf('\t') + 1);
    if (!names.includes(name) && !kitAsset(name)) continue;
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw Error('File Caronte non regolare: ' + name);
    entries.push({ name, object });
  }
  const { stdout } = git(['cat-file', '--batch'], { input: entries.map(entry => entry.object + '\n').join('') });
  const files = new Map();
  let offset = 0;
  for (const { name, object } of entries) {
    const newline = stdout.indexOf(10, offset);
    const [oid, type, size] = stdout.toString('ascii', offset, newline).split(' ');
    const length = Number(size), start = newline + 1;
    if (oid !== object || type !== 'blob' || !Number.isSafeInteger(length) || length < 0 || stdout[start + length] !== 10) {
      throw Error('Oggetto Git Caronte non leggibile: ' + name);
    }
    files.set(name, stdout.subarray(start, start + length));
    offset = start + length + 1;
  }
  return { revision, files };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function installedRevision(root) {
  const data = readJson(filePath(root, installationFile));
  if (data === undefined) return null;
  if (typeof data?.revision !== 'string' || !revisionPattern.test(data.revision)) {
    throw Error('Revisione dell’installazione Caronte non valida.');
  }
  return data.revision;
}

function withInstallLock(root, apply) {
  const lock = filePath(root, '.claude-routing-backups/.caronte-install.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw Error('Installazione Caronte già in corso (' + path.basename(lock) + ').');
    throw error;
  }
  try {
    return apply();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function applyCheckout(root, revision, previous, dry, configureRtk, fullEcc, automatic, manageEcc = false) {
  const snapshot = snapshotAt(revision);
  const baseline = previous ?? legacyRevision;
  const available = git(['cat-file', '-e', baseline + '^{commit}'], { statuses: [0, 1, 128] }).status === 0;
  const installedFiles = revision === baseline ? snapshot.files : available ? snapshotAt(baseline).files : undefined;
  return install(root, dry, configureRtk, fullEcc, {
    snapshot, installedFiles, automatic, manageEcc,
  });
}

function installFromCheckout(target, dry, configureRtk, fullEcc, manageEcc) {
  const root = fs.realpathSync(target);
  if (root === fs.realpathSync(source)) return install(root, dry, configureRtk, fullEcc);
  const revision = checkoutRevision();
  const apply = () => revision
    ? applyCheckout(root, revision, installedRevision(root), dry, configureRtk, fullEcc, false, manageEcc)
    : install(root, dry, configureRtk, fullEcc, { manageEcc });
  return dry || (!revision && !manageEcc) ? apply() : withInstallLock(root, apply);
}

function hasInstallation(root) {
  const doc = path.join(root, 'CLAUDE.md');
  if (!fs.lstatSync(doc, { throwIfNoEntry: false })?.isFile()) return false;
  const text = fs.readFileSync(doc, 'utf8');
  if (text.indexOf(begin) === -1 || text.indexOf(end) <= text.indexOf(begin)) return false;
  return fs.lstatSync(filePath(root, installationFile), { throwIfNoEntry: false })?.isFile() ||
    fs.lstatSync(filePath(root, '.claude/hooks/sync-dependencies.cjs'), { throwIfNoEntry: false })?.isFile();
}

function ancestor(older, newer) {
  return git(['merge-base', '--is-ancestor', older, newer], { statuses: [0, 1] }).status === 0;
}

function updateProject(target) {
  const root = fs.realpathSync(target);
  if (root === fs.realpathSync(source) || !hasInstallation(root)) return null;
  const revision = checkoutRevision();
  if (!revision) throw Error('Clone locale di Caronte non disponibile.');
  if (revision === installedRevision(root)) return null;
  return withInstallLock(root, () => {
    const previous = installedRevision(root);
    if (previous === revision) return null;
    if (previous && !ancestor(previous, revision)) {
      if (ancestor(revision, previous)) return null;
      throw Error('La revisione locale e quella del progetto hanno storie Git diverse.');
    }
    const result = applyCheckout(root, revision, previous, false, null, false, true);
    return result.changed.some(file => file !== installationFile) ? revision : null;
  });
}

function configureAutoUpdate(enabled) {
  if (enabled && !checkoutRevision()) throw Error('Attiva l’aggiornamento dal clone Git di Caronte.');
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const settingsPath = path.resolve(dir, 'settings.json');
  const file = fs.existsSync(settingsPath) ? fs.realpathSync(settingsPath) : settingsPath;
  const data = readJson(file);
  const settings = data === undefined ? {} : data;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      (settings.hooks != null && (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)))) {
    throw Error('Configurazione utente Claude Code non valida.');
  }
  const old = settings.hooks?.SessionStart ?? [];
  if (!Array.isArray(old) || old.some(group => !Array.isArray(group?.hooks))) {
    throw Error('Hook utente SessionStart non valido.');
  }
  const isUpdater = hook => hook?.type === 'command' && typeof hook.args?.[0] === 'string' &&
    path.basename(hook.args[0]) === script && hook.args[1] === '--caronte-session-start';
  const retained = old.map(group => ({ ...group, hooks: group.hooks.filter(hook => !isUpdater(hook)) }))
    .filter((group, index) => group.hooks.length || old[index].hooks.length === 0);
  if (enabled) retained.push({ matcher: '^(startup|resume)$', hooks: [{
    type: 'command', command: 'node', args: [path.join(source, script), '--caronte-session-start'], timeout: 30,
  }] });
  const changed = JSON.stringify(old) !== JSON.stringify(retained);
  if (changed) {
    settings.hooks ??= {};
    if (retained.length) settings.hooks.SessionStart = retained;
    else delete settings.hooks.SessionStart;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWrite(file, JSON.stringify(settings, null, 2) + '\n', fs.statSync(file, { throwIfNoEntry: false })?.mode ?? 0o600);
  }
  return { enabled, changed, settings: file, ...(enabled ? { source } : {}) };
}

if (require.main === module && process.argv[2] === '--caronte-session-start') {
  try {
    const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    if (['startup', 'resume'].includes(event.source)) {
      const revision = updateProject(process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd());
      if (revision) console.log(JSON.stringify({ systemMessage: 'Caronte aggiornato alla revisione ' + revision.slice(0, 12) + '.' }));
    }
  } catch (error) {
    console.log(JSON.stringify({ systemMessage: 'Caronte: aggiornamento rimandato. ' + error.message }));
  }
}

module.exports = { configureAutoUpdate, installFromCheckout };
