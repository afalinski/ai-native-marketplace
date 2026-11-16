# ADR-008: An agent pipeline from issue to PR

- Status: Accepted
- Date: 2026-11-16

## Context
We want a pipeline of Claude Code roles that turns a short GitHub issue into a pull request. A human acts at two points only: approving the spec and merging the PR. The implementation, the tests, the review and the fix loop run without a human, with a limit of 3 rounds and then escalation. The pipeline must be measurable (time, rounds, cost, diff size) and repeatable.

The spec is `docs/superpowers/specs/2026-11-16-agent-pipeline-design.md`. The code is `tools/pipeline/`. The roles are in `.claude/agents/`.

## Decision
Build the pipeline as code that calls `claude -p` with a role. Four decisions of stage 3 and two more:

- **Orchestrator is code, not an agent.** The round counter, the stop and the escalation live in the script. Rejected: an orchestrator agent (the round limit would be a request in a prompt, hard to repeat and measure), and agent teams (the pipeline is sequential, so there is nothing to parallelise, and it is expensive).
- **Local first on the subscription, CI later on a separate API key with a spending limit.** Debugging in CI is slow and expensive. The subscription token is personal and shares the Pro limits, so it does not fit a team. Andrei creates the key and the limit in the Claude Console.
- **The first task is a calibration task:** card number and CVV in the log (`OrdersApi.cs:134`). Big tasks (Kafka, outbox, auth in Catalog) come after the pipeline works. The reviewer must not demand a fix for `{@Command}` at `:148`.
- **Own reviewer in the loop, ready-made reviewer on PRs.** The loop uses a read-only role with a machine-readable verdict (`APPROVE` or `CHANGES_REQUESTED`, findings blocking or non-blocking). The orchestrator reads it for the round counter. Every PR later gets the ready-made `code-review` plugin through `claude-code-action@v1`.
- **The tester is code, not an agent.** The orchestrator runs build and tests and hands the failures to the implementer. Rejected: an LLM tester. Trade-off: no test ideas from the tester; the implementer writes tests and the reviewer judges them.
- **The implementer keeps one session across rounds with `--resume`.** In round 2 and later it gets only `review.md` and the failing tests. The reviewer is a fresh session every round. Rejected: a fresh implementer session per round with spec, plan, diff and findings (cleaner per-round cost, but each round costs about 1.5 to 2 times more). Trade-off: round costs are not independent and the context grows. This is recorded in the metrics.

## Consequences
- **The round limit is enforced in code.** A prompt cannot lower it, and a stop does not depend on the model.
- **Costs are not independent across rounds.** With `--resume`, `total_cost_usd` is the session total, so the orchestrator takes the difference to the previous value.
- **Local cost is an estimate.** On the subscription, `total_cost_usd` is the client-side figure from `--output-format json`, not a bill.
- **`--resume` needs `--agent` again.** The role is not kept by the session. Tools are enforced through the init tools list (E12 prelude in `docs/experiments.md`).
- **The reviewer needs `StructuredOutput` in its tool allowlist.** Without it, `structured_output` is null.
- **On Windows, `claude` is an npm `.cmd` shim around a native exe.** The runner resolves the exe and spawns it with `shell: false`.
- **Writing roles need `--permission-mode acceptEdits` under `-p`.** The `pipeline-write` hook is the path boundary.
- **Two human gates stay.** The spec approval and the merge. `build` counts as approval of the spec, and a changed spec hash is recorded as an intervention.
- **No agent test ideas.** The tests are only as good as the implementer's and the reviewer's judgement.
- Details: `docs/superpowers/specs/2026-11-16-agent-pipeline-design.md`, `docs/experiments.md` (E12).

## Why
<!-- Andrei writes this section -->
