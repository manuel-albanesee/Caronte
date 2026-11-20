const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { install, installationFile } = require('../install.cjs');

const kit = path.resolve(__dirname, '..');
const preUpdate = 'd78360d77b823e751dc6af36ddf58a8637e54921';
const historyAvailable = spawnSync('git', ['-C', kit, 'cat-file', '-e', preUpdate + '^{commit}']).status === 0;
const needsHistory = { skip: historyAvailable ? false : 'The legacy revision is unavailable in this checkout.' };
const agent = '.claude/agents/ricerca-haiku.md';
const local = '.claude/settings.local.json';

function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 15000, ...options });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
const git = (cwd, ...args) => run('git', ['-C', cwd, ...args]);
const node = (args, options) => run(process.execPath, args, options);
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
function write(root, file, content) {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte upgrades '));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const remote = path.join(base, 'remote');
  const source = path.join(base, 'Caronte clone');
  const config = path.join(base, 'Claude settings');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
  git(kit, 'clone', '-q', '--no-hardlinks', kit, remote);
  git(remote, 'checkout', '-q', '-B', 'main', preUpdate);
  git(remote, 'config', 'user.name', 'Test');
  git(remote, 'config', 'user.email', 'test@example.com');
  git(remote, 'config', 'core.autocrlf', 'false');
  git(remote, 'clone', '-q', '-b', 'main', remote, source);

  function commit(...files) {
    git(remote, 'add', '--', ...files);
    git(remote, 'commit', '-qm', 'Update fixture');
    return git(remote, 'rev-parse', 'HEAD');
  }
  function installOld(root) {
    fs.mkdirSync(root, { recursive: true });
    node(['-e', 'require(process.argv[1]).install(process.argv[2], false, null, true)',
      path.join(source, 'install.cjs'), root], { env });
  }
  function enable() {
    const updaterFiles = [
      'install.cjs', 'auto-update.cjs', 'rtk-setup.cjs', 'ecc-setup.cjs', 'headroom-setup.cjs', 'repository-setup.cjs', 'terminal-ui.cjs',
    ];
    for (const name of updaterFiles) fs.copyFileSync(path.join(kit, name), path.join(remote, name));
    const revision = commit(...updaterFiles);
    git(source, 'pull', '-q', '--ff-only');
    const cli = flag => JSON.parse(node([path.join(source, 'install.cjs'), flag], { env }));
    const enabled = cli('--enable-auto-update');
    const hook = json(config, 'settings.json').hooks.SessionStart.at(-1).hooks[0];
    const start = (root, source = 'startup') => node(hook.args, {
      cwd: root, env: { ...env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ hook_event_name: 'SessionStart', source, cwd: root }),
    });
    return { revision, enabled, start, cli };
  }
  return { base, remote, source, config, commit, installOld, enable };
}

test('legacy sidebar releases upgrade without a revision marker and still reject local edits', {
  skip: spawnSync('git', ['-C', kit, 'cat-file', '-e', '596740a^{commit}']).status !== 0,
}, t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'caronte sidebar '));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const folder = '.claude/skills/caronte-panel/hooks/';
  const original = {};
  for (const file of ['ferryman.js', 'view.js', 'register.js']) {
    const rel = folder + file;
    original[file] = execFileSync('git', ['-C', kit, 'show', '596740a:' + rel], { encoding: 'utf8' }).replace(/\n/g, '\r\n');
    write(project, rel, original[file]);
  }
  const ferryman = folder + 'ferryman.js';
  write(project, ferryman, original['ferryman.js'] + '// Local edit\r\n');
  assert.throws(() => install(project), /Conflitto, file personalizzato:.*ferryman\.js/);
  assert.match(read(project, ferryman), /Local edit/);
  write(project, ferryman, original['ferryman.js']);
  assert.ok(install(project).changed.includes(ferryman));
  assert.equal(read(project, ferryman), read(kit, ferryman));
  assert.equal(read(project, folder + 'wordmark.js'), read(kit, folder + 'wordmark.js'));
  const localArtwork = original['ferryman.js'] + '// Local edit\r\n';
  write(project, ferryman, localArtwork);
  const update = install(project);
  assert.deepEqual(update.backedUpSidebar, [ferryman]);
  assert.equal(read(project, path.join(update.backup, ferryman)), localArtwork);
  assert.equal(read(project, ferryman), read(kit, ferryman));
});

test('caronte start updates the project from its checkout before opening Headroom', needsHistory, t => {
  const { base, remote, source, commit, installOld, enable } = fixture(t);
  const project = path.join(base, 'project');
  installOld(project);
  enable();
  const launcher = 'caronte.cjs';
  const sidebarView = '.claude/skills/caronte-panel/hooks/view.js';
  const localView = read(project, sidebarView) + '\n// Local sidebar copy.\n';
  write(project, sidebarView, localView);
  write(remote, launcher, read(kit, launcher));
  write(remote, agent, read(project, agent) + '\nUpdate before launch.\n');
  const revision = commit(launcher, agent);
  git(source, 'pull', '-q', '--ff-only');
  const result = spawnSync(process.execPath, [path.join(source, launcher), 'start', '--headroom-python=' + path.join(base, 'missing')], {
    cwd: project, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Caronte aggiornato alla revisione .*\nInterprete Python di Headroom non trovato/);
  const backup = /File precedenti della sidebar salvati in ([^\r\n]+)\./.exec(result.stderr);
  assert.ok(backup);
  assert.equal(read(project, path.join(backup[1], sidebarView)), localView);
  assert.equal(read(project, sidebarView), read(source, sidebarView));
  assert.equal(json(project, installationFile).revision, revision);
  assert.match(read(project, agent), /Update before launch/);
});

test('one user hook updates legacy projects and worktrees after pulling Caronte', needsHistory, t => {
  const { base, remote, source, config, commit, installOld, enable } = fixture(t);
  const project = path.join(base, 'project');
  const worktree = path.join(base, 'separate worktree');
  const plain = path.join(base, 'without Caronte');
  fs.mkdirSync(plain);
  git(base, 'init', '-q', project);
  git(project, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Initial', '--allow-empty');
  git(project, 'worktree', 'add', '--detach', '-q', worktree);
  for (const root of [project, worktree]) installOld(root);
  const settings = json(project, local);
  settings.model = 'project-model';
  settings.autoCompactWindow = 140000;
  settings.env.CLAUDE_CODE_FORK_SUBAGENT = '1';
  settings.enabledPlugins = { 'ecc@ecc': true };
  settings.permissions = { allow: ['Read'] };
  settings.hooks.PreToolUse.unshift({ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk', args: ['hook', 'claude'] }] });
  write(project, local, JSON.stringify(settings, null, 2) + '\n');
  write(project, 'CLAUDE.md', '# Project notes\n\n' + read(project, 'CLAUDE.md'));
  const originalUserSettings = {
    effortLevel: 'low',
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'my-hook' }] }] },
  };
  write(config, 'settings.json', JSON.stringify(originalUserSettings));
  const { enabled, start, cli } = enable();
  assert.equal(enabled.changed, true);
  assert.equal(cli('--enable-auto-update').changed, false);
  assert.equal(start(plain), '');
  assert.deepEqual(fs.readdirSync(plain), []);

  const oldAgent = read(project, agent);
  write(project, agent, oldAgent.replace(/\r?\n/g, '\r\n'));
  write(remote, agent, oldAgent + '\nUpdated from the local clone.\n');
  const next = commit(agent);
  git(source, 'pull', '-q', '--ff-only');
  write(source, agent, 'Uncommitted source changes');
  write(source, local, '{"model":"source-machine"}');
  assert.match(JSON.parse(start(project)).systemMessage, new RegExp(next.slice(0, 12)));
  assert.equal(json(project, installationFile).revision, next);
  assert.match(read(project, agent), /Updated from the local clone/);
  assert.match(read(project, 'CLAUDE.md'), /^# Project notes/);
  assert.deepEqual(json(project, local), settings);
  assert.equal(start(project), '');
  assert.equal(start(worktree, 'clear'), '');
  assert.equal(fs.existsSync(path.join(worktree, installationFile)), false);
  assert.match(JSON.parse(start(worktree, 'resume')).systemMessage, /aggiornato/);
  assert.equal(json(worktree, installationFile).revision, next);
  assert.equal(cli('--disable-auto-update').changed, true);
  assert.deepEqual(json(config, 'settings.json'), originalUserSettings);
});

test('a conflict is retryable and a checkout at an older commit cannot downgrade a project', needsHistory, t => {
  const { base, remote, source, commit, installOld, enable } = fixture(t);
  const project = path.join(base, 'project');
  installOld(project);
  const oldAgent = read(project, agent);
  const { revision, start } = enable();
  assert.equal(start(project), '');
  assert.equal(json(project, installationFile).revision, revision);

  write(project, agent, '\nUser change.\n');
  write(remote, agent, oldAgent + '\nSource change.\n');
  const next = commit(agent);
  git(source, 'pull', '-q', '--ff-only');
  const lock = '.claude-routing-backups/.caronte-install.lock';
  write(project, lock, '');
  assert.match(JSON.parse(start(project)).systemMessage, /già in corso/);
  assert.equal(json(project, installationFile).revision, revision);
  fs.unlinkSync(path.join(project, lock));
  assert.match(JSON.parse(start(project)).systemMessage, /Conflitto/);
  assert.equal(read(project, agent), '\nUser change.\n');
  assert.equal(json(project, installationFile).revision, revision);
  write(project, agent, oldAgent);
  assert.match(JSON.parse(start(project)).systemMessage, /aggiornato/);
  assert.equal(json(project, installationFile).revision, next);
  git(source, 'checkout', '-q', '--detach', revision);
  assert.equal(start(project), '');
  assert.match(read(project, agent), /Source change/);
  assert.equal(json(project, installationFile).revision, next);
});
