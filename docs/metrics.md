# Metrics

Baseline measured before any AI tooling was added. Every later stage appends a column or a section.

## Stage 0 — baseline (2026-11-12, commit 913acea)

| Metric | Value |
|---|---|
| Projects (.csproj) | 28 |
| C# in `src` | 498 files, ~22.7K lines (+40 Razor files) |
| C# in `tests` | 49 files, ~3.6K lines |
| Automated tests | 125 (unit + functional), all passing |
| E2E (Playwright) scenarios | 3 (browse, cart, checkout) |
| Build, incremental | ~11 s |
| Full test run | ~2 min (functional tests use Docker containers) |
| Code coverage | not measured yet |
| Manual task time (one small task, no AI) | **~2–2.5 h — expert estimate, not measured** (see below) |

### Reference task: price-range filter in Catalog.API (`minPrice` / `maxPrice` + functional test)

Estimate for an experienced .NET developer seeing this repo for the first time, working at a calm pace:

| Step | Time |
|---|---|
| Orientation: find the endpoint (`GetAllItems` v2 in `CatalogApi.cs`), filtering pattern, test fixture | 30–40 min |
| Implementation: query parameters, filter, validation (`minPrice <= maxPrice`, non-negative) | 30 min |
| Functional test (Testcontainers fixture, ~2 min per run, 2–3 runs) | 40 min |
| Update checked-in OpenAPI docs (`Catalog.API_v2.json`), self-review, PR description | 20–30 min |
| **Total** | **~2–2.5 h** |

Caveat: an estimate is weaker evidence than a measurement. When comparing agent runs against it, say so explicitly.

## Metric definitions (reference approach)

Based on DORA (current set of five software delivery metrics) plus AI-specific metrics.
Principle: metrics are collected **automatically from systems** (CI/CD, Git, issue tracker), never from manual reports; failure is **defined before** measuring; we look at **trends**, not single numbers.

### Throughput
| Metric | Definition | Source |
|---|---|---|
| Change lead time | First commit → change running in production | Git + deployment events |
| Deployment frequency | Production deployments per day/week | CI/CD |
| Failed deployment recovery time (former MTTR) | Failed deployment detected → service restored | Incident/alert tool + CI/CD |

### Instability
| Metric | Definition | Source |
|---|---|---|
| Change failure rate | Deployments that needed immediate intervention (rollback, hotfix, feature flag turned off, incident) ÷ all deployments | Deployment events linked to incidents/hotfixes by version / commit SHA |
| Deployment rework rate | Unplanned deployments made to fix a user-facing bug ÷ all deployments | CI/CD + issue type |

Context (DORA 2025, State of AI-assisted Software Development): AI adoption is now **positively** related to throughput but **still negatively** related to stability. AI is an **amplifier** of the existing system — this is why stability metrics and cohort comparison are mandatory.

### AI-specific (aligned with Anthropic's Claude Code analytics)
| Metric | Definition | Source |
|---|---|---|
| PRs with Claude Code (%) | Merged PRs containing at least one line written with Claude Code ÷ all merged PRs | PR label `claude-code-assisted` (same label Anthropic's contribution metrics use) |
| PRs per engineer per day | Merged PRs ÷ active engineers — the headline measure Anthropic reported internally | GitHub |
| Cohort comparison | All DORA metrics split into `claude-code-assisted` vs. other PRs, within the same task type | GitHub labels + deployment/incident data |
| Suggestion accept rate | Accepted Edit/Write decisions ÷ all decisions | Claude Code OpenTelemetry: `claude_code.code_edit_tool.decision` |
| Cost and tokens | USD and tokens per session / per merged PR | OTel: `claude_code.cost.usage`, `claude_code.token.usage` |
| Active time | Human keyboard time + agent processing time | OTel: `claude_code.active_time.total` |
| Autonomy | Tool calls per human turn — how long the agent works without a person | OTel events (`tool_result`, `user_prompt`) |
| Human review time | Time a human spends reviewing / correcting an agent PR | PR review events |
| Agent iterations | Review ↔ implement loops before the PR was ready | Pipeline logs |

Rules:
- Activity metrics (lines of code, commits, PR count) are **proxies, not productivity** — always read them together with DORA stability metrics.
- **Triangulate**: system data + a short developer survey (perceived productivity, review burden, trust). Anthropic's own study combined a survey, interviews and transcript analysis; self-reported +50% matched a measured +67% merged PRs per engineer.
- Telemetry is opt-in (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, OTLP exporter); prompts and code are redacted by default.

### Conditions that make AI pay off (DORA AI Capabilities Model, 2025)
Clear AI stance · healthy data ecosystem · AI access to internal data/docs · strong version control · small batches · user-centric focus · quality internal platform.

In this demo repo, `main` + the local Kubernetes deployment play the role of production.

## Stage 1 — discovery (2026-11-12, commit d9aa12b)

Run of `/explore-system` (ADR-002): 8 service explorers in parallel → 2 theme explorers in parallel → architect → critic.

| Metric | Value |
|---|---|
| Wall-clock time | 10:45:40Z → 11:01:59Z (~17 min), orchestrator start to critic finish |
| Claims written | 356 checked: 254 in service cards, 99 in theme cards (EVT 60, SEC 39), 3 new architect claims (ARCH) |
| Critic: confirmed | 347 |
| Critic: not confirmed | 3 (WHK-37, IDN-21, WEB-28) |
| Critic: wrong | 6 (ORD-05, EVT-38, EVT-59, WHK-29, SEC-18, IDN-22) |
| Rejection rate | 9 / 356 = **2.5 %** |
| Overview target steps with flawed reasoning (not counted in the rate) | 3 major (steps 2b, 3, 10), plus 3 smaller ones |

Per-claim rejection rate measures card accuracy only. The architect's serious errors were wrong inferences from true claims. The claim count does not capture them, so track them separately.

### Tokens and time per role (subagent totals as reported by the harness)

| Role | Calls | Tokens | Tool uses | Duration (longest call) |
|---|---|---|---|---|
| Explorer — services (sonnet) | 8 | 241,023 | 162 | 49 s |
| Explorer — themes (sonnet) | 2 | 131,143 | 66 | 103 s |
| Architect (opus) | 1 | 89,844 | 14 | 289 s |
| Critic (sonnet) | 1 | 266,280 | 160 | 486 s |
| **Total subagents** | 12 | **728,290** | 402 | — |

Orchestrator tokens: not available from inside the session. The critic is the most expensive role (37 % of tokens) and the critical path (~8 of ~17 min).

### Revision round (one round, `/revise-architecture`)

| Metric | Before | After |
|---|---|---|
| Plan soundness (target steps with no open critic finding ÷ all steps) | 3 / 13 = **23 %** | 10 / 13 = **77 %** |
| Revision-log items re-checked | — | 30: 27 fixed, 1 still unsupported, 2 new problems |
| New problems found in touched text | — | 1 (N1: BFF catalog routes forward any HTTP method) |

Open after the round (iteration cap reached → human decision): step 2 (route method restriction), step 6 (duplicate `PaymentFailed` is not idempotent), step 10 (logging claim depends on the logging provider; `PaymentMethod` requires a CVV).
Tokens for this round were not captured.

## Stage 2 — harness (2026-11-12, in progress)

| Metric | Value |
|---|---|
| Always-on instructions (`CLAUDE.md`) | 33 lines |
| Path-scoped rules (`.claude/rules/`, five files) | 76 lines, loaded only on matching paths |
| Stop-hook build, changed code, cold | 10–13 s |
| Stop-hook build, unchanged code | 0 s (cached) |
| Hook logic tests | 8 tests, all passing |
| Prompt-injection layers (E9) | model caught the planted note; deny rules + hook block secret-file and network-tool commands, also inside `bash -c`; a script calling `fetch` still passes (needs the OS sandbox) |
| Task skills | 3 (`add-endpoint`, `add-integration-event`, `add-migration`) |
| Skill trigger check | 4 of 4 prompts as intended (one run each) |
| Reference task in three setups (A0, B, C) | measured, see below and E8 |
| Tool-design eval (E10), N=1 pilot, 10 questions | M0 no MCP 1 correct / 9 abstained (first run read the seed files: 5/5/0; after blocking eval/** and tests/** it is 1/9/0); M1 Postgres MCP Pro 10 / 0 / 0; M2 eShop.Mcp 10 / 0 / 0; no wrong answers; see below and E10 |

### Reference task in three setups (2026-11-13, E8)

Price-range filter in Catalog v2 with a functional test. Model Sonnet, headless, one clone per run. Correctness = build + all Catalog functional tests + a hidden acceptance test written before the runs (6 cases) + v1 contract unchanged + v2 OpenAPI updated + no files outside Catalog.

| Setup | Run | Time | Cost | Turns | Correct | Ready to commit (no line-ending-only file in the diff) | 400 body |
|---|---|---|---|---|---|---|---|
| A0, no configuration | 1 | 141 s | $0.20 | 14 | yes | no | validation problem |
| A0 | 2 | 104 s | $0.17 | 14 | yes | no | validation problem |
| B, with the wrong filter command | 1 | 174 s | $0.41 | 22 | yes | yes | ProblemDetails |
| B, filter command fixed | 2 | 188 s | $0.24 | 20 | yes | yes | validation problem |
| B, filter command fixed | 3 | 151 s | $0.26 | 21 | yes | yes | ProblemDetails |
| C, one 663-line `CLAUDE.md` | 1 | 184 s | $0.49 | 22 | yes | yes | plain string |

| Always-on context at session start (tokens written to cache, trivial prompt) | Value |
|---|---|
| A0 | 9,343 |
| B | 9,417 |
| C | 35,160 |

Against the stage 0 estimate of 2–2.5 h by hand: every run finished in under 4 minutes of agent time. Human review time is not included and was not measured. The sample is 1–3 runs per setup on one easy task, so read the differences as direction, not size.

### Tool-design eval, N=1 pilot (2026-11-13, E10)

10 questions, Sonnet, headless, one run per cell (30 runs). First signal, not proof. Data leakage found and fixed: the first M0 run read the seed files (5/5/0); after blocking `eval/**` and `tests/**` the M0 row below (1/9/0) is the reported one. Cost is the total for 10 runs, an API-equivalent estimate (Pro subscription, not money spent). Tokens: without cache M2 > M1 (881 vs 769), with cache M2 < M1 (139,009 vs 156,757), so no token winner.

| Variant | Correct | Abstained | Wrong | Mean tool calls | Mean tokens (input+output) | Mean seconds | Total cost for 10 runs (API-equivalent estimate) |
|---|---|---|---|---|---|---|---|
| M0 no MCP (second run) | 1 | 9 | 0 | 1.7 | 746 | 8.2 | $0.73 |
| M1 Postgres MCP Pro | 10 | 0 | 0 | 3.4 | 769 | 7.8 | $0.76 |
| M2 eShop.Mcp | 10 | 0 | 0 | 6.8 | 881 | 13.1 | $0.94 |

## Stage 3 — pipeline "issue → PR" (2026-11-16, branch stage3-pipeline)

Local run on the subscription. Costs are `total_cost_usd` from `claude -p --output-format json`, a client-side estimate, not a bill.

### Calibration task — issue #1 (card number and CVV in the log, `OrdersApi.cs:134`)

| Metric | Value |
|---|---|
| Outcome | success, branch `agent/1` (no PR yet) |
| Rounds | 1 of 3 |
| Wall-clock | spec 0.6 min; build 3.9 min (16:09:52 → 16:13:43 UTC) |
| Cost total | $0.99: analyst 0.23, planner 0.33, implementer 0.19, reviewer 0.12, docs-writer 0.11 |
| Test step | 1.0 min (build + Ordering.UnitTests 46, Ordering.FunctionalTests 11, Catalog.FunctionalTests 38) |
| Diff | 3 files, +115 / −1 code and tests; docs +3 / −3 |
| Human interventions | 0 (spec approved as written; one inaccurate out-of-scope sentence left in on purpose) |
| Reviewer consistency | verdict matches findings (APPROVE, 0 blocking, 1 non-blocking) |

Calibration checks:
- `OrdersApi.cs:134` no longer logs the request; it logs only `UserId`. ✅
- A unit test asserts that the card number and CVV are absent from every log call on that branch. ✅
- `{@Command}` at `:148` is unchanged, and the reviewer raised nothing about it. ✅ (The spec itself put it out of scope.)
- `ValidatorBehavior.cs:30` did not come up.

### Live run — issue #4 (ARCH-06: `POST /api/orders` returns 200 when the create fails)

| Metric | Value |
|---|---|
| Outcome | **escalated** (max-rounds), exit 2, no commit and no PR |
| Rounds | 3 of 3 |
| Wall-clock | spec 1.2 min; build 16.0 min (17:11:36 → 17:27:35 UTC) |
| Cost total | $3.50: analyst 0.49, planner 1.12, implementer 0.92 + 0.42 + 0.06, reviewer 0.18 + 0.16 + 0.16 |
| Test steps | 0.6 / 0.7 / 0.7 min (Ordering.UnitTests 48, WebApp.UnitTests 4 (new project), Ordering.FunctionalTests 12); no Catalog tests ran (the E12 fix works) |
| Diff (uncommitted, in the worktree) | 14 files, +279 / −7; docs +6 / −6 |
| Tests per round | round 1: 2 functional tests red; round 2: all green; round 3: all green |
| Blocking findings per round | 3 → 1 → 1 (the same `.claude/rules/ordering.md:12` finding in rounds 2 and 3) |
| Human interventions | 0 before the escalation (spec approved as written) |
| Reviewer consistency | 3 of 3 rounds match |
