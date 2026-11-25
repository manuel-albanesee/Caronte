'use strict';
// PreToolUse (Read|Grep|Edit|Write|MultiEdit|NotebookEdit|Skill) e PostToolUse (Agent|Task) del solo thread principale:
// conta letture e modifiche dirette del coordinatore nel turno e, oltre le soglie di policy.json, nega con l'indicazione del profilo a cui delegare.
// Errori interni non bloccano mai (fail open); CARONTE_DELEGATION=off disattiva il controllo.
const fs = require('node:fs');
const policyRules = require('../routing/policy.cjs');
const { toolEvent } = require('../routing/telemetry.cjs');

function run(event, env = process.env) {
  if (!event || event.agent_id) return null;
  const root = env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  let policy;
  try { policy = policyRules.load(root, env); } catch { return null; }
  if (!policy) return null;
  try {
    if (event.hook_event_name === 'PostToolUse') { policyRules.coordinatorPost(policy, root, event); return null; }
    policyRules.coordinatorPre(policy, root, event);
    return null;
  } catch (error) {
    if (!error.reason) return null;
    try { toolEvent(root, event, 'blocked', error.reason); } catch { /* telemetria facoltativa */ }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: error.message } };
  }
}

function main() {
  let event;
  try { event = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '')); } catch { return; }
  const out = run(event);
  if (out) process.stdout.write(JSON.stringify(out));
}
if (require.main === module) main();
module.exports = { run };
