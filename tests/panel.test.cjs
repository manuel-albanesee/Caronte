const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const view = import('../.claude/skills/caronte-panel/hooks/view.js');
const mod = import('../.claude/skills/caronte-panel/hooks/register.js');

const box = props => ({ children: props.children });
const text = props => ({ children: props.children });
const button = props => ({ ...props, children: [props.label] });
function lines(node) {
  return typeof node === 'string' ? [node] : node.children.flatMap(lines);
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
  const wide = lines(drawPanel(box, text, 40, cards, button({ label: 'Disegno ASCII' }))).join('\n');
  assert.match(wide, /Disegno ASCII/);
  assert.match(wide, /› Lettura/);
  assert.match(wide, /Cache ↓ 34 +↑ 45/);
  assert.match(wide, /Token —/);
  assert.doesNotMatch(wide, /[\u001b\u202E]|\b100%/);
});

test('the ASCII view preserves every column and row of the README artwork at any panel width', async () => {
  const { drawArtwork } = await view;
  const { ferryman, ferrymanWidth } = await import('../.claude/skills/caronte-panel/hooks/ferryman.js');
  const readme = readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const [, artwork] = readme.match(/<summary>Caronte ASCII artwork<\/summary>\s*```text\n([\s\S]*?)\n```/);
  assert.equal(artwork, ferryman.join('\n'));
  assert.equal(ferryman.findIndex(Boolean), 9);
  assert.equal(ferryman.length, 51);

  for (const columns of [14, 40, 82, 102, 130]) {
    const assembled = ferryman.map(() => '');
    let offset = 0;
    let covered = 0;
    while (covered < ferrymanWidth) {
      const tree = drawArtwork({ Box: box, Text: text, Button: button }, columns, offset, value => { offset = value; });
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
    session: { id: async () => session, root: async () => '/linked/w' },
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
      resolve: () => ({ Box: box, Text: text, Button: button }),
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
  (await tree()).children[0].onPress();
  assert.match(await render(), /=\*\*=:/);
  assert.doesNotMatch(await render(), /33% · 1\/3/);
  (await tree()).children[0].onPress();
  assert.match(await render(), /33% · 1\/3/);
  await command('ascii');
  assert.match(await render(), /51–88\/100/);
  await command('left');
  assert.match(await render(), /17–54\/100/);
  await command('right');
  assert.match(await render(), /51–88\/100/);
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
