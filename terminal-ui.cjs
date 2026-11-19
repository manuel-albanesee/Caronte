const phases = 7;

async function showLogo() {
  if (!process.stderr.isTTY) return;
  const { fitArtwork } = await import('./.claude/skills/caronte-panel/hooks/view.js');
  const columns = Math.min(44, process.stderr.columns || 44);
  process.stderr.write('\n' + fitArtwork(columns, 11).map(row => '  ' + row.trimEnd()).join('\n') + '\n  CARONTE\n\n');
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
