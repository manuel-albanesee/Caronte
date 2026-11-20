import { ferryman, ferrymanWidth } from './ferryman.js';
import { tokenFields, usageTotals } from './history.js';
import { githubProfile, wordmarkRows } from './wordmark.js';

const aqua = '#74E4D9';
const ink = '#EFF7FC';
const muted = '#9EB5C2';
const dim = '#54717C';
const red = '#FF9B99';
const good = '#A8EAA2';
const warm = '#FFCA80';
const background = '#000000';
const number = new Intl.NumberFormat('it-IT');
const dollars = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const date = new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const checkLabels = {
  pass: 'Test mirati passati',
  fail: 'Test mirati da correggere',
  stale: 'Test da rieseguire',
  'not-run': 'Test mirati da eseguire',
};

const statuses = new Map([
  ['pending', ['○ In coda', warm]],
  ['running', ['● Attivo', aqua]],
  ['waiting', ['◷ In attesa', warm]],
  ['idle', ['◷ Disponibile', muted]],
  ['completed', ['✓ Concluso', good]],
  ['failed', ['× Fallito', red]],
  ['killed', ['■ Interrotto', red]],
]);

export const isActive = status => ['pending', 'running', 'waiting'].includes(status);

function label(value) {
  return String(value ?? '').slice(0, 160).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ').trim();
}

export function combineUsage(previous = [], usage) {
  const sum = usageTotals([...previous, usage]);
  return [Object.fromEntries(tokenFields.map((field, index) => [field, sum[index]]))];
}

function checkpoints(plan) {
  if (!plan) return null;
  const total = plan.tests ? 3 : 2;
  const done = 1 + Number(plan.tests > 0 && plan.checks === 'pass') + Number(!!plan.reviewed);
  return { done, total, percent: Math.floor(done * 100 / total), tests: plan.tests, checks: plan.checks };
}

export function agentCards(agents, calls, plans, operations = new Map()) {
  return agents.map(agent => ({
    id: agent.id,
    status: agent.status,
    start: agent.startTime,
    profile: label(agent.type) || 'Subagent',
    task: label(agent.description),
    activity: label([...calls.get(agent.id)?.values() ?? []].at(-1) ||
      (agent.label !== agent.description ? agent.label : '')),
    model: label(agent.model).replace(/^claude-/, '').replace(/-\d{8}$/, ''),
    usage: usageTotals(agent.usage),
    operations: [...operations.get(agent.id) ?? []].map(label),
    progress: checkpoints(plans.get(agent.id)),
  })).sort((a, b) => Number(isActive(b.status)) - Number(isActive(a.status)) || b.start - a.start);
}

function statsLines(cards, line, rule) {
  const gap = line(' ');
  const children = [];
  if (!cards.length) return [line('In attesa di una delega', muted)];

  for (const card of cards) {
    const [status, color] = statuses.get(card.status) || ['○ Stato in aggiornamento', muted];
    const when = card.recordedAt ? ' · ' + date.format(card.recordedAt) : '';
    children.push(gap, line(status + when, color, true));
    children.push(line(card.profile + (card.model ? ' · ' + card.model : ''), aqua, true));
    if (card.task) children.push(line(card.task));
    if (card.activity && isActive(card.status)) children.push(line('› ' + card.activity, muted));
    if (card.recordedAt) {
      for (const operation of card.operations ?? []) children.push(line('› ' + operation, muted));
    }
    if (card.progress) {
      const { done, total, percent, tests, checks } = card.progress;
      const filled = Math.floor(done * 10 / total);
      const bar = '━'.repeat(filled) + '─'.repeat(10 - filled);
      children.push(line(`${bar} ${percent}% · ${done}/${total}`, percent === 100 ? good : warm));
      const detail = percent === 100 ? (tests ? 'Test passati · diff rivisto' : 'Diff rivisto') :
        (tests ? checkLabels[checks] || 'Test mirati da eseguire' : 'In attesa di revisione del diff');
      children.push(line(detail,
        ['fail', 'stale'].includes(checks) ? red : muted));
    } else {
      children.push(line('Avanzamento —', muted));
    }
    if (card.usage) {
      const [input, output, read, write] = card.usage.map(value => number.format(value));
      children.push(line(`In ${input}   Out ${output}`, ink));
      children.push(line(`Cache ↓ ${read}   ↑ ${write}`, muted));
    } else {
      children.push(line('Token —', muted));
    }
    children.push(rule);
  }

  return children;
}

function drawWordmark(Text, width, height) {
  const art = wordmarkRows(width, height);
  const artWidth = Math.max(...art.map(row => row.reduce((length, part) => length + part.text.length, 0)));
  const margin = Math.floor((width - artWidth) / 2);
  const top = Math.floor((height - art.length) / 2);
  return Array.from({ length: height }, (_, index) => Text({
    wrap: 'truncate-end',
    children: [' '.repeat(margin), ...(art[index - top] ?? []).map(part =>
      Text({ color: part.color, children: [part.text] }))],
  }));
}

export function drawPanel({ Box, Text, Button, Link, Svg }, {
  columns, rows, cards, page, openArtwork, changePage, logoSource, projectTotals = { tokens: [0, 0, 0, 0], usd: null },
}) {
  const width = Math.max(1, (columns || 40) - 2);
  const bodyRows = Math.max(1, rows || 16);
  const logoRows = Math.round(bodyRows * 0.2);
  const footerRows = Math.round(bodyRows * 0.2);
  const statsRows = bodyRows - logoRows - footerRows;
  const artRows = Math.max(0, logoRows - 1 - Number(logoRows > 2));
  const line = (value, color = ink, bold = false) => Text({
    color, weight: bold ? 'bold' : 'regular', wrap: 'truncate-end', children: [value],
  });
  const rule = line('─'.repeat(width), dim);
  const logo = [];
  if (artRows && logoSource && Svg) {
    logo.push(Svg({
      key: 'ferryman-svg', source: logoSource, alt: 'Traghettatore di Caronte',
      width: width * 8, height: artRows * 16,
    }));
  } else if (artRows) {
    logo.push(...drawWordmark(Text, width, artRows));
  }
  if (logoRows) logo.push(Link({ href: githubProfile }));
  if (logoRows > 2) logo.push(rule);
  const children = [Box({ key: 'logo', flexDirection: 'column', height: logoRows, children: logo })];

  const count = cards.filter(card => isActive(card.status)).length;
  const header = `SUBAGENT ${count}/${cards.length}` + (width >= 31 ? ' attivi' : '');
  const details = statsLines(cards, line, line('─'.repeat(Math.min(46, width)), dim));
  const paginate = statsRows > 2 && details.length > statsRows - 1;
  const pageSize = statsRows - (paginate ? 2 : 1);
  const pageCount = paginate ? Math.ceil(details.length / pageSize) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const visibleDetails = details.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const metrics = [Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
    line(header, aqua, true),
    ...(width >= 23 ? [Button({ key: 'open-art', label: 'ASCII', onPress: openArtwork })] : []),
  ] })];
  if (paginate) {
    metrics.push(
      Box({ flexDirection: 'column', height: pageSize, children: visibleDetails }),
      Box({ flexDirection: 'row', justifyContent: 'center', gap: 1, children: [
        Button({ key: 'stats-prev', label: '↑', dimColor: currentPage === 0, onPress: () => changePage(currentPage - 1) }),
        line(`${currentPage + 1}/${pageCount}`, muted),
        Button({ key: 'stats-next', label: '↓', dimColor: currentPage === pageCount - 1, onPress: () => changePage(currentPage + 1) }),
      ] }),
    );
  } else {
    metrics.push(...visibleDetails);
  }
  children.push(Box({ key: 'metrics', flexDirection: 'column', height: statsRows, children: metrics }));
  const [input, output, read, write] = projectTotals.tokens.map(value => number.format(value));
  const amount = projectTotals.usd === null ? '—' : '$' + dollars.format(projectTotals.usd);
  const cost = line(width >= 30 ? `Progetto · costo stim. ${amount}` : `Costo stim. ${amount}`, warm, true);
  const inOut = line(`In ${input}  Out ${output}`);
  const cache = line(`Cache ↓ ${read}  ↑ ${write}`);
  const footer = footerRows >= 6 ? [
    rule, cost, line(`Input        ${input}`), line(`Output       ${output}`),
    line(`Cache read   ${read}`), line(`Cache write  ${write}`),
  ] : footerRows >= 3 ? [
    ...(footerRows > 3 ? [rule] : []), cost, inOut, cache,
  ] : [cost, line(`In ${input} Out ${output} ↓ ${read} ↑ ${write}`)].slice(0, footerRows);
  children.push(Box({ key: 'totals', flexDirection: 'column', justifyContent: 'flex-end', height: footerRows, children: footer }));
  const tree = Box({ flexDirection: 'column', paddingX: 1, backgroundColor: background, children });
  return { tree, page: currentPage, pageCount };
}

export function artworkWindow(columns, offset) {
  const width = Math.min(ferrymanWidth, Math.max(1, (columns || 40) - 2));
  const last = ferrymanWidth - width;
  const start = Math.min(last, Math.max(0, offset));
  const step = Math.max(1, width - 4);
  return {
    start, end: start + width, width, last,
    left: Math.max(0, start - step), right: Math.min(last, start + step),
  };
}

export function drawArtwork({ Box, Text, Button }, columns, offset, changeView) {
  const { start, end, width, last, left, right } = artworkWindow(columns, offset);
  const children = [
    Button({ key: 'close-art', label: 'Subagent', onPress: () => changeView(null) }),
  ];
  if (last) {
    children.push(Box({ flexDirection: 'row', gap: 1, children: [
      Button({
        key: 'art-left', label: '←', dimColor: start === 0,
        onPress: () => changeView(left),
      }),
      Button({
        key: 'art-right', label: '→', dimColor: start === last,
        onPress: () => changeView(right),
      }),
      Text({ color: muted, wrap: 'truncate-end', children: [`${start + 1}–${end}/${ferrymanWidth}`] }),
    ] }));
  }
  for (const row of ferryman) {
    children.push(Text({ color: warm, wrap: 'truncate-end', children: [row.slice(start, end).padEnd(width)] }));
  }
  return Box({ flexDirection: 'column', paddingX: 1, backgroundColor: background, children });
}
