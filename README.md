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
- **Model routing.** Read-only research goes to Haiku, bounded implementation to Haiku or Sonnet, high-impact decisions to Opus. Each profile declares its model and its tools, so a researcher cannot edit files. A delegation policy (`.claude/routing/policy.json`) makes this binding: every brief names its work class, any installed agent (kit, user, ECC plugin or built-in) is accepted when its model stays within the class ceiling, going above the ceiling or the agent's own model needs a stated escalation reason (a failed ICM check receipt counts), and per-turn limits push the coordinator to delegate instead of reading and editing large amounts itself.
- **Delivery by diff, not by report.** The orchestrator records a Git baseline and a test plan first. The worker runs only the targeted tests from that plan and produces a test receipt. The orchestrator then reads the real diff, checks the receipt against the current files and only after that runs the full suite.
- **GateGuard integration.** Destructive or unexplained actions are blocked until the agent states what it will do and why. Shell output is filtered at the source through RTK.
- **ICM runs.** Multi-stage work is resumable: a manifest, a gate before each stage and a check after its outputs, so a new session can restart from the last valid evidence. The native `TaskCreated` and `TaskCompleted` hooks tie the task bar to it: a task marked `[ICM:<run.json>/<stage>]` is rejected if the run or stage does not exist, and cannot be completed until the stage has a valid check receipt.
- **Skill retrieval.** [FastSkillRetrieval](https://github.com/manuel-albanesee/FastSkillRetrieval) indexes every installed skill, agent and command. Caronte reads that local BM25 index in a few milliseconds and suggests the relevant ECC tools for a delegation, instead of loading the whole catalogue into the context. The index builds itself in the background at session start and refreshes only when something changed.
- **Subagent panel.** A sidebar shows what each subagent is doing, with token and cost totals.
- **Local telemetry.** `node .claude/routing/telemetry.cjs dashboard` shows where time and tokens went.

## How a delegation runs

1. Brief, validated by a hook.
2. Baseline and test plan: exact files, only the relevant tests.
3. Worker executes and runs the targeted check.
4. Orchestrator reads the diff and the test receipt.
5. Full suite runs once, after review.

## Install

Requires Node.js 22+, Claude Code 2.1.327+ and Python 3.11+ for the ICM scripts. FastSkillRetrieval is mandatory and needs Python 3.13; an install without it is reported as incomplete.

```bash
npm link                      # from the cloned repo
caronte install-project --dry-run
caronte install-project --verify
caronte start
caronte update                # in an installed project: kit from the local clone + dependency updates
```

Each install fetches ECC, Headroom, RTK and FastSkillRetrieval from their official repositories (FastSkillRetrieval at a pinned base commit). Their local data lives in the project's `.caronte/` folder, ignored by Git: `.caronte/.fsr` (FastSkillRetrieval venv and index), `.caronte/.headroom` (Headroom runtime, workspace and config) and `.caronte/.rtk` (RTK config, databases, tee and audit; the binary stays with its package manager). `caronte update`, run from the project root with no session open, applies the committed revision of the local Caronte clone and updates ECC, RTK, FastSkillRetrieval and the project Headroom runtime: stable releases (FastSkillRetrieval has none, so it follows its default branch, forward only), never across a major version, and the previous copy stays in use if anything fails. At session start ECC and RTK update by themselves; FastSkillRetrieval and Headroom are only reported. Routing, ICM, RTK and FastSkillRetrieval are mandatory and cannot be switched off: every delegation needs a complete brief with `ROUTING`, `ECC_QUERY` and the FSR tools in `ECC_TOOLS`; every write delegation belongs to an ICM stage; `general-purpose` is denied when a specialist covers the class; Bash and PowerShell always go through RTK. `CARONTE_SKILL_INDEX` can still point to another index folder.

An alternative is `node install.cjs "<project-root>" --dry-run`. Tests: `node --test tests/*.test.cjs`.

## Status

Version 2.4.0. The suite was validated on Linux with Claude Code 2.1.327 and a simulated API. The native Windows path (Git Bash and PowerShell) and a trial with other developers are still to do.

## License

Source-available (Caronte Source-Available License v2.0), not open source. Commercial use inside a paid product needs a separate license. Bundled third-party components are MIT.

## Built with

Node.js (CommonJS hooks and CLI), Python (ICM scripts), Claude Code hooks and subagents, ECC, Headroom, RTK, FastSkillRetrieval, `node:test`.

## Technical documentation

The full technical reference (architecture, commands, configuration) is in [TECHNICAL.md](TECHNICAL.md).
