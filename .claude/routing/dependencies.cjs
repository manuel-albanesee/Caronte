const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const bundled = require('./ecc/manifest.json');

const repositories = { ecc: 'affaan-m/ECC', rtk: 'rtk-ai/rtk' };
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
  const response = await fetch('https://api.github.com/repos/' + repo + '/' + route, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-routing-kit' },
    redirect: 'error',
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw Error('GitHub HTTP ' + response.status);
  return response.json();
}
async function stableRelease(get, repository) {
  const release = await get(repository, 'releases/latest');
  const tag = version(release.tag_name);
  if (!tag || release.draft || release.prerelease) throw Error('Release stabile non valida.');
  return { tag: release.tag_name, version: tag };
}
async function blob(get, file, commit) {
  const entry = await get(repositories.ecc, 'contents/' + file + '?ref=' + commit);
  if (entry.type !== 'file' || entry.encoding !== 'base64' || typeof entry.content !== 'string' || entry.content.length > 180000) {
    throw Error('File ECC inatteso: ' + file);
  }
  const bytes = Buffer.from(entry.content, 'base64');
  const digest = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  if (digest !== entry.sha) throw Error('Hash Git incoerente: ' + file);
  return bytes;
}
async function updateEcc(dir, get) {
  const current = currentEcc(dir);
  const candidate = await stableRelease(get, repositories.ecc);
  if (!newer(candidate.version, current.version)) return { version: current.version, changed: false };
  if (candidate.version.split('.')[0] !== bundled.version.split('.')[0]) {
    throw Error('ECC ' + candidate.version + ' cambia major. In uso ECC ' + current.version + '.');
  }

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
async function updateRtk(root, get, exec, platform) {
  const current = rtkVersion(exec, root);
  if (!current || exec('rtk', ['gain', '--help'], root).status !== 0) return { version: current, changed: false };
  const candidate = await stableRelease(get, repositories.rtk);
  if (!newer(candidate.version, current)) return { version: current, changed: false };
  if (candidate.version.split('.')[0] !== current.split('.')[0]) {
    throw Error('RTK ' + candidate.version + ' cambia major. In uso RTK ' + current + '.');
  }

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
async function sync(root, { get = api, exec = run, platform = process.platform, cache = cacheDirectory(root) } = {}) {
  const safe = async operation => {
    try { return await operation(); }
    catch (error) { return { changed: false, error: error.message }; }
  };
  const results = {
    ecc: cache ? await safe(() => updateEcc(cache, get)) : { version: bundled.version, changed: false },
    rtk: await safe(() => updateRtk(os.homedir(), get, exec, platform)),
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
module.exports = { sync, profileReference };
