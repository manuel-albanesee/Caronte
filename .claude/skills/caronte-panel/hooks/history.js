export const tokenFields = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const safeId = /^[A-Za-z0-9_-]{1,96}$/;
const entryName = /^(turn|card|cost)-[A-Za-z0-9_-]+\.json$/;

export function usageTotals(usage) {
  if (!usage?.length) return null;
  return tokenFields.map(key => usage.reduce((sum, model) => {
    const value = model[key];
    return sum + (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  }, 0));
}

export function sessionCost(cost) {
  return Number.isFinite(cost?.usd) && cost.usd >= 0 ? cost.usd : null;
}

export async function historyDirectory($, root) {
  const repo = await $.session.repo().catch(() => null);
  const git = await $.fs.stat((repo?.root ?? root) + '/.git', { resolve: true }).catch(() => null);
  if (git?.kind === 'dir' && git.realPath) return git.realPath + '/caronte-sidebar';
  const { transcriptPath } = await $.session.info().catch(() => ({}));
  return transcriptPath ? transcriptPath.replace(/[^/\\]+$/, 'caronte-sidebar') : null;
}

export async function saveRecord($, history, kind, identifier, record) {
  if (!history || !safeId.test(identifier ?? '')) return;
  const key = kind + '-' + history.session + (kind === 'cost' ? '' : '-' + identifier) + '.json';
  const content = JSON.stringify(record);
  if (history.saved.get(key) === content) return;
  const previous = history.writing.get(key);
  const write = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
    await $.fs.write(history.directory + '/' + key, content);
    history.saved.set(key, content);
    history.entries.delete(key);
  });
  history.writing.set(key, write);
  try { await write; }
  finally {
    if (history.writing.get(key) === write) history.writing.delete(key);
  }
}

export function createHistory(directory, session) {
  if (!directory || !safeId.test(session ?? '')) return null;
  return { directory, session, entries: new Map(), saved: new Map(), writing: new Map(), cost: null, readAt: 0 };
}

export async function readHistory($, history) {
  const cards = [];
  const tokens = tokenFields.map(() => 0);
  const costs = new Map();
  if (history) {
    const entries = await $.fs.list(history.directory).catch(() => []);
    const files = entries.filter(entry => entry.kind === 'file' && !entry.isLink &&
      entry.size <= 8192 && entryName.test(entry.name));
    const current = new Map();
    for (let index = 0; index < files.length; index += 32) {
      await Promise.all(files.slice(index, index + 32).map(async file => {
        const stamp = file.mtimeMs + ':' + file.size;
        const cached = history.entries.get(file.name);
        if (cached?.stamp === stamp && cached.data) {
          current.set(file.name, cached);
          return;
        }
        try {
          const data = JSON.parse(await $.fs.read(history.directory + '/' + file.name));
          current.set(file.name, { stamp, data });
        } catch {
          // A writer in another session may still be finishing this record.
          if (cached?.data) current.set(file.name, cached);
        }
      }));
    }
    history.entries = current;
    for (const [key, { data }] of current) {
      if (!data || !safeId.test(data.session ?? '')) continue;
      if (key.startsWith('card-') && Number.isSafeInteger(data.card?.recordedAt) &&
          data.card.recordedAt > 0 && data.card.recordedAt <= 8.64e15) {
        cards.push({ ...data.card, session: data.session });
      }
      if (key.startsWith('turn-') && Array.isArray(data.tokens) && data.tokens.length === tokens.length) {
        for (const [index, count] of data.tokens.entries()) {
          if (Number.isSafeInteger(count) && count >= 0) tokens[index] += count;
        }
      }
      if (Number.isFinite(data.usd) && data.usd >= 0) {
        costs.set(data.session, Math.max(costs.get(data.session) ?? 0, data.usd));
      }
    }
  }
  const usd = costs.size ? [...costs.values()].reduce((sum, cost) => sum + cost, 0) : null;
  return { cards, tokens, usd, liveCost: costs.get(history?.session) ?? null };
}
