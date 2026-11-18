const fs = require('node:fs');
const { enforceWorker } = require('../routing/delivery.cjs');

try {
  const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  enforceWorker(process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd(), event);
} catch (error) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: error.message,
  } }));
}
