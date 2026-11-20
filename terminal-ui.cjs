const phases = 7;

async function showLogo(output = process.stderr) {
  if (!output.isTTY) return;
  const { wordmarkRows, githubProfile } = await import('./.claude/skills/caronte-panel/hooks/wordmark.js');
  const columns = Math.max(1, (output.columns || 80) - 2);
  const colorEnabled = !Object.hasOwn(process.env, 'NO_COLOR') && process.env.TERM !== 'dumb';
  const art = wordmarkRows(columns).map(row => '  ' + row.map(({ text, color }) => {
    if (!colorEnabled || !text.trim()) return text;
    const rgb = color.slice(1).match(/../g).map(channel => parseInt(channel, 16)).join(';');
    return '\x1b[38;2;' + rgb + 'm' + text + '\x1b[39m';
  }).join('')).join('\n');
  const profile = '\x1b]8;;' + githubProfile + '\x1b\\' + githubProfile + '\x1b]8;;\x1b\\';
  output.write('\n' + art + '\n  ' + profile + '\n\n');
}

function installationProgress() {
  const interactive = Boolean(process.stderr.isTTY);
  let completed = 0;
  const report = (message, phase, component, percent) => {
    if (phase !== undefined) completed = Math.max(completed, phase);
    const bar = '='.repeat(completed) + '-'.repeat(phases - completed);
    const prefix = interactive ? '[' + bar + '] ' + completed + '/' + phases + ' | ' : '';
    const filled = Math.floor((percent ?? 0) / 10);
    const detail = component ? '[' + '='.repeat(filled) + '-'.repeat(10 - filled) + '] ' + component + ' ' + percent + '% | ' : '';
    process.stderr.write('Caronte | ' + (interactive && detail ? detail : prefix) + message + '\n');
  };
  report.interactive = interactive;
  return report;
}

module.exports = { showLogo, installationProgress };
