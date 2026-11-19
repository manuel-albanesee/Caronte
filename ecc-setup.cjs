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

function enabledPlugin(settings, project) {
  const userFile = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
  let user = {};
  if (fs.existsSync(userFile)) user = JSON.parse(fs.readFileSync(userFile, 'utf8').replace(/^\uFEFF/, ''));
  return Object.entries({ ...user?.enabledPlugins, ...project.enabledPlugins, ...settings.enabledPlugins })
    .find(([id, enabled]) => /^ecc@/.test(id) && id !== plugin && enabled === true)?.[0] ?? plugin;
}

function planEcc(root, settings, project, explicitPath) {
  const active = enabledPlugin(settings, project);
  if (explicitPath) {
    if (active === plugin) throw Error('Per usare --ecc-path, abilita prima il plugin ECC esterno in Claude Code.');
    if (!spec.validate(explicitPath)) throw Error('Copia ECC priva di manifest o GateGuard: ' + explicitPath);
    settings.enabledPlugins = { ...settings.enabledPlugins, [plugin]: false };
    return {
      gateGuard: path.join(explicitPath, gateFile),
      report: { status: 'external', path: explicitPath, plugin: active },
    };
  }
  const plan = planRepository(root, spec);
  settings.enabledPlugins = { ...settings.enabledPlugins, [plugin]: active === plugin };
  return { ...plan, gateGuard: path.join(plan.folder, gateFile), report: { ...plan.report, plugin: active } };
}

module.exports = { location, planEcc };
