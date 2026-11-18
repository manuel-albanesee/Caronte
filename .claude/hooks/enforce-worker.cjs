const fs = require('node:fs');
const { toolEvent } = require('../routing/telemetry.cjs');
const { enforceWorker } = require('../routing/delivery.cjs');

let event, root;
try {
  event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  enforceWorker(root, event);
} catch (error) {
  if (event && root) {
    const reason = ['Bash', 'PowerShell', 'Monitor', 'Skill'].includes(event.tool_name) ? 'worker_command' : 'worker_scope';
    toolEvent(root, event, 'blocked', reason);
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: error.message,
  } }));
}
