const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const bundled = require('./ecc/manifest.json');

const { fsrPython } = require('./fsr-index.cjs');

const repositories = {
  ecc: 'affaan-m/ECC', rtk: 'rtk-ai/rtk',
  fsr: 'manuel-albanesee/FastSkillRetrieval', headroom: 'headroomlabs-ai/headroom',
};
// Componenti che la SessionStart aggiorna da sola. FastSkillRetrieval (pip da Git, minuti) e Headroom
// (eseguibile in uso durante caronte start) sono solo segnalati e si aggiornano con caronte update.
const sessionApply = ['ecc', 'rtk'];
const headroomVenv = require('./caronte-home.cjs').relative.headroom + '/.venv';
const fsrVerify = 'import fastskillretrieval.agent_index, fastskillretrieval.install_agent';
const headroomRuntime = 'import importlib.metadata as m\nm.version("fastapi")\nm.version("uvicorn")\nprint(m.version("headroom-ai"))';
const sha = /^[0-9a-f]{40}$/;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function version(value) {
  return typeof value === 'string' && /^v?\d+\.\d+\.\d+$/.test(value) ? value.replace(/^v/, '') : null;
}
function newer(candidate, current) {
  const left = candidate.split('.').map(Number), right = current.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}
function run(command, args, cwd, timeout = 4000) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
}
function cacheDirectory(root) {
  const git = run('git', ['rev-parse', '--absolute-git-dir'], root);
  return git.status === 0 ? path.join(git.stdout.trim(), 'claude-routing-deps') : null;
}
function currentFile(dir) { return path.join(dir, 'ecc-current.json'); }
function currentEcc(dir) {
  try {
    const current = read(currentFile(dir));
    if (version(current.version) === current.version && sha.test(current.commit)
        && newer(current.version, bundled.version)) return current;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return bundled;
}
async function api(repo, route) {
  const response = await fetch('https://api.github.com/repos/' + repo + (route ? '/' + route : ''), {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-routing-kit' },
    redirect: 'error',
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw Object.assign(Error('GitHub HTTP ' + response.status), { status: response.status });
  return response.json();
}
async function stableRelease(get, repository) {
  const release = await get(repository, 'releases/latest');
  const tag = version(release.tag_name);
  if (!tag || release.draft || release.prerelease) throw Error('Release stabile non valida.');
  return { tag: release.tag_name, version: tag };
}
async function blob(get, file, commit, repo = repositories.ecc) {
  const entry = await get(repo, 'contents/' + file + '?ref=' + commit);
  if (entry.type !== 'file' || entry.encoding !== 'base64' || typeof entry.content !== 'string' || entry.content.length > 180000) {
    throw Error('File inatteso in ' + repo + ': ' + file);
  }
  const bytes = Buffer.from(entry.content, 'base64');
  const digest = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  if (digest !== entry.sha) throw Error('Hash Git incoerente: ' + file);
  return bytes;
}
async function updateEcc(dir, get, apply = true) {
  const current = currentEcc(dir);
  const candidate = await stableRelease(get, repositories.ecc);
  if (!newer(candidate.version, current.version)) return { version: current.version, changed: false };
  if (candidate.version.split('.')[0] !== bundled.version.split('.')[0]) {
    throw Error('ECC ' + candidate.version + ' cambia major. In uso ECC ' + current.version + '.');
  }
  if (!apply) return { version: current.version, changed: false, pending: candidate.version };

  const commit = (await get(repositories.ecc, 'commits/' + candidate.tag)).sha;
  if (!sha.test(commit || '')) throw Error('Commit ECC non valido.');
  const profiles = Object.entries(bundled.profiles);
  const [plugin, license, ...sources] = await Promise.all([
    blob(get, '.claude-plugin/plugin.json', commit),
    blob(get, 'LICENSE', commit),
    ...profiles.map(([, entry]) => blob(get, entry.path, commit)),
  ]);
  const pluginData = JSON.parse(plugin.toString('utf8'));
  if (pluginData.name !== 'ecc' || pluginData.version !== candidate.version || pluginData.license !== 'MIT' ||
      !license.toString('utf8').startsWith('MIT License')) throw Error('Manifest o licenza ECC incompatibili.');
  for (const [index, [name]] of profiles.entries()) {
    const match = sources[index].toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match || !match[1].split(/\r?\n/).some(line => line.trim() === 'name: ' + name) || !match[2].trim()) {
      throw Error('Profilo ECC incompatibile: ' + name);
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(dir, 'ecc-stage-'));
  try {
    fs.writeFileSync(path.join(tmp, 'LICENSE'), license);
    profiles.forEach(([name], index) => fs.writeFileSync(path.join(tmp, name + '.md'), sources[index]));
    const destination = path.join(dir, 'ecc-' + commit);
    if (!fs.existsSync(destination)) fs.renameSync(tmp, destination);
    const next = path.join(dir, 'ecc-' + crypto.randomUUID() + '.json');
    fs.writeFileSync(next, JSON.stringify({ version: candidate.version, commit }) + '\n');
    fs.renameSync(next, currentFile(dir));
    return { version: candidate.version, changed: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function rtkVersion(exec, root) {
  const result = exec('rtk', ['--version'], root);
  return result.status === 0 ? version(result.stdout.trim().match(/^rtk\s+(v?\d+\.\d+\.\d+)\b/i)?.[1]) : null;
}
async function updateRtk(root, get, exec, platform, apply = true) {
  const current = rtkVersion(exec, root);
  if (!current || exec('rtk', ['gain', '--help'], root).status !== 0) return { version: current, changed: false };
  const candidate = await stableRelease(get, repositories.rtk);
  if (!newer(candidate.version, current)) return { version: current, changed: false };
  if (candidate.version.split('.')[0] !== current.split('.')[0]) {
    throw Error('RTK ' + candidate.version + ' cambia major. In uso RTK ' + current + '.');
  }
  if (!apply) return { version: current, changed: false, pending: candidate.version };

  let result;
  if (platform === 'win32') {
    result = exec('winget', ['upgrade', '--id', 'rtk-ai.rtk', '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], root, 80000);
  } else if (['darwin', 'linux'].includes(platform)) {
    if (exec('brew', ['list', '--versions', 'rtk'], root).status === 0) {
      result = exec('brew', ['upgrade', 'rtk'], root, 80000);
    } else {
      const list = exec('cargo', ['install', '--list'], root);
      if (list.status === 0 && /^rtk v[^\n]*https:\/\/github\.com\/rtk-ai\/rtk\b/im.test(list.stdout)) {
        result = exec('cargo', ['install', '--locked', '--git', 'https://github.com/rtk-ai/rtk', '--tag', candidate.tag, 'rtk'], root, 80000);
      }
    }
  }
  const installed = rtkVersion(exec, root) || current;
  if (!newer(installed, current)) {
    return { version: current, changed: false, pending: candidate.version, managerStatus: result?.status ?? null };
  }
  return { version: installed, changed: true };
}
function pipFailure(result) {
  const lines = String(result.stderr || result.error?.message || '').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-2).join(' ').slice(0, 400) || 'codice ' + result.status;
}
// FastSkillRetrieval non pubblica release: senza una release stabile segue il ramo predefinito del repository ufficiale,
// solo in avanti rispetto alla revisione installata e senza cambio di major.
async function fsrCandidate(get) {
  try {
    const release = await stableRelease(get, repositories.fsr);
    return { ref: release.tag, commit: (await get(repositories.fsr, 'commits/' + release.tag)).sha };
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const branch = (await get(repositories.fsr, '')).default_branch;
  if (typeof branch !== 'string' || !branch) throw Error('Ramo predefinito di FastSkillRetrieval non valido.');
  return { ref: branch, commit: (await get(repositories.fsr, 'commits/' + branch)).sha };
}
async function updateFsr(env, get, exec, apply, root) {
  const python = fsrPython(env, process.platform, root);
  if (!fs.existsSync(python)) return { version: null, changed: false };
  const marker = path.join(path.dirname(path.dirname(python)), 'caronte-fsr-revision');
  let installed = null;
  try { installed = fs.readFileSync(marker, 'utf8').trim(); } catch { /* installazione senza marker */ }
  const home = os.homedir();
  const versionOf = () => {
    const result = exec(python, ['-I', '-c', 'import importlib.metadata as m; print(m.version("fastskillretrieval"))'], home, 15000);
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const current = versionOf();
  if (!current) throw Error('FastSkillRetrieval installato ma non leggibile.');
  const state = { version: current, revision: sha.test(installed || '') ? installed : null, changed: false };
  const candidate = await fsrCandidate(get);
  if (!sha.test(candidate.commit || '')) throw Error('Commit FastSkillRetrieval non valido.');
  if (candidate.commit === state.revision) return state;
  if (state.revision) {
    const comparison = (await get(repositories.fsr, 'compare/' + state.revision + '...' + candidate.commit)).status;
    if (comparison === 'behind' || comparison === 'identical') return state;
    if (comparison !== 'ahead') throw Error('La revisione installata di FastSkillRetrieval non precede ' + candidate.ref + '.');
  }
  const project = (await blob(get, 'pyproject.toml', candidate.commit, repositories.fsr)).toString('utf8');
  const next = project.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!/^name\s*=\s*"fastskillretrieval"/m.test(project) || !next) throw Error('pyproject di FastSkillRetrieval inatteso.');
  if (next.split('.')[0] !== current.split('.')[0]) throw Error('FastSkillRetrieval ' + next + ' cambia major. In uso ' + current + '.');
  const pending = next + ' (' + candidate.commit.slice(0, 12) + ')';
  if (!apply) return { ...state, pending };
  const url = 'git+https://github.com/' + repositories.fsr + '.git@' + candidate.commit;
  const pip = args => exec(python, ['-I', '-m', 'pip', '--disable-pip-version-check', 'install', '--no-input', ...args, url], home, 600000);
  const verify = () => exec(python, ['-I', '-c', fsrVerify], home, 15000).status === 0;
  // Stessa versione dichiarata con codice nuovo: reinstalla il pacchetto, poi completa le dipendenze solo se servono.
  let result = pip(['--upgrade', '--force-reinstall', '--no-deps']);
  if (result.status === 0 && !verify()) result = pip([]);
  if (result.status !== 0 || !verify()) return { ...state, pending, error: 'Installazione FastSkillRetrieval fallita: ' + pipFailure(result) };
  fs.writeFileSync(marker, candidate.commit + '\n');
  return { version: versionOf() || next, revision: candidate.commit, changed: true };
}
// Aggiorna solo il runtime Headroom installato dal kit nel progetto; una CLI esterna (PATH, uv) resta al suo gestore.
async function updateHeadroom(root, get, exec, platform, apply) {
  const bin = path.join(root, headroomVenv, platform === 'win32' ? 'Scripts' : 'bin');
  const python = path.join(bin, platform === 'win32' ? 'python.exe' : 'python');
  if (!fs.existsSync(python)) return { version: null, changed: false };
  const versionOf = () => {
    const result = exec(python, ['-I', '-B', '-c', headroomRuntime], root, 15000);
    return result.status === 0 ? version(result.stdout.trim()) : null;
  };
  const current = versionOf();
  if (!current) throw Error('Runtime Headroom del progetto incompleto o con versione non riconosciuta.');
  const candidate = await stableRelease(get, repositories.headroom);
  if (!newer(candidate.version, current)) return { version: current, changed: false };
  if (candidate.version.split('.')[0] !== current.split('.')[0]) {
    throw Error('Headroom ' + candidate.version + ' cambia major. In uso Headroom ' + current + '.');
  }
  if (!apply) return { version: current, changed: false, pending: candidate.version };
  const result = exec(python, ['-I', '-m', 'pip', '--disable-pip-version-check', 'install', '--no-input',
    '--only-binary=headroom-ai', 'headroom-ai[proxy]==' + candidate.version], root, 600000);
  const installed = versionOf();
  const command = path.join(bin, platform === 'win32' ? 'headroom.exe' : 'headroom');
  if (result.status !== 0 || installed !== candidate.version || exec(command, ['--version'], root, 15000).status !== 0) {
    return { version: installed || current, changed: false, pending: candidate.version,
      error: 'Installazione Headroom ' + candidate.version + ' fallita: ' + pipFailure(result) + ' Chiudi le sessioni avviate con caronte start e riprova.' };
  }
  return { version: installed, changed: true };
}
async function sync(root, {
  get = api, exec = run, platform = process.platform, cache = cacheDirectory(root), env = process.env, apply = sessionApply,
} = {}) {
  const safe = async operation => {
    try { return await operation(); }
    catch (error) { return { changed: false, error: error.message }; }
  };
  const results = {
    ecc: cache ? await safe(() => updateEcc(cache, get, apply.includes('ecc'))) : { version: bundled.version, changed: false },
    rtk: await safe(() => updateRtk(os.homedir(), get, exec, platform, apply.includes('rtk'))),
    fsr: await safe(() => updateFsr(env, get, exec, apply.includes('fsr'), root)),
    headroom: await safe(() => updateHeadroom(root, get, exec, platform, apply.includes('headroom'))),
  };
  if (cache) {
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'status.json'), JSON.stringify({ checkedAt: new Date().toISOString(), ...results }, null, 2) + '\n');
  }
  return results;
}
function profileReference(root, type) {
  const name = typeof type === 'string' && type.startsWith('ecc-') ? type.slice(4) : '';
  if (!Object.hasOwn(bundled.profiles, name)) return null;
  try {
    const cache = cacheDirectory(root);
    if (cache) {
      const active = currentEcc(cache);
      const file = path.join(cache, 'ecc-' + active.commit, name + '.md');
      if (active !== bundled && fs.existsSync(file)) return file;
    }
  } catch {
    // The embedded reference stays available if the cache cannot be read.
  }
  return '.claude/routing/ecc/upstream/' + name + '.md';
}
if (require.main === module) {
  sync(process.env.CLAUDE_PROJECT_DIR || process.cwd())
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { sync, profileReference, sessionApply };
