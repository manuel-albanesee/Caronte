import { agentCards, combineUsage, drawPanel, isActive } from './view.js';

const pane = 'caronte-panel';
const reviewId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const checkCommand = /^node \.claude\/routing\/delivery\.cjs check [0-9a-f-]+$/;
const finishedLimit = 20;
const finalStatuses = { answer: 'completed', aborted: 'killed', error: 'failed', refusal: 'failed' };
const tools = new Map([
  ['Read', 'Lettura'], ['Grep', 'Ricerca nei file'], ['Glob', 'Ricerca dei percorsi'],
  ['Edit', 'Modifica'], ['Write', 'Scrittura'], ['MultiEdit', 'Modifica'],
  ['NotebookEdit', 'Modifica notebook'], ['Bash', 'Comando'], ['PowerShell', 'Comando'],
  ['Agent', 'Delega'], ['Task', 'Delega'], ['WebSearch', 'Ricerca web'], ['WebFetch', 'Lettura web'],
  ['TaskCreate', 'Aggiornamento attività'], ['TaskUpdate', 'Aggiornamento attività'],
]);

async function readJson($, path) {
  try {
    return JSON.parse(await $.fs.read(path));
  } catch {
    return null;
  }
}

async function openPane($) {
  return $.ui.open({
    id: pane, title: 'CARONTE', columns: 40, rows: 16, backgroundColor: '#101920',
  });
}

async function workState($, root) {
  try {
    const gitFile = root + '/.git';
    const git = await $.fs.stat(gitFile, { resolve: true });
    if (git.kind === 'dir') return git.realPath ? git.realPath + '/claude-routing-work' : null;
    if (git.kind !== 'file' || git.size > 4096) return null;
    const pointer = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(await $.fs.read(gitFile));
    if (!pointer) return null;
    // Git resolves a relative gitdir against the directory containing the .git file.
    const absolute = /^(?:[A-Za-z]:)?[\\/]/.test(pointer[1]);
    const dir = await $.fs.stat(absolute ? pointer[1] : root + '/' + pointer[1], { resolve: true });
    return dir.kind === 'dir' && dir.realPath ? dir.realPath + '/claude-routing-work' : null;
  } catch {
    return null;
  }
}

async function refreshPlans($, state, session, agents, plans) {
  const grant = await readJson($, state + '/active.json');
  if (grant?.session === session && reviewId.test(grant.id) && agents.some(agent => agent.id === grant.agent)) {
    const found = plans.get(grant.agent);
    if (found?.id !== grant.id) {
      const spec = await readJson($, state + '/' + grant.id + '/plan.json');
      if (spec?.id === grant.id && Array.isArray(spec.tests)) {
        plans.set(grant.agent, { id: grant.id, tests: spec.tests.length });
      }
    }
  }

  await Promise.all(agents.map(async ({ id }) => {
    const plan = plans.get(id);
    if (!plan || plan.closed) return;
    const folder = state + '/' + plan.id;
    const review = grant?.id === plan.id ? null : await readJson($, folder + '/review.json');
    if (Array.isArray(review?.changed)) {
      plan.checks = review.checks;
      plan.reviewed = true;
      plan.closed = true;
    } else if (plan.tests) {
      const receipt = await readJson($, folder + '/test.json');
      plan.checks = receipt ? (receipt.ok === true ? 'pass' : 'fail') : 'not-run';
    }
  }));
}

async function refresh($, board, justFinished = false) {
  if (!board.open || board.refreshing) return;
  board.refreshing = true;
  const { plans, calls } = board;
  try {
    const [identity, roster] = await Promise.all([$.session.id(), $.agent.list()]);
    if (!board.open || board.plans !== plans) return;
    if (identity !== board.session) {
      plans.clear();
      board.state = undefined;
      board.session = identity;
    }
    board.roster = new Map(roster.map(agent => [agent.id, agent]));
    const current = new Map(board.finished);
    for (const agent of roster) {
      const finished = board.finished.get(agent.id);
      current.set(agent.id, finished && !isActive(agent.status) ? { ...agent, usage: finished.usage } : agent);
    }
    const agents = [...current.values()];
    if (justFinished || roster.length || [...plans.values()].some(plan => !plan.closed)) {
      const root = await $.session.root();
      if (root !== board.root) {
        plans.clear();
        board.state = undefined;
        board.root = root;
      }
      if (board.state === undefined) board.state = await workState($, root);
      if (board.state) await refreshPlans($, board.state, identity, agents, plans);
    }
    const cards = agentCards(agents, calls, plans);
    if (board.open && board.plans === plans && JSON.stringify(cards) !== JSON.stringify(board.cards)) {
      board.cards = cards;
      $.ui.invalidate('ui.render');
    }
  } finally {
    board.refreshing = false;
  }
}

export function register(on) {
  const board = {
    open: false, refreshing: false, cards: [],
    plans: new Map(), calls: new Map(), roster: new Map(), finished: new Map(),
  };

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: pane, immediate: true, description: 'Mostra o chiudi la sidebar Caronte con attività, verifiche e token',
    });
    $.clock.every(900, () => refresh($, board));
    if (e.isInteractive && e.surface === 'terminal') {
      const placement = await openPane($).catch(() => null);
      board.open = placement?.isPlaced === true;
    }
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    board.calls = new Map();
    board.plans = new Map();
    board.roster = new Map();
    board.finished = new Map();
    board.cards = [];
    if (board.open) $.ui.invalidate('ui.render');
    return next(e);
  });

  on('command.run', { command: 'caronte-panel' }, async ($) => {
    if ((await $.ui.panes()).some(item => item.id === pane && item.isPlaced)) {
      await $.ui.close({ id: pane });
      board.open = false;
      return {};
    }
    const result = await openPane($);
    board.open = result.isPlaced;
    if (!board.open) return { text: 'Apri /caronte-panel in una sessione terminale interattiva.' };
    return {};
  });

  on('ui.close', { id: 'caronte-panel' }, async ($, e, next) => {
    const result = await next(e);
    board.open = (await $.ui.panes()).some(item => item.id === pane && item.isPlaced);
    return result;
  });

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const { finished, roster } = board;
      const agents = await $.agent.list().catch(() => []);
      const agent = agents.find(item => item.id === e.agentId) || roster.get(e.agentId);
      if (agent && board.finished === finished) {
        const previous = finished.get(e.agentId);
        const usage = e.usage ? combineUsage(previous?.usage, e.usage) : previous?.usage ?? agent.usage;
        finished.delete(e.agentId);
        finished.set(e.agentId, { ...agent, status: finalStatuses[e.reason] || agent.status, usage });
        if (finished.size > finishedLimit) {
          const oldest = finished.keys().next().value;
          finished.delete(oldest);
          board.plans.delete(oldest);
        }
        await refresh($, board, true).catch(() => {});
      }
    }
    return next(e);
  });

  on('tool.run', async ($, e, next) => {
    if (!board.open || !e.agentId) return next(e);
    const { calls } = board;
    let running = calls.get(e.agentId);
    if (!running) {
      running = new Map();
      calls.set(e.agentId, running);
    }
    const targeted = ['Bash', 'PowerShell'].includes(e.tool) && checkCommand.test(e.command);
    const operation = tools.get(e.tool) || (e.tool.startsWith('mcp__') ? 'Strumento MCP' : e.tool);
    running.set(e.tool_use_id, targeted ? 'Verifica mirata' : operation);
    try {
      return await next(e);
    } finally {
      running.delete(e.tool_use_id);
      if (!running.size) calls.delete(e.agentId);
    }
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== pane) return next(e);
    // Claude Code can place the pane after the user widens their terminal.
    board.open = true;
    const { Box, Text } = $.ui.resolve(e);
    return drawPanel(Box, Text, e.props.bodyColumns, board.cards);
  });
}
