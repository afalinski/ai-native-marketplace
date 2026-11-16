# Agent Pipeline "issue → PR" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Node orchestrator that turns a GitHub issue into a spec (gate 1) and then into a reviewed, tested branch with an optional PR (gate 2), with a hard 3-round loop and per-task metrics.

**Architecture:**
- `tools/pipeline/pipeline.mjs` is a thin CLI over small pure modules in `tools/pipeline/lib/`.
- Each role is a `.claude/agents/*.md` file, run with `claude -p --agent <role> --output-format json`.
- The tester is code (`dotnet build` / `dotnet test`). The reviewer's verdict comes back through `--json-schema`.
- Side effects (claude, git, dotnet, gh) sit behind functions that are injected into the round loop, so the loop is unit-tested with fakes.

**Tech Stack:** Node 23 ESM (`.mjs`), `node:test`, `node:child_process`, git worktrees, gh 2.98, Claude Code 2.1.322, .NET 10 (MSTest unit tests, xUnit v3 functional tests).

**Spec:** `docs/superpowers/specs/2026-11-16-agent-pipeline-design.md`

## Global Constraints

- No npm dependencies. Node built-ins only, so the same code runs later in GitHub Actions.
- Never `--bare`. Project hooks and `CLAUDE.md` must apply to every agent run.
- No push or PR without `--pr`. Never touch the user's working copy; all code changes happen in `.work/<n>/wt` on branch `agent/<n>`.
- Stage files by name only, never `git add -A`.
- `MAX_ROUNDS = 3`. A round passes when tests are green and there are 0 `blocking` findings. Red tests in round 3 always escalate.
- Exit codes: `0` success, `1` error (bad input, environment, analyst or planner failure), `2` escalation.
- Models: analyst and planner `opus`; implementer, reviewer and docs `sonnet`.
- Costs are labelled "client-side estimate" everywhere they are shown.
- Prompts go to `claude` on stdin, not as an argument (Windows quoting).
- Hooks fail closed (exit 2 on any crash), as `docs-only.mjs` does.

## Review Focus

1. **Windows paths.** `PIPELINE_WORK_DIR` with backslashes, mixed case or `..` segments must still match in the write guard. Test in Task 2.
2. **Reviewer returns no `structured_output`** (refusal, max turns). The loop re-runs it once, then escalates; it never counts as approval. Test in Task 6.
3. **Implementer stops on max-turns or budget** (`subtype` other than `success`). The round still runs tests and review and still counts. It is not an abort. Test in Task 6.
4. **Line-ending-only changes to the OpenAPI files** must not reach `diff.patch`, the numstat metric or the commit. Test in Task 5.
5. **The new untracked test file** must be in `diff.patch`, numstat and the commit. Test in Task 5.

---

### Task 1: Probe the `--resume` assumptions (design choice A)

**Files:**
- Create: `tools/pipeline/probe-resume.mjs`
- Modify: `docs/experiments.md` (append "E12 prelude")

**Interfaces:**
- Produces: the facts Task 4 relies on: whether `--agent` and its tools survive `--resume`, whether `total_cost_usd` is cumulative after a resume, and the exact `subtype` values for a max-turns stop.

- [ ] **Step 1:** Write `probe-resume.mjs`. Run 1 is `claude -p --agent reviewer --output-format json --max-turns 2` with the prompt "List the tools you have, then stop." Run 2 is `--resume <session_id>` of run 1 with "Try to run the Bash command `git status`." Run 3 resumes again with `--max-turns 1` and a task that needs more turns. The script prints `session_id`, `total_cost_usd`, `num_turns`, `subtype` and `permission_denials` for each run. For this probe, a temporary agent definition goes in via `--agents` (a JSON file in the scratch dir) with `tools: Read, Grep, Glob`.
- [ ] **Step 2:** Run `node tools/pipeline/probe-resume.mjs`. Expected: run 2 has Bash in `permission_denials` (the role survived the resume), run 2's `total_cost_usd` is at least run 1's, and run 3's `subtype` is `error_max_turns`.
- [ ] **Step 3:** If any expectation fails, STOP and report to Andrei: design choice A depends on this. Do not switch to B on your own.
- [ ] **Step 4:** Append "E12 prelude" to `docs/experiments.md` with the three runs' numbers. Commit both files.

### Task 2: Write guard for pipeline roles

**Files:**
- Create: `.claude/hooks/pipeline-write.mjs`
- Modify: `.claude/hooks/hooks.test.mjs`

**Interfaces:**
- Produces: a PreToolUse hook that takes one argument, `work` or `docs`.
  - `work`: allows `Write` and `Edit` only under `process.env.PIPELINE_WORK_DIR`.
  - `docs`: allows only `<CLAUDE_PROJECT_DIR>/docs/**` and `<CLAUDE_PROJECT_DIR>/CLAUDE.md`.
  - Exit 2 blocks the call and names the hook in stderr.

- [ ] **Step 1: Write the failing tests** in `hooks.test.mjs`:
  - `pipeline-write.mjs work allows files under PIPELINE_WORK_DIR`: the env holds a path with backslashes and a different case; writes to `spec.md` and `round-1/review.md` both exit 0.
  - `pipeline-write.mjs work blocks outside paths and tricks`: blocks `src/x.cs`, `<work>/../escape.md`, an empty path, and a run with `PIPELINE_WORK_DIR` unset (fail closed). All exit 2.
  - `pipeline-write.mjs docs allows docs/** and CLAUDE.md, blocks src/** and .claude/**`.
- [ ] **Step 2:** Run `node --test .claude/hooks/hooks.test.mjs`. Expected: the new tests fail because the script is missing.
- [ ] **Step 3:** Implement `pipeline-write.mjs` by following `docs-only.mjs`: path resolution, the `fold` used for Windows case, and fail-closed handling.
- [ ] **Step 4:** Run `node --test .claude/hooks/hooks.test.mjs`. Expected: all tests pass, the old ones included.
- [ ] **Step 5:** Commit.

### Task 3: Role definitions and review schema

**Files:**
- Create: `.claude/agents/analyst.md`, `planner.md`, `implementer.md`, `reviewer.md`, `docs-writer.md`
- Create: `tools/pipeline/review.schema.json`
- Create: `tools/pipeline/lib/roles.test.mjs`

**Interfaces:**
- Consumes: `pipeline-write.mjs` (Task 2).
- Produces:
  - Role names `analyst`, `planner`, `implementer`, `reviewer`, `docs-writer`.
  - A schema with `verdict ∈ {APPROVE, CHANGES_REQUESTED}`, `summary: string`, and `findings[]` of `{severity ∈ {blocking, non-blocking}, file, line: integer, rule ∈ {spec, claude-md, correctness, test}, summary}`. `verdict`, `summary` and `findings` are required.

Frontmatter per role:

| Role | model | tools | hooks |
|---|---|---|---|
| analyst | opus | Read, Grep, Glob, Write | PreToolUse `Write` → `pipeline-write.mjs work` |
| planner | opus | Read, Grep, Glob, Write | same |
| implementer | sonnet | Read, Grep, Glob, Edit, Write, Bash | none extra (project `guard.mjs` applies) |
| reviewer | sonnet | Read, Grep, Glob | none |
| docs-writer | sonnet | Read, Grep, Glob, Edit | PreToolUse `Edit` → `pipeline-write.mjs docs` |

Role prompts must say:
- **analyst:** write `$PIPELINE_WORK_DIR/spec.md` with the sections Problem, Scope, Acceptance criteria (each one testable), Out of scope. Do not propose an implementation.
- **planner:** write `plan.md` with files, steps, tests to add, and how to verify. Read CLAUDE.md "Gotchas" first.
- **implementer:** follow `plan.md`. Write the tests first. Run `dotnet build` / `dotnet test` only on the affected projects. Never commit. In later rounds, fix only the blocking findings and the failing tests.
- **reviewer:** judge the diff against the spec and the CLAUDE.md rules. Mark a finding `blocking` only if it breaks an acceptance criterion, a CLAUDE.md rule, correctness or a test. Do not demand changes outside the spec's scope.
- **docs-writer:** update only notes that the diff makes wrong (CLAUDE.md "Gotchas", `docs/architecture/*`). If nothing is wrong, change nothing.

- [ ] **Step 1: Write the failing test** `roles.test.mjs`. It parses each agent file's frontmatter with a small regex reader and asserts:
  - the model per the table;
  - `reviewer` tools are exactly `["Read","Grep","Glob"]`;
  - neither `reviewer` nor `docs-writer` has `Bash`;
  - `analyst` and `planner` hooks reference `pipeline-write.mjs` with arg `work`;
  - `review.schema.json` parses and requires `verdict`, `summary` and `findings`.
- [ ] **Step 2:** Run `node --test tools/pipeline/lib/roles.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Write the five agent files and the schema.
- [ ] **Step 4:** Run the test. Expected: PASS. Also run `claude agents` and check that the five roles are listed.
- [ ] **Step 5:** Commit.

### Task 4: Claude runner

**Files:**
- Create: `tools/pipeline/lib/claude.mjs`, `tools/pipeline/lib/claude.test.mjs`

**Interfaces:**
- Consumes: the Task 1 findings and `review.schema.json`.
- Produces:
  - `buildClaudeArgs({ role, resumeId, schemaPath, maxTurns, maxBudgetUsd, permissionMode, allowedTools, addDirs }) -> string[]`, a pure function.
  - `runClaude({ ...argsOpts, prompt, cwd, workDir, logPath }) -> Promise<{ ok, subtype, sessionId, costUsd, turns, durationMs, structured, result }>`.
    - It sets `PIPELINE_WORK_DIR=workDir` in the child env and writes the raw JSON to `logPath`.
    - `ok` means `subtype === "success"`.
    - `structured` is `structured_output` or `null`.
- `costDelta(prevCumulativeUsd: number|null, currentUsd: number) -> number` returns `current - (prev ?? 0)`, used for the resumed implementer.
- Limits live in `ROLE_LIMITS` in `claude.mjs`. Starting values: analyst 30 turns / $3, planner 30 / $3, implementer 60 / $5, reviewer 25 / $2, docs-writer 15 / $1.
- Implementer rights: `--permission-mode acceptEdits` plus `--allowedTools "Bash(dotnet build *),Bash(dotnet test *),Bash(git status *),Bash(git diff *)"`.

- [ ] **Step 1: Write failing tests:**
  - `buildClaudeArgs` for the reviewer contains `-p`, `--agent reviewer`, `--output-format json` and `--json-schema <path>`, and does not contain `--bare`.
  - For the implementer with a `resumeId` it contains `--resume <id>` and the exact `--allowedTools` string above.
  - `costDelta(null, 0.4) === 0.4`; `costDelta(0.4, 1.1)` is about `0.7`.
- [ ] **Step 2:** Run `node --test tools/pipeline/lib/claude.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. `runClaude` spawns the binary named in `PIPELINE_CLAUDE_BIN` (default `claude`), writes the prompt to stdin and parses stdout as JSON. On a non-JSON stdout it returns `ok:false, subtype:"invalid_output"`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 5: Git workspace and test step

**Files:**
- Create: `tools/pipeline/lib/git.mjs`, `tools/pipeline/lib/testrun.mjs`, `tools/pipeline/lib/git.test.mjs`, `tools/pipeline/lib/testrun.test.mjs`

**Interfaces:**
- Produces, in `git.mjs` (each function takes `cwd`):
  - `createWorktree(repo, wtPath, branch) -> void`
  - `worktreeExists(repo, wtPath, branch) -> boolean`
  - `removeWorktree(repo, wtPath, branch) -> void`
  - `changedFiles(wt) -> string[]`: from `git status --porcelain`, including untracked files.
  - `restoreLineEndingOnly(wt, globs = ["src/Catalog.API/Catalog.API*.json"]) -> string[]`: returns the restored files.
  - `diffPatch(wt, base) -> string`: run `git add -N` on untracked files first so they appear.
  - `numstat(wt, base) -> { files, added, removed, docsAdded, docsRemoved }`
  - `commitByName(wt, files, message) -> sha`
- Produces, in `testrun.mjs`:
  - `mapTestProjects(files, repoRoot) -> { unit: string[], functional: string[] }`. It maps `src/<P>/…` to `tests/<P>.UnitTests` and `tests/<P>.FunctionalTests` where those folders exist, and ignores `docs/**`, `tools/**` and `.claude/**`.
  - `runTests(wt, files) -> { green, buildOk, ran: string[], noTests: boolean, log: string }`. It runs `dotnet build eShop.Web.slnf`, then `dotnet test --project <p>` for each mapped project.
  - `dockerAvailable() -> boolean`: `docker info` exits 0.

- [ ] **Step 1: Write failing tests:**
  - `git.test.mjs` makes a temp repo with `git init`. It covers:
    - an untracked new file shows up in `changedFiles`, `diffPatch` and `numstat`;
    - a file changed only by LF→CRLF that matches the glob is restored and is absent from `numstat`;
    - `commitByName` commits only the named files.
  - `testrun.test.mjs` uses a temp tree with `tests/Ordering.UnitTests` and `tests/Ordering.FunctionalTests`:
    - `["src/Ordering.API/Apis/OrdersApi.cs","docs/x.md"]` maps to unit `["tests/Ordering.UnitTests"]` and functional `["tests/Ordering.FunctionalTests"]`;
    - `["docs/x.md"]` maps to empty lists.
- [ ] **Step 2:** Run `node --test tools/pipeline/lib/git.test.mjs tools/pipeline/lib/testrun.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. Do not unit-test `runTests` itself; it is exercised by the calibration run.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 6: Round loop

**Files:**
- Create: `tools/pipeline/lib/loop.mjs`, `tools/pipeline/lib/loop.test.mjs`

**Interfaces:**
- Consumes: the result shapes from Tasks 4 and 5.
- Produces:
  - `evaluateRound({ tests, review }) -> { pass, blocking, consistent }`.
    - `pass = tests.green && review !== null && blocking === 0`.
    - `consistent = (review.verdict === "APPROVE") === (blocking === 0)`.
  - `runRounds({ implement(k, feedback), test(k), review(k), maxRounds = 3 }) -> Promise<{ outcome: "success"|"escalated", rounds, history }>`.
    - `review(k)` returns `{ structured|null, ... }`. When it is `null`, the loop calls `review(k)` once more. A second `null` escalates immediately with reason `"reviewer-no-verdict"`.
    - `feedback` for round k+1 is `{ reviewMd, testsLog }` from round k.
  - `renderReviewMd(review) -> string`.

- [ ] **Step 1: Write failing tests** with fake async functions:
  - passes in round 1, so `implement` is called once;
  - fails round 1 with blocking findings and passes round 2, so round 2's `feedback.reviewMd` contains the round-1 finding summary;
  - is red in all 3 rounds, giving `escalated` with `rounds === 3` and no 4th `implement` call;
  - the reviewer returns `null` twice, giving `escalated` with reason `reviewer-no-verdict`;
  - an implementer result with `subtype:"error_max_turns"` still leads to `test` and `review` for that round;
  - `CHANGES_REQUESTED` with only non-blocking findings and green tests passes, with `consistent: false`.
- [ ] **Step 2:** Run `node --test tools/pipeline/lib/loop.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 7: CLI `pipeline.mjs` (spec, build, report, metrics)

**Files:**
- Create: `tools/pipeline/pipeline.mjs`, `tools/pipeline/lib/report.mjs`, `tools/pipeline/lib/report.test.mjs`, `tools/pipeline/README.md`
- Modify: `.gitignore` (add `.work/`)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `node tools/pipeline/pipeline.mjs spec <n>`
  - `node tools/pipeline/pipeline.mjs build <n> [--pr] [--fresh]`
  - `renderReport(metrics) -> string` (Markdown for `report.md` and the PR body)
  - `.work/<n>/metrics.json` with these fields: `issue`, `startedAt`, `finishedAt`, `outcome`, `rounds`, `roles: [{ role, round, costUsd, turns, durationMs, subtype }]`, `totalCostUsd`, `costLabel: "client-side estimate"`, `diff: { files, added, removed, docsAdded, docsRemoved }`, `interventions: [{ kind, at, note }]`, `reviewerConsistency: boolean[]`, `nonBlocking: findings[]`, `noTestsRan: boolean`.

Behaviour (from the spec, "Commands", "Reruns" and "Where roles run"):
- **`spec`:**
  - Run `gh issue view <n> --json title,body` and write `issue.md`.
  - Run the analyst in the repo root.
  - Write `spec.md` and `spec.sha256`.
  - On a rerun, rename the old spec to `spec.prev.md` and log a `spec-rerun` intervention.
- **`build`:**
  - Stop with exit 1 if `spec.md` is missing.
  - If the hash differs, log a `spec-edited` intervention.
  - If the worktree or branch exists and `--fresh` is not given, stop with exit 1. With `--fresh`, remove them and log `build-rerun`.
  - Create the worktree from `HEAD`.
  - Run the planner in the worktree.
  - If functional tests map and Docker is down, stop with exit 1 before round 1.
  - Run `runRounds`. Its `implement`, `test` and `review` callbacks write the artifacts for each round: `round-<k>/diff.patch`, `tests.txt`, `review.json` and `review.md`, plus `runs/<role>-<k>.json`.
  - On escalation, write `escalation.md` and exit 2.
  - On success:
    - run docs-writer;
    - run `restoreLineEndingOnly`;
    - commit by name with the issue title and `Closes #<n>`;
    - write `report.md` and `metrics.json`;
    - with `--pr`: `git push -u origin agent/<n>`, then `gh pr create --base <current branch> --head agent/<n> --body-file report.md`.

- [ ] **Step 1: Write the failing test** `report.test.mjs`. `renderReport` with a 2-round success fixture must contain:
  - "Rounds: 2";
  - the total cost with the text "client-side estimate";
  - "Files changed: 3 (+40 / -5)";
  - a "Not fixed (non-blocking)" section listing the fixture's non-blocking finding;
  - an "Interventions" section that says "none" for an empty list.
- [ ] **Step 2:** Run `node --test tools/pipeline/lib/report.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `report.mjs` and `pipeline.mjs`. Write the README: the two commands, the gates, the artifacts, the exit codes, and the requirements (Docker, gh login, `.claude/` committed before a run).
- [ ] **Step 4:** Run `node --test tools/pipeline/ .claude/hooks/hooks.test.mjs`. Expected: all tests pass. Then run `node tools/pipeline/pipeline.mjs build 999999`. Expected: exit 1 with "spec.md not found".
- [ ] **Step 5:** Commit.

### Task 8: ADR-008 skeleton

**Files:**
- Create: `docs/adr/0008-agent-pipeline.md`

- [ ] **Step 1:** Write the ADR in the format of `docs/adr/0007-custom-mcp-server.md`:
  - Status: Accepted, 2026-11-16.
  - Context.
  - Decision: the four stage-3 decisions, the tester-as-code decision, and the `--resume` decision, with the rejected alternatives copied from the spec's "Approaches".
  - Consequences.
  - A section `## Why` that contains only `<!-- Andrei writes this section -->`.
- [ ] **Step 2:** Commit.

### Task 9: Calibration run (E12), with Andrei

No new code. This task needs the human at both gates.

- [ ] **Step 1:** Andrei creates the calibration issue in `afalinski/ai-native-marketplace` (2–3 lines). Get its number `<n>`.
- [ ] **Step 2:** Run `node tools/pipeline/pipeline.mjs spec <n>`. Expected: exit 0 and `.work/<n>/spec.md` exists. Andrei reads it, may edit it, and approves.
- [ ] **Step 3:** With Docker running, run `node tools/pipeline/pipeline.mjs build <n>` (no `--pr` on the first run). Expected: exit 0 or 2. Record which.
- [ ] **Step 4:** Check the calibration criteria in the worktree diff:
  - `OrdersApi.cs:134` no longer logs `request`;
  - a test asserts the CVV and card number are absent from the log;
  - line 148 `{@Command}` is unchanged;
  - no blocking finding about `:148`;
  - note whether `ValidatorBehavior.cs:30` came up.
- [ ] **Step 5:** Append "Stage 3 — pipeline" to `docs/metrics.md`: time, rounds, cost (client-side estimate), files and lines, interventions, and the calibration criteria. Append E12 to `docs/experiments.md` (hypothesis → what I did → result → conclusion). Commit.
- [ ] **Step 6:** Ask Andrei before re-running with `--pr`. Opening a PR is an outward action.
