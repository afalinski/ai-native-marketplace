# Agent pipeline (issue to PR)

Two commands, one per human gate. Design: `docs/superpowers/specs/2026-11-16-agent-pipeline-design.md`.

```
node tools/pipeline/pipeline.mjs spec  <issue>
node tools/pipeline/pipeline.mjs build <issue> [--pr] [--fresh]
```

## Gates

1. `spec <n>` reads the issue (`gh issue view`), runs the analyst and stops at `.work/<n>/spec.md`. Read and edit it. Running `build` counts as approval; an edited spec is logged as a `spec-edited` intervention. A second `spec` keeps the old file as `spec.prev.md` (`spec-rerun`).
2. `build <n>` plans, runs up to 3 implement/test/review rounds, runs docs, and commits on branch `agent/<n>` in the worktree `.work/<n>/wt`. Without `--pr` it stops there. Merging the PR (or branch) is the second gate.
   - `--pr`: `git push -u origin agent/<n>`, then `gh pr create` with `report.md` as the body. Outward action, never the default.
   - `--fresh`: remove an existing worktree/branch and rerun (`build-rerun`). Without it, an existing `agent/<n>` aborts the run.

## Artifacts (`.work/<n>/`, gitignored)

`issue.md`, `spec.md`, `spec.sha256`, `plan.md`, `round-<k>/{diff.patch,tests.txt,review.json,review.md}`, `runs/<role>-<k>.json` (raw `claude -p` output), `diff.patch` (final), `escalation.md` (on escalation), `report.md`, `metrics.json`, `interventions.json`, `wt/`.

Costs are `total_cost_usd` from the client, a client-side estimate, not a bill.

## Exit codes

- `0` success
- `1` error: bad input, `spec.md` not found, existing branch without `--fresh`, Docker down while functional tests are needed, analyst or planner failure
- `2` escalation: 3 rounds without green tests and zero blocking findings, or the reviewer gave no verdict. No PR.

## Requirements

- Node 23, git, `claude` on PATH (or `PIPELINE_CLAUDE_BIN`), `gh` logged in.
- Docker running when the change maps to a `tests/*.FunctionalTests` project.
- `.claude/` (agents, hooks) committed before a run: the worktree is created from `HEAD`.
- Tests only: `PIPELINE_CLAUDE_BIN=<node> PIPELINE_CLAUDE_PREFIX_ARGS='["fake.mjs"]'` runs a fake claude script.

Run the tests: `node --test "tools/pipeline/lib/*.test.mjs" "tools/pipeline/*.test.mjs" .claude/hooks/hooks.test.mjs`
