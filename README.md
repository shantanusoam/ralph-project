# Vibepup

> Fetch Code. Sit. Stay. Good Pup.

[![npm version](https://badge.fury.io/js/vibepup.svg)](https://badge.fury.io/js/vibepup)
![License](https://img.shields.io/npm/l/vibepup)

Vibepup is a split-brain autonomous coding harness for terminal-first workflows. It keeps human intent in `prd.md`, machine state in `prd.state.json`, and wraps agent loops with safer execution, validation, source ingestion, review gates, and repo-local playbook files.

## What Vibepup Does

- Runs autonomous PLAN and BUILD loops with model fallback.
- Keeps playbook files in the repo: `prd.md`, `repo-map.md`, `IMPLEMENTATION_PLAN.md`, `AGENTS.md`, `specs/`, and `.ralph/run-state.json`.
- Supports validation backpressure with `--validate`.
- Stops bad loops with circuit breakers on repeated failures.
- Imports task context from local files, PDFs, public URLs, and GitHub issue or repo URLs.
- Supports workflow presets such as `feature`, `debug`, `review`, `design`, and `refactor`.
- Can run an automated review pass and optional local git commit after successful iterations.
- Exposes the core surfaces through `vibepup mcp`.

## Install

```bash
npm install -g vibepup
```

Optional:

```bash
bunx vibepup --watch
vibepup --tui
vibepup free
vibepup doctor
```

On Windows, `vibepup` supports both WSL and native mode:

- `vibepup --wsl`
- `vibepup --windows`
- `vibepup --platform=wsl`
- `vibepup --platform=windows`

## Quick Start

Initialize a project playbook:

```bash
mkdir my-app && cd my-app
vibepup init
```

Bootstrap from an idea:

```bash
vibepup new "A React app for tracking plant watering"
```

Run the build loop:

```bash
vibepup run 5
vibepup --watch
```

Import external context before running:

```bash
vibepup fetch ./spec.md
vibepup fetch https://github.com/owner/repo/issues/123
vibepup run --from https://example.com/spec
```

Use safety and workflow features:

```bash
vibepup run --preset feature --validate --review --commit
vibepup run --preset debug --circuit-breaker-failures 2
vibepup plan
vibepup status
vibepup validate
```

## Playbook Files

Vibepup now standardizes a lightweight repo-local playbook:

- `prd.md`: Human-edited checklist.
- `prd.state.json`: Machine-managed task and verification state.
- `repo-map.md`: Architecture and planning memory.
- `IMPLEMENTATION_PLAN.md`: Higher-level execution plan.
- `AGENTS.md`: Validation commands and project conventions.
- `specs/`: Supporting notes and fetched source material.
- `activity.md`: Human-readable iteration log.
- `.ralph/run-state.json`: Latest machine-readable runtime state.

## Commands

- `vibepup init`: Create the playbook files in the current repo.
- `vibepup new "<idea>"`: Ask the architect agent to scaffold the playbook from a raw idea.
- `vibepup run [n]`: Run the autonomous loop.
- `vibepup plan`: Force a planning pass that refreshes architecture memory.
- `vibepup fetch <source>`: Import a local file, PDF, URL, GitHub issue, or GitHub repo README into `specs/`.
- `vibepup validate`: Run the configured validation commands.
- `vibepup status`: Show current phase, task, and last run state.
- `vibepup free`: Install and configure the free-tier OpenCode flow.
- `vibepup doctor`: Diagnose Node, npm, OpenCode, and model availability.
- `vibepup mcp`: Start a local MCP server exposing init, plan, run, status, and validate tools.

## Key Flags

- `--watch`: Keep looping until work is done, then wait for PRD changes.
- `--from <source>`: Import source context before the run.
- `--preset <name>`: Apply a workflow bundle. Available presets: `feature`, `debug`, `review`, `design`, `refactor`.
- `--validate`: Run test/lint/build after each successful BUILD iteration.
- `--review`: Run the reviewer agent against the current diff.
- `--commit`: Commit the current iteration after validation and review pass.
- `--completion-promise <text>`: Customize the explicit completion string.
- `--require-exit-signal`: Require an explicit completion signal or marker file.
- `--circuit-breaker-failures <n>`: Stop after `n` consecutive failed iterations.
- `--circuit-breaker-errors <n>`: Stop after the same failure signature repeats `n` times.

## Configuration

Vibepup's published Node runner is the source of truth. The old `global/ralph` bash engine remains in the repo as a legacy reference, but new features land in `npm-package/lib/runner/index.js`.

Optional config lives at `~/.config/ralph/config.json`:

```json
{
  "build_models": [
    "github-copilot/gpt-5.2-codex",
    "openai/gpt-4o"
  ],
  "plan_models": [
    "github-copilot/claude-opus-4.5"
  ]
}
```

Useful environment variables:

- `RALPH_MODEL_OVERRIDE`
- `RALPH_EXTRA_ARGS`
- `RALPH_MAX_TURN_SECONDS`
- `RALPH_NO_OUTPUT_SECONDS`

## Development

```bash
cd npm-package
npm test
npm run build:tui
npx . --watch
```

TUI development lives in `npm-package/tui`.

## Inspiration

Vibepup now borrows a number of workflow ideas from [`ralph-starter`](https://github.com/multivmlabs/ralph-starter) and the public docs at [ralphstarter.ai](https://ralphstarter.ai/), especially around playbook files, validation backpressure, circuit breakers, source ingestion, and MCP exposure.

## License

MIT
