# Local telemetry

Local telemetry is **on by default at the first Claude Code startup or resume**
with Caronte in a Git worktree. Claude Code displays a notice when collection
is active. **Run `/caronte-telemetry-off` to stop it for this worktree.**
The choice survives restarts and Caronte updates. Run `/caronte-telemetry-on`
to enable it again. The telemetry setting for the worktree where a session
starts also covers subagents in that session, including those with separate
Git worktrees. Sessions started independently use their own worktree setting.
These are user-invoked skills with a fixed local command. If your environment
blocks skill shell execution, use the corresponding command from the Git root.

```sh
node .claude/routing/telemetry.cjs on
node .claude/routing/telemetry.cjs off
node .claude/routing/telemetry.cjs status
node .claude/routing/telemetry.cjs report 7
node .claude/routing/telemetry.cjs dashboard
node .claude/routing/telemetry.cjs purge
```

`off` keeps existing data available locally. `purge` turns telemetry off and
deletes its event files and the generated dashboard. The report accepts 1–30 days. Event files live under
`caronte-telemetry/` in the worktree's Git metadata directory. The collector
keeps up to 2 MiB per UTC day and cleans up days older than the 30-day window
during collection, reporting or a mode change. An inactive worktree has no
background cleanup process.

The `dashboard` command prints the path of an HTML file in the worktree's Git
metadata. Open it in a browser for the 7- and 30-day views. It includes only
aggregates and works offline. Run the command again after new sessions finish
to refresh the snapshot.

The dashboard uses tables for exact counts and a chart of recorded API requests
by UTC day. A dash marks unavailable measurements, including days without
compatible API samples. A displayed zero is an observed count. Filtered bytes
measure how much tool output was omitted.

## What we collect

| Source | Fields retained |
| --- | --- |
| Caronte and Claude Code tool hooks | Time, tool type, outcome, predefined reason code, bundled agent role and worktree-local keyed fingerprints. Tool inputs are used in memory for fingerprints. |
| Test and build output filter | UTF-8 byte counts for the original stdout and the replacement returned to Claude Code, plus the number of lines omitted. |
| Caronte delivery checks | Outcome, duration, number of scoped checks, keyed plan and input-tree fingerprints. A review counts only when an active plan changed files. A passing receipt does not prove the review was accepted. |
| Claude Code transcript usage | After a session or subagent stops, a bounded local scan reads the tail of the relevant transcript and extracts recorded model and input, output, cache-read and cache-write counts from API assistant messages. Message IDs are deduplicated. |
| Text reads after changes | The same scan correlates compatible file-change attachments and successful `Read` results. Only timestamps, keyed event identifiers, categories, line counts, and UTF-8 byte counts are retained. Paths and text are compared in memory. |

The collector stores no prompt, code, file path, credential, shell command,
tool output, raw transcript, or account identifier. Fingerprints are keyed
with local random data. They stay within the worktree and are pseudonymous,
not anonymous. Caronte telemetry has no telemetry server or network exporter
and does not change Claude Code's own telemetry settings. The GitHub update
checks already present in Caronte are a separate feature.

## Test and build output filter

Caronte uses Claude Code's synchronous `PostToolUse` hook to shorten verbose
stdout from successful standalone test and build commands in Bash and
compatible PowerShell responses. It considers stdout of at least 8 KiB and
returns a replacement only when it removes at least 2 KiB. It keeps the
beginning and end of the log, recognized warnings and summaries with
surrounding lines, stderr, and the tool's status fields. Each omitted block
has a visible marker. When Claude Code supplies a `persistedOutputPath`, the
filter leaves that result untouched and the path is the recovery route. For a
filtered result without a saved log path, rerun the same command with
`rtk proxy <command>` if RTK is available, or redirect output to a log file and
inspect that file. Failed runs, structured reports such as TAP or JSON,
background tasks, and results already saved to a file keep their original
output. The filter runs after RTK and also works when telemetry is off.

Use `rtk proxy <command>` when you need the original command's output and RTK
is available. To turn off Caronte's filter for a project, add
`"CARONTE_FILTER_BUILD_OUTPUT": "0"` to the `env` object in
`.claude/settings.local.json` and start a new Claude Code session.

## How to read the report

- **`fileContext`** records one change episode per file and turn when Claude
  logs a compatible change attachment or two successive text reads disagree
  on overlapping lines or total line count. It counts successful text reads
  from that signal until the next user turn or an observed `Edit` or `Write`
  to that file. Full and partial reads use the returned line range. The
  volumes measure the recorded notice snippet and rendered tool result
  respectively. Each includes a sample count indicating available sizes.
- **File context coverage** is limited to the last 8 MiB of each compatible
  transcript at session or subagent shutdown. The scan counts show the
  available coverage for interpreting a zero.
  Disjoint partial reads with the same total line count, changes Claude never
  observes, reads via shell tools, and missing transcript records can leave
  gaps. A change signal cannot establish who wrote the file or its token cost.
- **`outputFilter`** sums filtered calls, stdout bytes before and after the
  replacement, and omitted lines. The difference measures bytes removed
  from the tool result. Claude Code's native tool telemetry can still report
  the original size because it samples before this hook.
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
  for an individual tool call. To measure a token difference, compare two
  sessions with the same command, model, starting context, cache conditions,
  and RTK settings. Change only the filter setting and compare request counts
  and the four token categories under `usage`.
- The worker's ordinary test result is reported as a targeted check. Running a
  check again after editing code is part of a normal delivery workflow.

See [Claude Code hooks](https://code.claude.com/docs/en/hooks) for the documented
transcript paths and the [Claude Code monitoring reference](https://code.claude.com/docs/en/monitoring-usage)
for the meaning of the token categories. We test transcript usage support
against the CLI format. Collection does not require OpenTelemetry.
