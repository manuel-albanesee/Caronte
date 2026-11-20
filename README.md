# Caronte

**Delegate to Claude Code with confidence. Accept only what the Git diff proves.**

Caronte is an orchestration and verification kit for Claude Code. It installs into a single project and turns "the agent says it's done" into something you can check.

## The problem

AI agents write code fast. Trusting the result is the slow part.

- A worker reports "done", but were the tests actually run on the files it changed?
- A brief gives the worker too little context, or so much that it burns tokens re-reading the repo.
- Build and test logs flood the conversation.
- Long tasks die with the session.

## What Caronte does

- **Brief validation.** Every delegation must carry the same sections (goal, input, facts, constraints, output, verification) before an agent starts. A hook rejects incomplete briefs.
- **Model routing.** Read-only research goes to Haiku, bounded implementation to Haiku or Sonnet, high-impact decisions to Opus. Each profile declares its model and its tools, so a researcher cannot edit files.
- **Delivery by diff, not by report.** The orchestrator records a Git baseline and a test plan first. The worker runs only the targeted tests from that plan and produces a test receipt. The orchestrator then reads the real diff, checks the receipt against the current files and only after that runs the full suite.
- **GateGuard integration.** Destructive or unexplained actions are blocked until the agent states what it will do and why. Shell output is filtered at the source through RTK.
- **ICM runs.** Multi-stage work is resumable: a manifest, a gate before each stage and a check after its outputs, so a new session can restart from the last valid evidence.
- **Subagent panel.** A sidebar shows what each subagent is doing, with token and cost totals.
- **Local telemetry.** `node .claude/routing/telemetry.cjs dashboard` shows where time and tokens went.

## How a delegation runs

1. Brief, validated by a hook.
2. Baseline and test plan: exact files, only the relevant tests.
3. Worker executes and runs the targeted check.
4. Orchestrator reads the diff and the test receipt.
5. Full suite runs once, after review.

## Install

Requires Node.js 22+, Claude Code 2.1.327+ and Python 3.11+ for the ICM scripts.

```bash
npm link                      # from the cloned repo
caronte install-project --dry-run
caronte install-project --verify
caronte start
```

An alternative is `node install.cjs "<project-root>" --dry-run`. Tests: `node --test tests/*.test.cjs`.

## Status

Version 2.4.0. The suite was validated on Linux with Claude Code 2.1.327 and a simulated API. The native Windows path (Git Bash and PowerShell) and a trial with other developers are still to do.

## License

Source-available (Caronte Source-Available License v2.0), not open source. Commercial use inside a paid product needs a separate license. Bundled third-party components are MIT.

## Built with

Node.js (CommonJS hooks and CLI), Python (ICM scripts), Claude Code hooks and subagents, ECC, Headroom, RTK, `node:test`.
