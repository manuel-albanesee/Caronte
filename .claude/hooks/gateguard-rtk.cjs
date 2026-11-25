const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// PreToolUse su Bash e PowerShell. Bash: GateGuard ECC (se attivo) e poi la riscrittura RTK.
// PowerShell: solo la riscrittura RTK (GateGuard valuta eventi Bash). RTK è obbligatorio:
// l'opt-out di GateGuard non lo salta, RTK_DISABLED e un binario irraggiungibile negano il comando.
function deny(reason) {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }) };
}

async function run(input, gate, rewrite, env = process.env) {
  const event = JSON.parse(input);
  if (event.hook_event_name !== 'PreToolUse' || !['Bash', 'PowerShell'].includes(event.tool_name) ||
      typeof event.tool_input?.command !== 'string') {
    throw Error('Expected a Claude Code Bash or PowerShell PreToolUse event.');
  }
  if (isRtkDisabled(env)) {
    return deny('RTK è obbligatorio in Caronte: rimuovi RTK_DISABLED dall’ambiente della sessione. Per l’output esatto di un comando usa `rtk proxy <comando>`.');
  }

  if (event.tool_name === 'Bash' && !isGateGuardDisabled(env)) {
    const result = await gate(input);
    if (result !== input) {
      // ECC returns the original input on pass, and a hook result on denial.
      // Keep its decision and diagnostic output intact.
      if (result && typeof result === 'object') return result;
      throw Error('Unexpected ECC GateGuard result.');
    }
  }

  const rtk = rewrite(input);
  if (rtk.error) {
    return deny('RTK non raggiungibile (' + (rtk.error.code || rtk.error.message) + '). RTK è obbligatorio: esegui caronte update o caronte install-project nella root del progetto.');
  }
  if (rtk.status !== 0 || !rtk.stdout?.trim()) return {};
  const output = JSON.parse(rtk.stdout).hookSpecificOutput;
  const command = output?.updatedInput?.command;
  if (output?.hookEventName !== 'PreToolUse' || typeof command !== 'string' ||
      !command || command === event.tool_input.command) return {};

  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { ...event.tool_input, command },
      },
    }),
  };
}

function isGateGuardDisabled(env = process.env) {
  const value = String(env.ECC_GATEGUARD || '').trim().toLowerCase();
  return String(env.GATEGUARD_DISABLED || '').trim() === '1' ||
    ['0', 'false', 'off', 'disabled', 'disable'].includes(value);
}

function isRtkDisabled(env = process.env) {
  const value = String(env.RTK_DISABLED || '').trim().toLowerCase();
  return Boolean(value) && !['0', 'false', 'off', 'no'].includes(value);
}

if (require.main === module) {
  Promise.resolve().then(async () => {
    const [, , gatePath, rtkPath] = process.argv;
    const input = fs.readFileSync(0, 'utf8');
    // GateGuard si carica solo quando run lo invoca (Bash con GateGuard attivo); un percorso vuoto indica GateGuard non configurato.
    const gate = text => gatePath ? require(gatePath).run(text) : text;
    const env = { ...process.env };
    delete env.RTK_DISABLED;
    const result = await run(input, gate, text =>
      spawnSync(rtkPath, ['hook', 'claude'], {
        input: text,
        env,
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      }));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode ?? 0;
  }).catch(error => {
    process.stderr.write('Caronte GateGuard/RTK: ' + error.message + '\n');
    process.exitCode = 2;
  });
}

module.exports = { run, isGateGuardDisabled, isRtkDisabled };
