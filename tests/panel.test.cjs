const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const view = import('../.claude/skills/caronte-panel/hooks/view.js');
const mod = import('../.claude/skills/caronte-panel/hooks/register.js');

const box = props => props;
const text = props => ({ children: props.children });
const button = props => ({ ...props, children: [props.label] });
const link = props => ({ ...props, children: [props.label || props.href] });
function lines(node) {
  return typeof node === 'string' ? [node] : node.children.flatMap(lines);
}

function control(node, key) {
  return node.key === key ? node : node.children?.map(child => control(child, key)).find(Boolean);
}

test('the panel displays live activity, cumulative token categories and missing data', async () => {
  const { agentCards, drawPanel } = await view;
  const cards = agentCards([
    {
      id: 'done', type: 'ecc:reviewer', status: 'completed', startTime: 2,
      description: 'Review completed',
    },
    {
      id: 'live', type: 'ecc:writer', status: 'running', startTime: 1,
      description: 'Update\u001b\u202E parser', model: 'claude-sonnet-5-5',
      usage: [
        { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
        { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 },
      ],
    },
  ], new Map([['live', new Map([['call', 'Lettura']])]]), new Map());
  assert.deepEqual(cards.map(card => card.id), ['live', 'done']);
  assert.deepEqual(cards[0].usage, [12, 23, 34, 45]);
  const draw = (columns, rows, page = 0, changePage = () => {}) =>
    drawPanel({ Box: box, Text: text, Button: button, Link: link }, { columns, rows, cards, page, changePage });
  const wide = lines(draw(40, 36).tree).join('\n');
  assert.match(wide, /ASCII/);
  assert.match(wide, /› Lettura/);
  assert.match(wide, /Cache ↓ 34 +↑ 45/);
  assert.match(wide, /Token —/);
  assert.doesNotMatch(wide, /[\u001b\u202E]|\b100%/);

  for (const [columns, rows] of [[24, 16], [40, 36], [80, 45]]) {
    const { tree } = draw(columns, rows);
    const [logo, metrics, totals] = tree.children;
    assert.equal(tree.backgroundColor, '#000000');
    assert.equal(logo.height, Math.round(rows * 0.2));
    assert.equal(totals.height, Math.round(rows * 0.2));
    assert.equal(logo.height + metrics.height + totals.height, rows);
    assert.equal(logo.children.at(-2).href, 'https://github.com/manuel-albanesee');
    const artwork = lines(logo).slice(0, -2);
    assert.equal(artwork.length, logo.height - 2);
    assert.ok(artwork.every(row => /^[ .:=+*#%@-]+$/.test(row) && row.length <= columns - 2));
    assert.match(lines(metrics).join('\n'), /SUBAGENT 1(?:\/2| attivi)/);
  }

  let page = 0;
  const first = draw(40, 16, page, value => { page = value; });
  assert.equal(first.pageCount, 2);
  control(first.tree, 'stats-next').onPress();
  const second = draw(40, 16, page);
  assert.equal(second.page, 1);
  assert.deepEqual(lines(first.tree.children[0]), lines(second.tree.children[0]));
  assert.match(lines(second.tree.children[1]).join('\n'), /Token —/);
  assert.equal(draw(40, 36, page).page, 0);
});

test('the ASCII view preserves every column and row of the README artwork at any panel width', async () => {
  const { drawArtwork } = await view;
  const { ferryman, ferrymanWidth } = await import('../.claude/skills/caronte-panel/hooks/ferryman.js');
  const readme = readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const [, artwork] = readme.match(/^#### Caronte ASCII artwork\r?\n\r?\n200 columns by 100 rows\.\s*```text\n([\s\S]*?)\n```/m);
  assert.equal(artwork, ferryman.join('\n'));
  assert.equal(ferrymanWidth, 200);
  assert.equal(ferryman.length, 100);
  assert.ok(ferryman.every(row => row.length === ferrymanWidth));

  for (const columns of [14, 40, 82, 102, 130]) {
    const assembled = ferryman.map(() => '');
    let offset = 0;
    let covered = 0;
    while (covered < ferrymanWidth) {
      const tree = drawArtwork({ Box: box, Text: text, Button: button, Link: link }, columns, offset, value => { offset = value; });
      const viewport = lines(tree).slice(-ferryman.length);
      const overlap = covered - offset;
      for (const [index, row] of viewport.entries()) assembled[index] += row.slice(overlap);
      assert.ok(offset + viewport[0].length > covered);
      covered = offset + viewport[0].length;
      if (covered < ferrymanWidth) tree.children[1].children.find(node => node.key === 'art-right').onPress();
    }
    assert.deepEqual(assembled, ferryman.map(row => row.padEnd(ferrymanWidth)));
  }
});

test('checkpoint completion follows the session, agent and review evidence in a linked worktree', async () => {
  const { register } = await mod;
  const hooks = new Map();
  register((event, match, handler) => hooks.set(event, handler || match));
  const id = '4449f241-0594-4f5e-b1d4-6868881cd5e3';
  const folder = '/git/worktrees/w/claude-routing-work';
  const active = folder + '/active.json';
  const receipt = folder + '/' + id + '/test.json';
  const review = folder + '/' + id + '/review.json';
  const files = new Map([
    ['/linked/w/.git', 'gitdir: ../../main/.git/worktrees/w\r\n'],
    [active, JSON.stringify({ id, agent: 'worker', session: 'other' })],
    [folder + '/' + id + '/plan.json', JSON.stringify({ id, tests: [{}] })],
  ]);
  let tick;
  let paneOpen;
  let opens = 0;
  let session = 'session';
  let redraws = 0;
  const agents = [{ id: 'worker', type: 'ecc:writer', status: 'running', startTime: 1 }];
  const api = {
    agent: { list: async () => agents },
    session: {
      id: async () => session, root: async () => '/linked/w', repo: async () => null,
      info: async () => ({}), usage: async () => ({}),
    },
    fs: {
      stat: async path => {
        if (path === '/linked/w/.git') return { kind: 'file', size: 36 };
        assert.equal(path, '/linked/w/../../main/.git/worktrees/w');
        return { kind: 'dir', realPath: '/git/worktrees/w' };
      },
      read: async path => {
        if (!files.has(path)) throw Error('missing receipt');
        return files.get(path);
      },
    },
    command: { register: async command => assert.equal(command.name, 'caronte-panel') },
    clock: { every: (period, callback) => { tick = callback; } },
    ui: {
      open: async args => {
        assert.equal(args.id, 'caronte-panel');
        paneOpen = { id: args.id, isPlaced: ++opens > 1 };
        return { isPlaced: paneOpen.isPlaced };
      },
      close: async args => {
        assert.equal(args.id, 'caronte-panel');
        paneOpen = false;
      },
      panes: async () => paneOpen ? [paneOpen] : [],
      resolve: () => ({ Box: box, Text: text, Button: button, Link: link }),
      invalidate: () => { redraws++; },
    },
  };
  const result = {};
  const next = async () => result;
  const command = (args = '') => hooks.get('command.run')(api, { args });
  const tree = () => hooks.get('ui.render')(api, {
    requestId: 'caronte-panel', props: { bodyColumns: 40 },
  }, next);
  const render = async () => lines(await tree()).join('\n');

  assert.equal(await hooks.get('session.start')(api, { isInteractive: true, surface: 'terminal' }, next), result);
  assert.equal(opens, 1);
  assert.equal(paneOpen.isPlaced, false);
  await tick();
  assert.equal(redraws, 0);
  await command();
  assert.equal(paneOpen.isPlaced, true);
  await tick();
  assert.match(await render(), /Avanzamento —/);
  files.set(active, JSON.stringify({ id, agent: 'worker', session }));
  await tick();
  assert.match(await render(), /33% · 1\/3/);
  control(await tree(), 'open-art').onPress();
  assert.match(await render(), /(?:@{10}|[.:%#=]{3})/);
  assert.doesNotMatch(await render(), /33% · 1\/3/);
  (await tree()).children[0].onPress();
  assert.match(await render(), /33% · 1\/3/);
  await command('ascii');
  assert.match(await render(), /101–138\/200/);
  await command('left');
  assert.match(await render(), /67–104\/200/);
  await command('right');
  assert.match(await render(), /101–138\/200/);
  await command('ascii');
  assert.match(await render(), /33% · 1\/3/);

  const call = { agentId: 'worker', tool_use_id: 'call', tool: 'Read' };
  const toolResult = { result: 'output unchanged' };
  assert.equal(await hooks.get('tool.run')(api, call, async event => {
    assert.equal(event, call);
    await tick();
    assert.match(await render(), /› Lettura/);
    return toolResult;
  }), toolResult);
  files.set(receipt, JSON.stringify({ ok: true }));
  await tick();
  assert.match(await render(), /66% · 2\/3/);
  assert.doesNotMatch(await render(), /› Lettura/);

  files.delete(active);
  files.set(review, JSON.stringify({ checks: 'stale', changed: ['src.js'] }));
  await tick();
  assert.match(await render(), /Test da rieseguire/);
  assert.doesNotMatch(await render(), /100%/);

  assert.equal(await hooks.get('turn.complete')(api, {
    agentId: 'worker', reason: 'answer', usage: { input_tokens: 20, output_tokens: 30 },
  }, next), result);
  const [worker] = agents.splice(0);
  await tick();
  assert.match(await render(), /Concluso/);
  assert.match(await render(), /In 20 +Out 30/);
  await command();
  assert.equal(paneOpen, false);
  await command();
  assert.equal(paneOpen.isPlaced, true);

  session = 'new';
  agents.push(worker);
  await hooks.get('session.end')(api, {}, next);
  await tick();
  assert.match(await render(), /Avanzamento —/);
  assert.doesNotMatch(await render(), /In 20/);
  paneOpen = false;
  assert.equal(await hooks.get('ui.close')(api, {}, next), result);
  const count = redraws;
  agents.length = 0;
  await tick();
  assert.equal(redraws, count);
});

test('the project history restores completed activity and counts resumed turns and costs once', async () => {
  const { register } = await mod;
  const files = new Map();
  const agent = { id: 'agent-alpha', status: 'running', startTime: 1, description: 'Controllo parser' };
  const usage = (input, output, read, write) => ({
    input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write,
  });
  const next = async () => ({});
  function launch(id, root, roster = []) {
    const hooks = new Map();
    register((event, match, handler) => hooks.set(event, handler || match));
    let cost;
    let mtime = 0;
    const api = {
      agent: { list: async () => roster },
      session: { id: async () => id, root: async () => root, repo: async () => null, usage: async () => ({ cost }) },
      fs: {
        stat: async file => {
          if (file === root + '/.git') return { kind: 'dir', realPath: file };
          throw Error('Unavailable');
        },
        write: async (file, data) => files.set(file, { data, mtimeMs: ++mtime }),
        read: async file => files.get(file).data,
        list: async dir => [...files.entries()].filter(([file]) => file.startsWith(dir + '/'))
          .map(([file, { data, mtimeMs }]) => ({ name: path.basename(file), kind: 'file', size: data.length, mtimeMs })),
      },
      command: { register: async () => {} },
      clock: { every: () => {} },
      ui: {
        open: async () => ({ isPlaced: true }),
        resolve: () => ({ Box: box, Text: text, Button: button, Link: link }),
        invalidate: () => {},
      },
    };
    const emit = (event, data) => hooks.get(event)(api, data, next);
    return {
      emit,
      measure: usd => emit('session.measure', { cost: cost = { usd } }),
      start: interactive => emit('session.start', { isInteractive: interactive, surface: 'terminal' }),
      render: async () => lines(await emit('ui.render', {
        requestId: 'caronte-panel', props: { bodyColumns: 42, scroll: { bodyRows: 38 } },
      })).join('\n'),
    };
  }
  const first = launch('first', '/project', [agent]);
  await first.start(false);
  await first.emit('tool.run', { agentId: agent.id, tool_use_id: 'read', tool: 'Read' });
  const child = { turnId: 'child', agentId: agent.id, reason: 'answer', usage: usage(10, 20, 30, 40) };
  await first.emit('turn.complete', child);
  await first.emit('turn.complete', child);
  await first.emit('turn.complete', { turnId: 'main', usage: usage(5, 6, 7, 8) });
  await first.measure(0.75);
  await first.emit('session.end', {});

  const resumed = launch('first', '/project');
  await resumed.start(true);
  let panel = await resumed.render();
  assert.match(panel, /Controllo parser[\s\S]*› Lettura[\s\S]*In 10 +Out 20/);
  await resumed.measure(1.25);
  const second = launch('second', '/project');
  await second.start(true);
  await second.emit('turn.complete', { turnId: 'main', usage: usage(1, 2, 3, 4) });
  await second.measure(0.50);
  panel = await second.render();
  assert.match(panel, /\$1,75/);
  assert.match(panel, /Input +16[\s\S]*Output +28[\s\S]*Cache read +40[\s\S]*Cache write +52/);
  const other = launch('second', '/other-project');
  await other.start(true);
  assert.match(await other.render(), /In attesa di una delega[\s\S]*costo stim\. —[\s\S]*Input +0/);
});
