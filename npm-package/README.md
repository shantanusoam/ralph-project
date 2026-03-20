# Vibepup

> Fetch Code. Sit. Stay. Good Pup.

[![npm version](https://badge.fury.io/js/vibepup.svg)](https://badge.fury.io/js/vibepup)
![License](https://img.shields.io/npm/l/vibepup)

Vibepup is a split-brain autonomous coding harness for terminal-first workflows. The published package wraps agent loops with playbook files, validation backpressure, circuit breakers, source ingestion, review gates, and optional MCP exposure.

## Install

```bash
npm install -g vibepup
```

Or run without a global install:

```bash
bunx vibepup --watch
```

## Core Concepts

- `prd.md`: human-edited checklist.
- `prd.state.json`: machine-managed task state.
- `repo-map.md`: architecture memory.
- `IMPLEMENTATION_PLAN.md`: higher-level execution plan.
- `AGENTS.md`: validation commands and conventions.
- `specs/`: imported source material and hand-written specs.
- `activity.md`: human-readable loop history.
- `.ralph/run-state.json`: latest machine-readable status snapshot.

## Common Commands

```bash
vibepup init
vibepup new "Build a note-taking app"
vibepup run 5
vibepup --watch
vibepup plan
vibepup status
vibepup validate
vibepup fetch ./spec.md
vibepup fetch https://github.com/owner/repo/issues/123
vibepup mcp
```

## Workflow Flags

```bash
vibepup run --preset feature --validate
vibepup run --preset review --validate --review --commit
vibepup run --preset debug --circuit-breaker-failures 2
vibepup run --from https://example.com/spec
```

Available presets:

- `feature`
- `debug`
- `review`
- `design`
- `refactor`

Useful flags:

- `--watch`
- `--from <source>`
- `--validate`
- `--review`
- `--commit`
- `--completion-promise <text>`
- `--require-exit-signal`
- `--circuit-breaker-failures <n>`
- `--circuit-breaker-errors <n>`

## Source Ingestion

`vibepup fetch` and `vibepup run --from ...` support:

- local markdown or text files
- local PDFs via best-effort extraction
- public URLs
- GitHub issue URLs
- GitHub repo URLs (imports metadata and README)

Imported content is written into `specs/` and mirrored to `specs/latest-source.md`.

## Configuration

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

Helpful environment variables:

- `RALPH_MODEL_OVERRIDE`
- `RALPH_EXTRA_ARGS`
- `RALPH_MAX_TURN_SECONDS`
- `RALPH_NO_OUTPUT_SECONDS`

## Free Setup

```bash
vibepup doctor
vibepup free
```

This checks Node/npm/OpenCode, installs the free-tier auth helper, and refreshes models.

## TUI

The optional TUI lives in `npm-package/tui` and requires Go 1.22+.

```bash
cd npm-package
npm run build:tui
vibepup --tui
```

## Development

```bash
cd npm-package
npm test
npx . --watch
```

The Node runner in `lib/runner/index.js` is the source of truth. The older bash engine is retained only as legacy reference material in the repo root.

## License

MIT
