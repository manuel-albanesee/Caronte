const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

async function run(input, gate, rewrite, env = process.env) {
  const event = JSON.parse(input);
  if (event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash' ||
      typeof event.tool_input?.command !== 'string') {
    throw Error('Expected a Claude Code Bash PreToolUse event.');
  }

  if (isGateGuardDisabled(env)) return {};

  const result = await gate(input);
  if (result !== input) {
    // ECC returns the original input on pass, and a hook result on denial.
    // Keep its decision and diagnostic output intact.
    if (result && typeof result === 'object') return result;
    throw Error('Unexpected ECC GateGuard result.');
  }

  const rtk = rewrite(input);
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

if (require.main === module) {
  Promise.resolve().then(async () => {
    const [, , gatePath, rtkPath] = process.argv;
    const gate = require(gatePath);
    const result = await run(fs.readFileSync(0, 'utf8'), gate.run, input =>
      spawnSync(rtkPath, ['hook', 'claude'], {
        input,
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

module.exports = { run, isGateGuardDisabled };
