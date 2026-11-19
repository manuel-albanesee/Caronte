const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const releaseAssets = {
  'linux-x64': ['x86_64-unknown-linux-musl', '70fee7b4a548c43dde94c77e2335550981b0bc2fb013691d8c8109b5bd0eda37'],
  'linux-arm64': ['aarch64-unknown-linux-musl', 'f91a06e94e5fad7dfa87946c811a4bcbc500e6da119fd47033f2a8940bf64f93'],
  'darwin-x64': ['x86_64-apple-darwin', '1484ae6fffd0da180d65434eeca32e014a86a6e21dcfc7a0004fe82b7bb0a9b9'],
  'darwin-arm64': ['aarch64-apple-darwin', 'a2c411ffa49a8595b408c151ea47c9a812268924a76eaeecbc3a5065b02207ff'],
};

function installRelease(asset, curl, tar, dir, env, run, live) {
  fs.mkdirSync(dir, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(dir, '.caronte-rtk-'));
  try {
    const [target, digest] = asset;
    const archive = path.join(scratch, 'rtk.tar.gz');
    const download = run(curl, [live ? '-fL' : '-fsSL', ...(live ? ['--progress-bar'] : []), '--proto', '=https', '--max-time', '120', '--output', archive,
      'https://github.com/rtk-ai/rtk/releases/download/v1.2.0/rtk-' + target + '.tar.gz'],
    { env, cwd: scratch, encoding: 'utf8', timeout: 125000, stdio: ['ignore', 'pipe', live ? 2 : 'pipe'] });
    if (download.status !== 0) throw Error(download.error?.message || download.stderr?.trim() || 'download non riuscito');
    if (createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== digest) throw Error('checksum SHA-256 inatteso');
    const unpack = run(tar, ['-xzf', archive, 'rtk'], { env, cwd: scratch, encoding: 'utf8', timeout: 15000 });
    if (unpack.status !== 0) throw Error(unpack.error?.message || unpack.stderr?.trim() || 'estrazione non riuscita');
    const binary = path.join(scratch, 'rtk');
    fs.chmodSync(binary, 0o755);
    try { fs.linkSync(binary, path.join(dir, 'rtk')); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function findExecutable(name, directories, platform) {
  const filename = platform === 'win32' ? name + '.exe' : name;
  for (const directory of directories) {
    const normalized = directory.replace(/^"(.*)"$/, '$1');
    if (!path.isAbsolute(normalized)) continue;
    const candidate = path.join(normalized, filename);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue looking in PATH order.
    }
  }
  return null;
}

function hasBashHook(settings) {
  const groups = settings?.hooks?.PreToolUse;
  if (!Array.isArray(groups)) return false;
  return groups.some(group => {
    try {
      if (group.matcher && !new RegExp(group.matcher).test('Bash')) return false;
    } catch {
      return false;
    }
    return group.hooks?.some?.(hook => {
      if (hook.type !== 'command') return false;
      const command = (hook.command || '').replaceAll('\\', '/');
      if (Array.isArray(hook.args)) {
        return /(?:^|\/)rtk(?:\.exe)?$/i.test(command) &&
          hook.args[0] === 'hook' && hook.args[1] === 'claude';
      }
      return /(?:^|[\s/"'])rtk(?:\.exe)?["']?\s+hook\s+claude(?:\s|$)/i.test(command) ||
        /(?:^|[\s/"'])rtk-rewrite\.sh(?:["'\s]|$)/i.test(command);
    });
  });
}

function readUserSettings(env, home) {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const file = path.join(dir, 'settings.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    return null;
  }
}

function removeStandaloneRtk(settings) {
  const groups = settings.hooks.PreToolUse || [];
  const standalone = hook => hook.type === 'command' && hook.command === 'rtk' &&
    JSON.stringify(hook.args) === '["hook","claude"]' && hook.timeout === 5 &&
    Object.keys(hook).length === 4;
  settings.hooks.PreToolUse = groups.map(group => ({
    ...group,
    hooks: group.matcher === 'Bash' ? group.hooks.filter(hook => !standalone(hook)) : group.hooks,
  })).filter(group => group.hooks.length);
}

function prepareRtk({ dry, settings, project, gateGuard, bundledGateGuard, progress, rtkPath }, {
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  home = os.homedir(),
  run = spawnSync,
  lookup = findExecutable,
  userSettings = readUserSettings(env, home),
} = {}) {
  const groups = settings.hooks?.PreToolUse || [];
  const coordinator = groups.flatMap(group => group.hooks).find(hook =>
    hook.args?.[0] === '${CLAUDE_PROJECT_DIR}/.claude/hooks/gateguard-rtk.cjs');
  const savedGate = coordinator?.args[1];
  const wasBundled = /[\/]\.claude[\/]skills[\/]ecc[\/]scripts[\/]hooks[\/]gateguard-fact-force\.js$/i
    .test(savedGate?.replaceAll('\\', '/') ?? '');
  gateGuard ??= env.CARONTE_ECC_GATEGUARD || (wasBundled ? bundledGateGuard : savedGate) || bundledGateGuard;
  removeStandaloneRtk(settings);
  if ([project, userSettings, settings].some(hasBashHook)) {
    throw Error('Sequenza GateGuard → RTK impossibile: controlla gli hook RTK autonomi nei settings utente e di progetto.');
  }
  if (userSettings === null) {
    throw Error('Impossibile verificare la presenza di hook RTK autonomi nei settings utente.');
  }
  if (!gateGuard) return { hook: 'disabled', reason: 'GateGuard ECC non configurato' };

  const gateStat = fs.statSync(gateGuard, { throwIfNoEntry: false });
  if (path.basename(gateGuard) !== 'gateguard-fact-force.js' ||
      (gateStat ? !gateStat.isFile() : gateGuard !== bundledGateGuard)) {
    throw Error('Indica il file ECC scripts/hooks/gateguard-fact-force.js.');
  }
  if (gateStat) gateGuard = fs.realpathSync(gateGuard);

  const directories = (env.PATH || '').split(path.delimiter);
  const extraDirectories = [
    path.join(home, '.local', 'bin'),
    path.join(env.CARGO_HOME || path.join(home, '.cargo'), 'bin'),
  ];
  if (platform === 'win32') {
    extraDirectories.push(path.join(env.SCOOP || path.join(home, 'scoop'), 'apps', 'rtk', 'current'));
    if (env.LOCALAPPDATA) {
      const wingetRoot = path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet');
      extraDirectories.push(path.join(wingetRoot, 'Links'));
      const packages = path.join(wingetRoot, 'Packages');
      try {
        for (const entry of fs.readdirSync(packages)) {
          if (/^rtk-ai\.rtk_/i.test(entry)) extraDirectories.push(path.join(packages, entry));
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
      }
    }
  }
  const findOnPath = name => lookup(name, directories, platform);
  const execute = (command, args, timeout, live = false) => run(command, args, {
    cwd: home,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
    stdio: live ? ['ignore', 2, 2] : 'pipe',
  });

  function findRtk() {
    const candidates = new Set([...directories, ...extraDirectories].map(directory => lookup('rtk', [directory], platform)).filter(Boolean));
    for (const candidate of candidates) {
      const checked = execute(candidate, ['--version'], 5000);
      if (checked.status === 0 && /^rtk\s+v?\d+/i.test(checked.stdout?.trim() ?? '')) return candidate;
    }
    return candidates.values().next().value;
  }

  const winget = platform === 'win32' && findOnPath('winget');
  const brew = ['darwin', 'linux'].includes(platform) && findOnPath('brew');
  const cargo = ['darwin', 'linux'].includes(platform) && findOnPath('cargo');
  const installer = winget
    ? { command: winget, name: 'WinGet', args: ['install', '--id', 'rtk-ai.rtk', '--exact', '--source', 'winget', '--scope', 'user', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'] }
    : brew
      ? { command: brew, name: 'Homebrew', args: ['install', 'rtk'] }
      : cargo
        ? { command: cargo, name: 'Cargo', args: ['install', '--locked', '--git', 'https://github.com/rtk-ai/rtk', '--tag', 'v1.2.0', 'rtk'] }
        : null;

  let executable = rtkPath || findRtk();
  let binary = 'existing';
  let packageManager = installer?.name;
  if (!executable) {
    const curl = !installer && findOnPath('curl');
    const tar = !installer && findOnPath('tar');
    const asset = releaseAssets[platform + '-' + arch];
    const release = curl && tar && asset;
    if (!installer && !release) return {
      binary: 'missing',
      hook: 'unavailable',
      error: platform === 'win32' ? 'WinGet non trovato. Serve App Installer con winget.exe disponibile.' :
        'Per installare automaticamente RTK serve Homebrew, Cargo oppure curl e tar su una piattaforma supportata.',
    };
    packageManager ??= 'GitHub Releases';
    if (dry) return { binary: 'missing', packageManager, hook: 'planned' };
    progress?.('RTK: installazione tramite ' + packageManager + '.', undefined, 'RTK', 25);
    let result;
    if (installer) result = execute(installer.command, installer.args, 600000, progress?.interactive);
    else {
      try {
        installRelease(asset, curl, tar, path.join(home, '.local', 'bin'), env, run, progress?.interactive);
        result = { status: 0 };
      } catch (error) {
        return { binary: 'missing', packageManager, hook: 'unavailable', error: 'Installazione RTK fallita: ' + error.message };
      }
    }
    executable = findRtk();
    if (!executable) return {
      binary: result.status === 0 ? 'restart-or-path-required' : 'missing',
      packageManager,
      hook: 'unavailable',
      error: result.status === 0
        ? 'Il gestore ha completato l’installazione ma rtk non è ancora raggiungibile. Riapri il terminale e rilancia l’installer.'
        : 'Installazione RTK fallita (' + (result.error?.code || result.status || 'errore sconosciuto') + '). Controlla il gestore indicato e riprova.',
    };
    binary = 'installed';
  }

  progress?.('RTK: verifico il binario e il supporto per Claude Code.', undefined, 'RTK', 75);
  const version = execute(executable, ['--version'], 5000);
  const gain = execute(executable, ['gain', '--help'], 5000);
  if (version.status !== 0 || !/^rtk\s+v?\d+/i.test(version.stdout?.trim() ?? '') || gain.status !== 0) return {
    binary: 'unrecognized',
    hook: 'unavailable',
    error: 'Il binario RTK non risponde (' + executable + '): ' + (version.error?.message || gain.error?.message || 'verifica --version e gain --help'),
  };

  const status = {
    binary, executable,
    version: version.stdout.trim(),
    ...(binary === 'installed' ? { packageManager } : {}),
  };
  const onPath = findOnPath('rtk');
  if (onPath !== executable) {
    status.pathNote = 'Usa caronte start per includere il binario RTK selezionato nel PATH della sessione Claude Code.';
  }

  const native = execute(executable, ['hook', 'claude', '--help'], 5000);
  if (native.status !== 0) return {
    ...status, hook: 'unavailable',
    error: 'RTK è presente ma manca il suo hook nativo per Claude Code. Aggiorna RTK con il gestore con cui lo hai installato.',
  };
  progress?.('RTK ' + status.version.replace(/^rtk\s+/i, '') + (binary === 'existing' ? ': binario già disponibile.' : ': installato.'), undefined, 'RTK', 100);

  const args = ['${CLAUDE_PROJECT_DIR}/.claude/hooks/gateguard-rtk.cjs', gateGuard, executable];
  if (coordinator && JSON.stringify(coordinator.args) === JSON.stringify(args)) {
    return { ...status, hook: 'reused', ordered: true };
  }
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.map(group => ({
    ...group, hooks: group.hooks.filter(hook => hook !== coordinator),
  })).filter(group => group.hooks.length);
  return {
    ...status, hook: dry ? 'planned' : 'configured', ordered: true,
    entry: {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'node', args, timeout: 20, onFailure: 'block' }],
    },
  };
}

module.exports = { prepareRtk, removeStandaloneRtk };
