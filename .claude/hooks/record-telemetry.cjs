const fs = require('node:fs');
const { toolEvent, collectUsage } = require('../routing/telemetry.cjs');
try {
  const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  switch (event.hook_event_name) {
    case 'PostToolUse': toolEvent(root, event, 'ok'); break;
    case 'PostToolUseFailure': toolEvent(root, event, 'failed', 'tool_failure'); break;
    case 'PermissionDenied': toolEvent(root, event, 'blocked', 'permission_denied'); break;
    case 'SessionEnd':
    case 'SubagentStop': collectUsage(root, event); break;
  }
} catch {
  // No output and no control of tool execution.
}
