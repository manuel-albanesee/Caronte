const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

function prepareRtk({ dry, settings, project }, {
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  run = spawnSync,
  lookup = findExecutable,
  userSettings = readUserSettings(env, home),
} = {}) {
  const directories = (env.PATH || '').split(path.delimiter);
  const extraDirectories = platform === 'win32'
    ? (env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')] : [])
    : [path.join(env.CARGO_HOME || path.join(home, '.cargo'), 'bin'), path.join(home, '.local', 'bin')];
  const findOnPath = name => lookup(name, directories, platform);
  const findRtk = () => findOnPath('rtk') || lookup('rtk', extraDirectories, platform);
  const execute = (command, args, timeout) => run(command, args, {
    cwd: home,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
  });

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

  let executable = findRtk();
  let binary = 'existing';
  if (!executable) {
    if (!installer) return {
      binary: 'missing',
      hook: 'unavailable',
      error: platform === 'win32' ? 'WinGet non trovato. Serve App Installer con winget.exe disponibile.' : 'Per installare automaticamente RTK serve Homebrew o Cargo.',
    };
    if (dry) return { binary: 'missing', packageManager: installer.name, hook: 'planned' };
    const result = execute(installer.command, installer.args, 600000);
    executable = findRtk();
    if (!executable) return {
      binary: result.status === 0 ? 'restart-or-path-required' : 'missing',
      packageManager: installer.name,
      hook: 'unavailable',
      error: result.status === 0
        ? 'Il gestore ha completato l’installazione ma rtk non è ancora raggiungibile. Riapri il terminale e rilancia l’installer.'
        : 'Installazione RTK fallita (' + (result.error?.code || result.status || 'errore sconosciuto') + '). Controlla il gestore indicato e riprova.',
    };
    binary = 'installed';
  }

  const version = execute(executable, ['--version'], 5000);
  const gain = execute(executable, ['gain', '--help'], 5000);
  if (version.status !== 0 || gain.status !== 0) return {
    binary: 'unrecognized',
    hook: 'unavailable',
    error: 'È presente un eseguibile rtk che non risponde come RTK (Rust Token Killer). Controlla il PATH.',
  };

  const status = {
    binary,
    version: version.stdout.trim(),
    ...(binary === 'installed' ? { packageManager: installer.name } : {}),
  };
  if (!findOnPath('rtk')) status.pathNote = 'Apri un terminale nuovo e verifica che rtk --version funzioni. Il comando riscritto richiede rtk nel PATH.';
  if ([settings, project, userSettings].some(hasBashHook)) return { ...status, hook: 'reused' };

  const native = execute(executable, ['hook', 'claude', '--help'], 5000);
  if (native.status !== 0) return {
    ...status, hook: 'unavailable',
    error: 'RTK è presente ma manca il suo hook nativo per Claude Code. Aggiorna RTK con il gestore con cui lo hai installato.',
  };

  if (userSettings === null) status.settingsNote = 'Impossibile ispezionare i settings utente per riconoscere eventuali hook RTK.';
  return {
    ...status,
    hook: dry ? 'planned' : 'configured',
    entry: {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'rtk', args: ['hook', 'claude'], timeout: 5 }],
    },
  };
}

module.exports = { prepareRtk };
