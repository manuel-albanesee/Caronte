import { ferrymanWidth } from './ferryman.js';
import { agentCards, artworkWindow, combineUsage, drawArtwork, drawPanel, isActive } from './view.js';
import { createHistory, historyDirectory, readHistory, saveRecord, sessionCost, usageTotals } from './history.js';

const pane = 'caronte-panel';
const logoPath = '/.claude/skills/caronte-panel/assets/ferryman.svg';
const graphicSurfaces = new Set(['desktop', 'vscode']);
const initialArtOffset = Math.floor(ferrymanWidth / 2);
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
    id: pane, title: 'CARONTE', columns: 40, rows: 16, backgroundColor: '#000000',
  });
}

function selectPage($, board, page) {
  const clamped = Math.max(0, Math.min(board.pageCount - 1, page));
  if (clamped === board.page && board.artOffset === null) return;
  board.page = clamped;
  board.artOffset = null;
  $.ui.invalidate('ui.render');
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

async function scope($, board) {
  const [session, root] = await Promise.all([$.session.id(), $.session.root()]);
  if (board.session !== session || board.root !== root) {
    board.session = session;
    board.root = root;
    board.state = undefined;
    board.history = historyDirectory($, root).then(directory => createHistory(directory, session)).catch(() => null);
    board.project = null;
  }
  return board.history;
}

async function saveCost($, history, estimate) {
  const usd = sessionCost(estimate);
  if (!history || usd === null || (history.cost !== null && usd <= history.cost)) return;
  const previous = history.cost;
  history.cost = usd;
  try {
    await saveRecord($, history, 'cost', history.session, { session: history.session, usd });
  } catch (error) {
    if (history.cost === usd) history.cost = previous;
    throw error;
  }
}

async function refresh($, board, force = false) {
  if (board.refreshing) {
    if (!force) return;
    await board.refreshing.catch(() => {});
    return refresh($, board, force);
  }
  const pendingReview = [...board.plans.values()].some(plan => !plan.closed);
  if (!board.open && !force && !pendingReview) return;
  board.refreshing = updateBoard($, board, force);
  try {
    await board.refreshing;
  } finally {
    board.refreshing = null;
  }
}

async function updateBoard($, board, force) {
  const { plans, calls, finished, operations } = board;
  const [history, roster] = await Promise.all([scope($, board), $.agent.list()]);
  if (board.plans !== plans) return;
  const identity = board.session;
  board.roster = new Map(roster.map(agent => [agent.id, agent]));
  const current = new Map(finished);
  for (const agent of roster) {
    const done = finished.get(agent.id);
    current.set(agent.id, done && !isActive(agent.status) ? { ...agent, ...done } : agent);
  }
  const agents = [...current.values()];
  if (agents.length) {
    if (board.state === undefined) board.state = await workState($, board.root);
    if (board.state) await refreshPlans($, board.state, identity, agents, plans);
  }
  if (board.plans !== plans || board.session !== identity) return;
  const cards = agentCards(agents, calls, plans, operations);
  let changed = false;
  for (const card of cards) {
    const done = finished.get(card.id);
    if (!done) continue;
    const saved = { ...card, status: done.status, usage: usageTotals(done.usage), activity: '',
      recordedAt: done.recordedAt, session: identity };
    card.recordedAt = !isActive(card.status) ? saved.recordedAt : undefined;
    if (history) {
      const previous = history.saved.get('card-' + identity + '-' + card.id + '.json');
      const record = { session: identity, card: saved };
      if (JSON.stringify(record) !== previous) {
        await saveRecord($, history, 'card', card.id, record).catch(() => {});
        changed = true;
      }
    }
  }
  if (!board.project || changed || force || (history && Date.now() - history.readAt >= 5000)) {
    board.project = await readHistory($, history);
    if (history) {
      history.readAt = Date.now();
      if (board.project.liveCost !== null) history.cost = Math.max(history.cost ?? 0, board.project.liveCost);
    }
  }
  const historical = board.project.cards.filter(card => card.session !== identity || !current.has(card.id));
  const visible = [...cards, ...historical].sort((a, b) =>
    Number(isActive(b.status)) - Number(isActive(a.status)) ||
    (b.recordedAt ?? b.start ?? 0) - (a.recordedAt ?? a.start ?? 0));
  const summary = { cards: visible, tokens: board.project.tokens, usd: board.project.usd };
  if (board.open && board.plans === plans && JSON.stringify(summary) !== board.rendered) {
    board.rendered = JSON.stringify(summary);
    board.cards = visible;
    board.totals = summary;
    $.ui.invalidate('ui.render');
  }
}

export function register(on) {
  const board = {
    open: false, refreshing: false, cards: [], artOffset: null, page: 0, pageCount: 1,
    plans: new Map(), calls: new Map(), roster: new Map(), finished: new Map(), operations: new Map(),
    completedTurns: new Set(),
  };

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: pane, immediate: true, description: 'Mostra o chiudi la sidebar Caronte con attività, verifiche e token',
      argumentHint: '[ascii|left|right|prev|next]',
    });
    $.clock.every(900, () => refresh($, board).catch(() => {}));
    if (e.isInteractive && (e.surface === 'terminal' || graphicSurfaces.has(e.surface))) {
      const placement = await openPane($).catch(() => null);
      board.open = placement?.isPlaced === true;
    }
    await refresh($, board).catch(() => {});
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    await (async () => {
      const history = await scope($, board);
      const usage = await $.session.usage();
      await saveCost($, history, usage?.cost);
      await refresh($, board, true);
    })().catch(() => {});
    board.calls = new Map();
    board.plans = new Map();
    board.roster = new Map();
    board.finished = new Map();
    board.operations = new Map();
    board.completedTurns = new Set();
    board.cards = [];
    board.rendered = null;
    board.logoSource = undefined;
    board.artOffset = null;
    board.page = 0;
    board.pageCount = 1;
    if (board.open) $.ui.invalidate('ui.render');
    return next(e);
  });

  on('command.run', { command: 'caronte-panel' }, async ($, e) => {
    const action = e.args.trim();
    if (action && !['ascii', 'left', 'right', 'prev', 'next'].includes(action)) {
      return { text: 'Usa /caronte-panel [ascii|left|right|prev|next].' };
    }
    const placed = (await $.ui.panes()).some(item => item.id === pane && item.isPlaced);
    if (!action && placed) {
      await $.ui.close({ id: pane });
      board.open = false;
      board.artOffset = null;
      return {};
    }
    board.open = placed || (await openPane($)).isPlaced;
    if (!board.open) return { text: 'Apri /caronte-panel in una sessione interattiva.' };
    await refresh($, board).catch(() => {});
    if (action === 'prev' || action === 'next') {
      selectPage($, board, board.page + (action === 'next' ? 1 : -1));
      return {};
    }
    if (action === 'ascii') {
      board.artOffset = board.artOffset === null ? initialArtOffset : null;
    } else if (action) {
      const { left, right } = artworkWindow(board.columns, board.artOffset ?? initialArtOffset);
      board.artOffset = action === 'left' ? left : right;
    }
    if (action) $.ui.invalidate('ui.render');
    return {};
  });

  on('ui.close', { id: 'caronte-panel' }, async ($, e, next) => {
    const result = await next(e);
    board.open = (await $.ui.panes()).some(item => item.id === pane && item.isPlaced);
    if (!board.open) board.artOffset = null;
    return result;
  });

  on('session.measure', async ($, e, next) => {
    try {
      const history = await scope($, board);
      await saveCost($, history, e.cost);
      await refresh($, board, true);
    } catch {}
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    try {
      const history = await scope($, board);
      if (history && e.usage) {
        const snapshot = await $.session.usage().catch(() => null);
        await saveRecord($, history, 'turn', e.turnId, {
          session: history.session, tokens: usageTotals([e.usage]), usd: sessionCost(snapshot?.cost),
        });
      }
    } catch {}
    if (e.agentId) {
      const { finished, roster } = board;
      const agents = await $.agent.list().catch(() => []);
      const agent = agents.find(item => item.id === e.agentId) || roster.get(e.agentId);
      if (agent && board.finished === finished && (!e.turnId || !board.completedTurns.has(e.turnId))) {
        if (e.turnId) board.completedTurns.add(e.turnId);
        const previous = finished.get(e.agentId);
        const usage = e.usage ? combineUsage(previous?.usage, e.usage) : previous?.usage ?? agent.usage;
        finished.delete(e.agentId);
        finished.set(e.agentId, { ...agent, status: finalStatuses[e.reason] || agent.status, usage,
          recordedAt: Date.now() });
        await refresh($, board, true).catch(() => {});
        if (finished.size > finishedLimit) {
          const oldest = finished.keys().next().value;
          finished.delete(oldest);
          board.plans.delete(oldest);
          board.operations.delete(oldest);
        }
      }
    } else {
      await refresh($, board, true).catch(() => {});
    }
    return next(e);
  });

  on('tool.run', async ($, e, next) => {
    if (!e.agentId) return next(e);
    const { calls } = board;
    let running = calls.get(e.agentId);
    if (!running) {
      running = new Map();
      calls.set(e.agentId, running);
    }
    const targeted = ['Bash', 'PowerShell'].includes(e.tool) && checkCommand.test(e.command);
    const operation = tools.get(e.tool) || (e.tool.startsWith('mcp__') ? 'Strumento MCP' : e.tool);
    const activity = targeted ? 'Verifica mirata' : operation;
    const operations = board.operations.get(e.agentId) ?? new Set();
    operations.add(activity);
    board.operations.set(e.agentId, operations);
    running.set(e.tool_use_id, activity);
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
    const { Box, Text, Button, Link, Svg } = $.ui.resolve(e);
    const changeView = offset => {
      if (board.artOffset === offset) return;
      board.artOffset = offset;
      $.ui.invalidate('ui.render');
    };
    const { bodyColumns } = e.props;
    board.columns = bodyColumns;
    if (board.artOffset !== null) {
      return drawArtwork({ Box, Text, Button }, bodyColumns, board.artOffset, changeView);
    }
    let logoSource;
    if (Svg && graphicSurfaces.has(e.surface)) {
      board.logoSource ??= $.session.root().then(root => $.fs.read(root + logoPath)).catch(() => null);
      logoSource = await board.logoSource;
    }
    const { tree, page, pageCount } = drawPanel({ Box, Text, Button, Link, Svg }, {
      columns: bodyColumns, rows: e.props.scroll?.bodyRows, cards: board.cards, page: board.page,
      projectTotals: board.totals, logoSource,
      openArtwork: () => changeView(initialArtOffset),
      changePage: index => selectPage($, board, index),
    });
    board.page = page;
    board.pageCount = pageCount;
    return tree;
  });
}
