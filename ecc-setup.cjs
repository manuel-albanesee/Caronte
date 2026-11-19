const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planRepository } = require('./repository-setup.cjs');

const location = '.claude/skills/ecc';
const gateFile = 'scripts/hooks/gateguard-fact-force.js';
const plugin = 'ecc@skills-dir';
const spec = {
  name: 'ECC', location,
  repository: 'https://github.com/affaan-m/ECC.git',
  release: 'v2.2.3',
  revision: 'c05b2d6614f62f6db0047669aa4eefb223d478f9',
  validate(folder) {
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, '.claude-plugin/plugin.json'), 'utf8'));
    return manifest.name === 'ecc' && fs.statSync(path.join(folder, gateFile), { throwIfNoEntry: false })?.isFile();
  },
};

function enabledPlugin(configDir, settings, project) {
  const userFile = path.join(configDir, 'settings.json');
  let user = {};
  if (fs.existsSync(userFile)) user = JSON.parse(fs.readFileSync(userFile, 'utf8').replace(/^\uFEFF/, ''));
  return Object.entries({ ...user?.enabledPlugins, ...project.enabledPlugins, ...settings.enabledPlugins })
    .find(([id, enabled]) => /^ecc@/.test(id) && id !== plugin && enabled === true)?.[0] ?? plugin;
}

function registeredEcc(configDir, root, active) {
  if (active === plugin) return null;
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8').replace(/^\uFEFF/, ''));
    const entries = registry.plugins?.[active];
    if (!Array.isArray(entries)) return null;
    for (const scope of ['local', 'project', 'user']) {
      for (const entry of entries) {
        if (entry?.scope !== scope || typeof entry.installPath !== 'string' || !path.isAbsolute(entry.installPath)) continue;
        try {
          if (scope !== 'user' && (typeof entry.projectPath !== 'string' || fs.realpathSync(entry.projectPath) !== root)) continue;
          if (spec.validate(entry.installPath)) return fs.realpathSync(entry.installPath);
        } catch {
          // Claude Code's registry can retain paths from removed checkouts.
        }
      }
    }
  } catch {
    // A missing or unreadable registry leaves the project checkout available.
  }
  return null;
}

function planEcc(root, settings, project, explicitPath) {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const active = enabledPlugin(configDir, settings, project);
  const existingPath = explicitPath || registeredEcc(configDir, root, active);
  if (existingPath) {
    if (active === plugin) throw Error('Per usare --ecc-path, abilita prima il plugin ECC esterno in Claude Code.');
    if (explicitPath && !spec.validate(explicitPath)) throw Error('Copia ECC priva di manifest o GateGuard: ' + explicitPath);
    settings.enabledPlugins = { ...settings.enabledPlugins, [plugin]: false };
    return {
      gateGuard: path.join(existingPath, gateFile),
      report: { status: 'external', path: existingPath, plugin: active },
    };
  }
  const plan = planRepository(root, spec);
  settings.enabledPlugins = { ...settings.enabledPlugins, [plugin]: active === plugin };
  return { ...plan, gateGuard: path.join(plan.folder, gateFile), report: { ...plan.report, plugin: active } };
}

module.exports = { location, planEcc };
