const fs = require('node:fs');
const { filterBuildOutput } = require('../routing/build-output.cjs');
const { toolEvent, collectUsage } = require('../routing/telemetry.cjs');
try {
  const event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  switch (event.hook_event_name) {
    case 'PostToolUse': {
      const filtered = process.env.CARONTE_FILTER_BUILD_OUTPUT === '0' ? null : filterBuildOutput(event);
      if (filtered) process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: filtered.output },
      }));
      toolEvent(root, event, 'ok', undefined, filtered?.metrics);
      break;
    }
    case 'PostToolUseFailure': toolEvent(root, event, 'failed', 'tool_failure'); break;
    case 'PermissionDenied': toolEvent(root, event, 'blocked', 'permission_denied'); break;
    case 'SessionEnd':
    case 'SubagentStop': collectUsage(root, event); break;
  }
} catch {
  // Keep the original result if the hook cannot handle it.
}
