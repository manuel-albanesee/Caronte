const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { filePath } = require('./.claude/routing/icm.cjs');

const repository = 'https://github.com/affaan-m/ECC.git';
const release = 'v2.2.3';
const revision = 'c05b2d6614f62f6db0047669aa4eefb223d478f9';
const location = '.claude/skills/ecc';
const plugin = 'ecc@skills-dir';

function git(cwd, args, timeout = 5000) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  env.GIT_TERMINAL_PROMPT = '0';
  return spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout });
}

function inspect(folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, '.claude-plugin/plugin.json'), 'utf8'));
  const head = git(folder, ['rev-parse', '--verify', 'HEAD']);
  const origin = git(folder, ['config', '--local', '--get', 'remote.origin.url']);
  const metadata = fs.lstatSync(path.join(folder, '.git'), { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || head.status !== 0 || !/^[a-f0-9]{40}$/.test(head.stdout.trim()) ||
      origin.status !== 0 || !/^(?:https:\/\/github\.com\/|git@github\.com:)affaan-m\/ecc(?:\.git)?$/i.test(origin.stdout.trim()) ||
      manifest.name !== 'ecc') throw Error('Checkout ECC non riconosciuto: ' + folder);
  return head.stdout.trim();
}

function enabledPlugin(settings, project) {
  const userFile = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
  let user = {};
  if (fs.existsSync(userFile)) user = JSON.parse(fs.readFileSync(userFile, 'utf8').replace(/^\uFEFF/, ''));
  return Object.entries({ ...user?.enabledPlugins, ...project.enabledPlugins, ...settings.enabledPlugins })
    .find(([id, enabled]) => /^ecc@/.test(id) && id !== plugin && enabled === true)?.[0] ?? plugin;
}

function planEcc(root, settings, project) {
  const folder = filePath(root, location);
  const entry = fs.lstatSync(folder, { throwIfNoEntry: false });
  if (entry && !entry.isDirectory()) throw Error('Percorso ECC occupato: ' + location);
  const active = enabledPlugin(settings, project);
  settings.enabledPlugins = { ...settings.enabledPlugins, [plugin]: active === plugin };
  const installed = entry ? inspect(folder) : null;
  const top = git(root, ['rev-parse', '--show-toplevel']);
  let exclude = null;
  if (top.status === 0 && fs.realpathSync(top.stdout.trim()) === root &&
      git(root, ['check-ignore', '--quiet', '--', location + '/']).status === 1) {
    const resolved = git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']);
    if (resolved.status !== 0) throw Error('Impossibile individuare le esclusioni Git del progetto.');
    exclude = resolved.stdout.trim();
  }
  return {
    folder, exclude,
    report: { status: installed ? 'present' : 'planned', path: location, plugin: active, revision: installed ?? revision },
  };
}

function applyEcc(root, plan, atomicWrite) {
  const folder = plan.folder;
  if (plan.report.status === 'present') {
    ignoreCheckout(plan.exclude, atomicWrite);
    return;
  }
  const parent = filePath(root, '.claude-routing-backups');
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, 'ecc-'));
  try {
    const checkout = path.join(staging, 'checkout');
    const platformOptions = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];
    const result = git(root, ['clone', '--quiet', ...platformOptions,
      '--depth=1', '--branch', release, '--', repository, checkout], 180000);
    if (result.status !== 0) throw Error('Download ECC non riuscito: ' + (result.error?.message || result.stderr?.trim()));
    if (inspect(checkout) !== revision) throw Error('La revisione della release ECC è diversa da quella attesa.');
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    ignoreCheckout(plan.exclude, atomicWrite);
    fs.renameSync(checkout, folder);
    plan.report.status = 'installed';
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function ignoreCheckout(file, atomicWrite) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = '/' + location + '/';
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && !stat.isFile()) throw Error('File delle esclusioni Git non regolare: ' + file);
  const previous = stat ? fs.readFileSync(file, 'utf8') : '';
  if (previous.split(/\r?\n/).includes(entry)) return;
  atomicWrite(file, previous + (previous && !previous.endsWith('\n') ? '\n' : '') + entry + '\n', stat?.mode);
}

module.exports = { location, planEcc, applyEcc };
