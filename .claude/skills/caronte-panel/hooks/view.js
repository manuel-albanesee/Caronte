// Terminal-size variants of the full ASCII artwork in README.md.
const emblems = [
  { width: 38, rows: [
    "                     :+%@%+:",
    "                  ::-*%@%++*:",
    "               :+*%%%@@#.*%-  -=.",
    "            .-#%**%@@@@@*#=:::%#.",
    "    .-+***##%%=-#@@##@@@@@#++%-",
    "   :====+####==##**:%@@@#++%@=   :=++:",
    "      -+#%%@#:++*##+-===+:+#-    .:%@:",
    " .:=*@@@@@@%:+%@@@@%---%#          #%",
    " :::::=+*%%*%@@@@#==#@@@@*:      .*@%",
    ".    :+#@@%@@@@*--*@@%%%%%#..:-+#@@@+",
    "+%#######*##*--=*#####**###%%@@@@@@*",
    " +@@@%%%@%+-.=%@@@@@@@@@@@@@@@@@@#-",
    "  -==++=.   =#*+==+++++**####*+=:",
    "     :==--:=+-....::--==--:..",
  ] },
  { width: 22, rows: [
    "          ..=%#+.",
    "       .-+#%@%*+.=-",
    "  .-+*##+*#*@@#*#-..::",
    " .-+#%%=*%%==*-::   #+",
    ":.:=#%%%%**#%%#: :-*@-",
    "=###%*+=*##%%%@@@@@%-",
    " :-==::==--=++++=-:",
  ] },
  { width: 12, rows: [
    "     :=%=.",
    " .-==#@%*=..",
    " -#%##+*- .*",
    "-+####%%++#=",
    "-++:=++***-",
  ] },
];
const aqua = '#74E4D9';
const ink = '#EFF7FC';
const muted = '#9EB5C2';
const dim = '#54717C';
const red = '#FF9B99';
const good = '#A8EAA2';
const warm = '#FFCA80';

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
const tokenFields = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

function label(value) {
  return String(value ?? '').slice(0, 160).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ').trim();
}

function totals(usage) {
  if (!usage?.length) return null;
  return tokenFields.map(key => usage.reduce((sum, model) => sum + (model[key] ?? 0), 0));
}

export function combineUsage(previous = [], usage) {
  const sum = totals([...previous, usage]);
  return [Object.fromEntries(tokenFields.map((field, index) => [field, sum[index]]))];
}

function checkpoints(plan) {
  if (!plan) return null;
  const total = plan.tests ? 3 : 2;
  const done = 1 + Number(plan.tests > 0 && plan.checks === 'pass') + Number(!!plan.reviewed);
  return { done, total, percent: Math.floor(done * 100 / total), tests: plan.tests, checks: plan.checks };
}

export function agentCards(agents, calls, plans) {
  return agents.map(agent => ({
    id: agent.id,
    status: agent.status,
    start: agent.startTime,
    profile: label(agent.type) || 'Subagent',
    task: label(agent.description),
    activity: label([...calls.get(agent.id)?.values() ?? []].at(-1) ||
      (agent.label !== agent.description ? agent.label : '')),
    model: label(agent.model).replace(/^claude-/, '').replace(/-\d{8}$/, ''),
    usage: totals(agent.usage),
    progress: checkpoints(plans.get(agent.id)),
  })).sort((a, b) => Number(isActive(b.status)) - Number(isActive(a.status)) || b.start - a.start);
}

export function drawPanel(Box, Text, columns, cards, inline = false) {
  const width = Math.max(12, Math.min(46, (columns || 38) - 2));
  const line = (value, color = ink, bold = false) => Text({
    color, weight: bold ? 'bold' : 'regular', wrap: 'truncate-end', children: [value],
  });
  const rule = line('─'.repeat(width), dim);
  const gap = line(' ');
  const emblemWidth = inline ? Math.min(width, 22) : width;
  const emblem = emblems.find(art => art.width <= emblemWidth);
  const indent = ' '.repeat(Math.floor((width - emblem.width) / 2));
  const count = cards.filter(card => isActive(card.status)).length;
  const number = new Intl.NumberFormat('it-IT');
  const checkLabels = {
    pass: 'Test mirati passati',
    fail: 'Test mirati da correggere',
    stale: 'Test da rieseguire',
    'not-run': 'Test mirati da eseguire',
  };

  const children = [
    ...emblem.rows.map(row => line(indent + row, warm, true)),
    line(`SUBAGENT   ${count}/${cards.length} attivi`, aqua, true),
  ];
  if (!cards.length) children.push(gap, line('In attesa di una delega', muted));

  for (const card of cards) {
    const [status, color] = statuses.get(card.status) || ['○ Stato in aggiornamento', muted];
    children.push(gap, line(status, color, true));
    children.push(line(card.profile + (card.model ? ' · ' + card.model : ''), aqua, true));
    if (card.task) children.push(line(card.task));
    if (card.activity && isActive(card.status)) children.push(line('› ' + card.activity, muted));
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

  return Box({ flexDirection: 'column', paddingX: 1, children });
}
