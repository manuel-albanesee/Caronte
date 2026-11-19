const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { filePath } = require('./.claude/routing/icm.cjs');

function git(cwd, args, timeout = 5000) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  env.GIT_TERMINAL_PROMPT = '0';
  return spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout });
}

function inspect(folder, spec) {
  const metadata = fs.lstatSync(path.join(folder, '.git'), { throwIfNoEntry: false });
  const head = git(folder, ['rev-parse', '--verify', 'HEAD']);
  const origin = git(folder, ['config', '--local', '--get', 'remote.origin.url']);
  const normalized = url => url.trim().replace(/^git@github\.com:/i, 'https://github.com/').replace(/\.git$/i, '').toLowerCase();
  if (!metadata?.isDirectory() || head.status !== 0 || !/^[a-f0-9]{40}$/.test(head.stdout.trim()) ||
      origin.status !== 0 || normalized(origin.stdout) !== normalized(spec.repository) || !spec.validate(folder)) {
    throw Error('Checkout ' + spec.name + ' non riconosciuto: ' + folder);
  }
  return head.stdout.trim();
}

function planRepository(root, spec) {
  const folder = filePath(root, spec.location);
  const entry = fs.lstatSync(folder, { throwIfNoEntry: false });
  if (entry && !entry.isDirectory()) throw Error('Percorso ' + spec.name + ' occupato: ' + spec.location);
  const installed = entry ? inspect(folder, spec) : null;
  const top = git(root, ['rev-parse', '--show-toplevel']);
  let exclude = null;
  if (top.status === 0 && fs.realpathSync(top.stdout.trim()) === root &&
      git(root, ['check-ignore', '--quiet', '--', spec.location + '/']).status === 1) {
    const resolved = git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']);
    if (resolved.status !== 0) throw Error('Impossibile individuare le esclusioni Git del progetto.');
    exclude = resolved.stdout.trim();
  }
  return {
    spec, folder, exclude,
    report: { status: installed ? 'present' : 'planned', path: spec.location, revision: installed ?? spec.revision },
  };
}

function applyRepositories(root, plans, atomicWrite) {
  const pending = plans.filter(plan => plan.report.status === 'planned');
  const parent = filePath(root, '.claude-routing-backups');
  const staging = pending.length ? fs.mkdtempSync(path.join(parent, 'repositories-')) : null;
  const moved = [];
  try {
    const checkouts = pending.map((plan, index) => {
      const { spec } = plan;
      const checkout = path.join(staging, String(index));
      const platformOptions = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];
      const result = git(root, ['-c', 'advice.detachedHead=false', 'clone', '--quiet', ...platformOptions,
        '--depth=1', '--branch', spec.release, '--', spec.repository, checkout], 180000);
      if (result.status !== 0) throw Error('Download ' + spec.name + ' non riuscito: ' + (result.error?.message || result.stderr?.trim()));
      if (inspect(checkout, spec) !== spec.revision) throw Error('Revisione inattesa per la release ' + spec.name + '.');
      return { plan, checkout };
    });
    for (const { plan, checkout } of checkouts) {
      fs.mkdirSync(path.dirname(plan.folder), { recursive: true });
      fs.renameSync(checkout, plan.folder);
      moved.push(plan);
    }
    const exclusions = new Map();
    for (const plan of plans) {
      if (!plan.exclude) continue;
      const entries = exclusions.get(plan.exclude) ?? [];
      entries.push('/' + plan.spec.location + '/');
      exclusions.set(plan.exclude, entries);
    }
    for (const [file, entries] of exclusions) ignoreCheckouts(file, entries, atomicWrite);
    for (const plan of moved) plan.report.status = 'installed';
  } catch (error) {
    for (const plan of moved.reverse()) fs.rmSync(plan.folder, { recursive: true, force: true });
    throw error;
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
  }
}

function ignoreCheckouts(file, entries, atomicWrite) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && !stat.isFile()) throw Error('File delle esclusioni Git non regolare: ' + file);
  const previous = stat ? fs.readFileSync(file, 'utf8') : '';
  const missing = entries.filter(entry => !previous.split(/\r?\n/).includes(entry));
  if (missing.length) atomicWrite(file, previous + (previous && !previous.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n', stat?.mode);
}

module.exports = { planRepository, applyRepositories };
