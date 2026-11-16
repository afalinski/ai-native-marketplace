# Agent pipeline "issue → PR" — design (stage 3, local phase)

Date: 2026-11-16. Branch: `stage3-pipeline` (from `ai-workflow`). ADR: ADR-008 (the "why" section is written by Andrei). Experiment: E12.

## Intent

A pipeline of Claude Code roles turns a short GitHub issue into a pull request. A human acts at exactly two points: approving the specification and merging the PR. Everything in between (implementation, tests, review, the fix loop) runs without a human, with a hard limit of 3 rounds and escalation after that.

The pipeline is the core of the pet project (stage 3 of `AI_PetProject_Plan.md`). It must be **measurable** (time, rounds, cost and diff size per task) and **repeatable**, because later stages compare runs and its numbers go into `docs/metrics.md`.

## Goals

- One local command per human gate: `spec` (issue → spec) and `build` (approved spec → branch → optional PR).
- The orchestrator is code. The round counter, the stop and the escalation live in code, not in a prompt.
- A machine-readable reviewer verdict that the orchestrator reads.
- Per-task metrics in `.work/<issue>/metrics.json` and in the PR body.
- The first real run is the calibration task: card number and CVV in the log (`src/Ordering.API/Apis/OrdersApi.cs:134`).

## Non-goals (this phase)

- GitHub Actions (`agent:spec` / `agent:build` labels, `claude-code-action@v1` with the `code-review` plugin on every PR). That is the next phase, on a separate API key with a spending limit. This phase only keeps the orchestrator CI-ready: Node, no Windows-only calls, a non-zero exit code on failure.
- The large tasks (Kafka, outbox, Helm, observability). They come after calibration.
- Parallel roles or agent teams (rejected in decision 1).

## Anti-goals (a failure even if it "works")

- A limit or a stop that exists only as a sentence in a prompt.
- A pipeline that edits the user's working copy or pushes anything without an explicit flag.
- A reviewer that can change code.
- Metrics that are typed by hand.
- The calibration fix touching `{@Command}` at `OrdersApi.cs:148`. With the current logger it prints only the type name (verification.md, re-check row 8), so "fixing" it is scope creep the reviewer must not demand.

## Constraints

- Decisions 1–4 of stage 3 are fixed (orchestrator = workflow code; local on subscription first, CI later on an API key; calibration task first; own reviewer in the loop, ready-made `code-review` on PRs later).
- Local runs use the subscription, so `total_cost_usd` is the client-side estimate from `--output-format json`, not a bill. Label it so in the metrics.
- `claude -p` starts in Manual mode, and anything needing approval is denied. Each role's rights must be explicit (`--allowedTools`, `--permission-mode`).
- Do not use `--bare`: the project hooks (`guard.mjs`, `stop-build.mjs`) and `CLAUDE.md` must apply to agent runs. They are the safety net from stage 2.
- Windows 11 host with Git Bash and PowerShell, .NET 10, Docker for functional tests. Claude Code 2.1.322, gh 2.98, Node 23.
- Global rule: implementer and reviewer use sonnet, planning roles use opus.

## Approaches considered

**Orchestrator** (decision 1, already taken): B, workflow code calling `claude -p --agent <role>`. Rejected: A, an orchestrator agent (the round limit would be a prompt request, hard to repeat and measure), and C, agent teams (the pipeline is sequential, so there is nothing to parallelise, and it is expensive).

**Tester.** The options were an LLM agent or a code step. **Chosen: code.** The orchestrator runs build and tests itself and hands the failures to the implementer. It costs nothing, behaves the same every run, and the stage gets a data point for "where AI is not needed". Trade-off: no test ideas from the tester. Tests are written by the implementer and judged by the reviewer.

**Implementer across rounds.**
- A: one session continued with `--resume`. **Chosen.** In round 2+ the implementer gets only `review.md` and the failing tests, and remembers what it did, which is cheaper.
- B: a fresh session per round with spec, plan, diff and findings. Cleaner per-round cost, but each round costs about 1.5–2× more.

Trade-off of A, recorded in metrics: round costs are not independent, and the context grows. The reviewer is always a fresh session, so it stays independent.

## Design

### Commands

```
node tools/pipeline/pipeline.mjs spec  <issue>            # gate 1 prepared
node tools/pipeline/pipeline.mjs build <issue> [--pr]     # runs after the human approves spec.md
```

- `spec`: reads the issue with `gh issue view <n> --json title,body`. It writes `.work/<n>/issue.md`, runs `analyst`, and writes `.work/<n>/spec.md` and its hash. Then it stops.
- Human gate 1: the human reads `spec.md` and may edit it. Running `build` counts as approval. `build` compares the spec hash; if it changed, it records `spec_edited_by_human: true` as an intervention.
- `build`: plan → rounds → docs → report. With `--pr` it also pushes branch `agent/<n>` and opens a PR (`gh pr create`) whose body is the report. Without `--pr` it stops at the local branch. Pushing and opening a PR are outward actions, so they never happen by default.
- Human gate 2: merging the PR (or the local branch).

The two commands map one-to-one to the future CI labels `agent:spec` and `agent:build`.

### Workspace

- `.work/` is added to `.gitignore`.
- `.work/<n>/` holds the artifacts: `issue.md`, `spec.md`, `plan.md`, `round-<k>/` (`diff.patch`, `tests.txt`, `review.json`, `review.md`), `escalation.md`, `report.md`, `metrics.json`, and the raw JSON of each `claude -p` call (`runs/<role>-<k>.json`).
- The code changes happen in a git worktree at `.work/<n>/wt` on branch `agent/<n>`, created from the current `HEAD`. Agents in the worktree get `--add-dir <repo>/.work/<n>` to read and write the artifacts. The user's working copy is never touched.
- Because the worktree is created from `HEAD`, the role definitions (`.claude/agents/*.md`) and hooks must be committed before a run.

### Roles

Each role is a file in `.claude/agents/`. The orchestrator runs it as `claude -p --agent <role> --output-format json --max-turns <N> --max-budget-usd <B>` plus the rights below. Limits sit in one config object at the top of `pipeline.mjs`.

| Role | Model | Rights | Input → output |
|---|---|---|---|
| `analyst` | opus | Read, Grep, Glob. Write only into `.work/<n>/` (a PreToolUse hook in the style of `docs-only.mjs`) | `issue.md` + code → `spec.md`: problem, scope, acceptance criteria (testable), out of scope |
| `planner` | opus | same as analyst | `spec.md` + code → `plan.md`: files, steps, tests to add, how to verify |
| `implementer` | sonnet | `--permission-mode acceptEdits`; `--allowedTools` limited to `dotnet build`, `dotnet test`, `git status`, `git diff` (guard hook still applies) | round 1: `spec.md` + `plan.md`. Round 2+: `--resume` with `round-<k-1>/review.md` + `tests.txt` → code and tests in the worktree. It does not commit |
| `reviewer` | sonnet | Read, Grep, Glob only. No Bash, no Edit, no Write | `spec.md` + `plan.md` + `round-<k>/diff.patch` + `tests.txt` → JSON verdict via `--json-schema` |
| `docs` | sonnet | Edit restricted to `docs/**` and `CLAUDE.md`, via a hook | the final diff → updates the notes the change invalidates (`docs/architecture/*`, `CLAUDE.md` gotchas), or nothing |

### Reviewer verdict (JSON schema)

```json
{
  "verdict": "APPROVE | CHANGES_REQUESTED",
  "summary": "string",
  "findings": [
    { "severity": "blocking | non-blocking", "file": "string", "line": 0,
      "rule": "spec | CLAUDE.md rule | correctness | test", "summary": "string" }
  ]
}
```

- The orchestrator reads `structured_output`. If the field is missing, it re-runs the reviewer once, and after that escalates.
- The orchestrator renders the verdict to `review.md` for the implementer.
- The orchestrator decides the outcome itself: a round passes when the tests are green and there are no `blocking` findings, whatever the `verdict` string says. A mismatch between the verdict and the blocking findings is logged as a reviewer-consistency data point.

### Round loop (in code)

```
for k in 1..3:
  implementer (k==1: new session; k>1: --resume same session)
  tests step (code): dotnet build eShop.Web.slnf; then dotnet test for the affected test projects
  write round-k/diff.patch (git diff against base) and tests.txt
  reviewer (fresh session) → review.json, review.md
  if tests green and no blocking findings → break (success)
if not success → escalation.md (open blocking findings, failing tests, rounds used), exit code 2, no PR
on success → docs → commit on agent/<n> → report.md → (--pr) push + PR
```

- **Affected tests.** Map each changed `src/<Project>/` to `tests/<Project>.UnitTests` and `tests/<Project>.FunctionalTests`, where those exist. Use the right filter syntax per framework (CLAUDE.md "Commands").
- **Docker.** If functional tests are needed and Docker is not running, the run stops before round 1 with a clear message. That is an environment problem, not a round.
- **Tests run once per round, before the reviewer.** The reviewer sees the result.
- **The commit is made by the orchestrator, not an agent.** The file list comes from `git status --porcelain`, which includes untracked files such as new tests. Files are staged by name, never `git add -A` (CLAUDE.md rule). The commit message is the issue title plus `Closes #<n>`. *(Claude's call.)*
- **Generated OpenAPI files.** If `src/Catalog.API/Catalog.API*.json` differ only in line endings (`git diff --ignore-all-space --ignore-cr-at-eol` is empty), the orchestrator restores them before each round's `diff.patch` and before the commit (CLAUDE.md gotcha). *(Claude's call.)*
- **What counts as green.**
  - A failing `dotnet build` is red. The test step stops there, and the build log goes into `tests.txt`.
  - If no test project maps to the change, "green" means the build passed. The report flags "no tests ran".
  - In round 3, red tests always escalate, even if the reviewer approved.
  - Non-blocking findings from the final round are listed in the PR body under "Not fixed (non-blocking)". *(Claude's call.)*
- **Docker check.** It runs only when a `*.FunctionalTests` project is mapped. The calibration task maps to `Ordering.FunctionalTests`, so Docker must be running for it. That is intended: those tests exercise the real endpoint. *(Claude's call.)*

### Where roles run, and how hooks see paths *(Claude's call)*

- `analyst` runs in the repo root, read-only on code. Every other role runs in the worktree `.work/<n>/wt`, where `CLAUDE_PROJECT_DIR` is the worktree root. That is why `.claude/` must be committed before a run.
- The orchestrator passes the absolute artifact directory in the environment variable `PIPELINE_WORK_DIR`. The write-restricting hooks read their allowed path from it, not from `CLAUDE_PROJECT_DIR`. `--add-dir` only grants access; the hook decides what may be written.

### Reruns *(Claude's call)*

- A second `spec <n>` keeps the old file as `spec.prev.md`, writes a new `spec.md` and hash, and logs a "spec rerun" intervention.
- `build <n>` aborts if `agent/<n>` or `.work/<n>/wt` already exists, unless `--fresh` is passed. `--fresh` removes both and logs a "build rerun" intervention. No silent resume of a half-finished build.

### Docs role output *(Claude's call)*

The `docs` edits are not reviewed by the agent reviewer. They go into the same commit and PR, so the human sees them at the merge gate. They count in `numstat` and are reported separately as "docs lines" in the metrics.

### `--resume` assumption *(Claude's call)*

The first implementation task is a probe that checks the assumptions behind choice A:
- `claude -p --resume <id> --agent implementer` keeps the role's tools and hooks;
- `--max-turns` and `--max-budget-usd` apply to the resumed run;
- `total_cost_usd` after a resume is cumulative.

If any of these does not hold, I'll come back to Andrei before switching to B; I won't switch silently.

### Metrics (`.work/<n>/metrics.json`, also in `report.md` and the PR body)

| Metric | Where it comes from |
|---|---|
| Wall-clock per role and total | timestamps in the orchestrator |
| Cost per role, per round, and total (client-side estimate) | `total_cost_usd` of each `claude -p` run. For the resumed implementer, take the difference to the previous cumulative value, because `--resume` reports the session total |
| Turns per run | `num_turns` |
| Rounds used, outcome (merged-ready / escalated) | loop |
| Files changed, lines added and removed | `git diff --numstat base..agent/<n>` |
| Human interventions and why | spec hash changed; escalation; manual re-run |
| Reviewer consistency | verdict string vs presence of blocking findings |

### Calibration task (first run, E12)

- The issue lives in `afalinski/ai-native-marketplace` (the `origin` remote; `gh` uses the local login). Andrei creates it before the run; its number goes on the `spec` command line.
- Issue text (2–3 lines, written by Andrei): the full `CreateOrderRequest`, including card number and CVV, is logged at `OrdersApi.cs:134` when the request id is an empty GUID.
- Expected outcome:
  - The fix stops logging the request object at `:134`.
  - A unit test proves that the CVV and the card number do not appear in the log for that branch.
  - `{@Command}` at `:148` is not changed, and the reviewer does not raise it as blocking.
- What gets recorded in E12:
  - rounds, cost, time and diff size;
  - whether the trap at `:148` was avoided by the implementer and by the reviewer;
  - whether `ValidatorBehavior.cs:30` came up (re-check row 8 listed it as another log site).

## Decided by Andrei

- Decisions 1–4 of stage 3, as listed in the plan.
- The tester is a code step, not an agent.
- The implementer keeps one session across rounds (`--resume`), and the reviewer is fresh every round.
- Branch `stage3-pipeline` from `ai-workflow`; ADR-008 and E12 numbering; Andrei writes the "why" section of ADR-008.

## Left to the builder

- The exact `--max-turns` and `--max-budget-usd` per role (start generous, record actuals).
- Prompt wording inside each role file.
- How the docs-only style hook generalises for the analyst, planner and docs roles (one hook with an allowed-paths argument, or one hook per role).
- The structure of `pipeline.mjs` (modules, tests for the pure parts: test-project mapping, verdict evaluation, cost diffing).
- The ADR-008 skeleton, with the "why" section left as a heading for Andrei.
