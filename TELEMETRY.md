# Local telemetry

Local telemetry is **on by default at the first Claude Code startup or resume**
with Caronte in a Git worktree. Claude Code displays a notice when collection
is active. **Run `/caronte-telemetry-off` to stop it for this worktree.**
The choice survives restarts and Caronte updates. Run `/caronte-telemetry-on`
to enable it again.
These are user-invoked skills with a fixed local command. If your environment
blocks skill shell execution, use the corresponding command from the Git root.

```sh
node .claude/routing/telemetry.cjs on
node .claude/routing/telemetry.cjs off
node .claude/routing/telemetry.cjs status
node .claude/routing/telemetry.cjs report 7
node .claude/routing/telemetry.cjs purge
```

`off` keeps existing data available locally. `purge` turns telemetry off and
deletes its event files. The report accepts 1–30 days. Event files live under
`caronte-telemetry/` in the worktree's Git metadata directory. The collector
keeps up to 2 MiB per UTC day and cleans up days older than the 30-day window
during collection, reporting or a mode change. An inactive worktree has no
background cleanup process.

## What we collect

| Source | Fields retained |
| --- | --- |
| Caronte and Claude Code tool hooks | Time, tool type, outcome, predefined reason code, bundled agent role and worktree-local keyed fingerprints. Tool inputs are used in memory for fingerprints. |
| Caronte delivery checks | Outcome, duration, number of scoped checks, keyed plan and input-tree fingerprints. A review counts only when an active plan changed files. A passing receipt does not prove the review was accepted. |
| Claude Code transcript usage | After a session or subagent stops, a bounded local scan reads the tail of the relevant transcript and extracts recorded model and input, output, cache-read and cache-write counts from API assistant messages. Message IDs are deduplicated. |

The collector stores no prompt, code, file path, credential, shell command,
tool output, raw transcript, or account identifier. Fingerprints are keyed
with local random data. They stay within the worktree and are pseudonymous,
not anonymous. Caronte telemetry has no telemetry server or network exporter
and does not change Claude Code's own telemetry settings. The GitHub update
checks already present in Caronte are a separate feature.

## How to read the report

- **Retry candidates** are distinct tool calls in the same session and actor
  with the same operation fingerprint and failure reason within 15 minutes.
  A successful edit or write starts a new comparison window. Shell side effects
  and other state outside the observed hooks can still change an operation's
  meaning. Treat candidates as leads for review, not proven waste.
- **Usage coverage** compares observed sessions with sessions for which the
  collector found compatible recorded usage. A missing hook, interrupted
  session, a transcript format change, and the scan bounds can leave gaps.
  A missing usage sample is `null`, rather than zero tokens.
- **Usage counts** describe recorded API calls. They are not billing figures
  or an estimate of wasted tokens. The report does not infer token attribution
  for an individual blocked operation.
- The worker's ordinary test result is reported as a targeted check. Running a
  check again after editing code is part of a normal delivery workflow.

See [Claude Code hooks](https://code.claude.com/docs/en/hooks) for the documented
transcript paths and the [Claude Code monitoring reference](https://code.claude.com/docs/en/monitoring-usage)
for the meaning of the token categories. We test transcript usage support
against the CLI format. Collection does not require OpenTelemetry.
