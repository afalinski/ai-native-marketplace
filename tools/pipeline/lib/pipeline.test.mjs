import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../pipeline.mjs";
import { planFiles } from "./build.mjs";

const block = { severity: "blocking", file: "src/A.cs", line: 3, rule: "spec", summary: "still logs the CVV" };
const review = (verdict, findings = []) => ({ verdict, summary: "s", findings });

function setup({ implementer, branchExists = false, reviews, testsGreen = () => true, planText = "Touch src/Ordering.API/Apis/OrdersApi.cs", remote = true, docker = () => true, functional = false }) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "pipe-e2e-"));
  const workDir = path.join(repo, ".work", "7");
  mkdirSync(workDir, { recursive: true });
  const spec = "# spec\n";
  writeFileSync(path.join(workDir, "spec.md"), spec);
  writeFileSync(path.join(workDir, "issue.md"), "# Stop logging card data\n\nbody\n");
  const calls = [];
  const commits = [];
  const pushes = [];
  let reviewIdx = 0;
  const implSessions = {};
  const deps = {
    claude: async (o) => {
      calls.push(o);
      if (o.role === "planner") {
        writeFileSync(path.join(o.workDir, "plan.md"), planText);
        return { ok: true, subtype: "success", sessionId: "p", costUsd: 0.5, turns: 3, durationMs: 10, structured: null, result: "" };
      }
      if (o.role === "implementer") {
        implSessions.n = (implSessions.n ?? 0) + 1;
        if (implementer) return implementer(implSessions.n);
        return { ok: true, subtype: "success", sessionId: "impl-1", costUsd: implSessions.n * 1, turns: 4, durationMs: 10, structured: null, result: "" };
      }
      if (o.role === "reviewer") {
        const r = reviews[reviewIdx++];
        return { ok: true, subtype: "success", sessionId: "r" + reviewIdx, costUsd: 0.25, turns: 2, durationMs: 10, structured: r, result: "" };
      }
      return { ok: true, subtype: "success", sessionId: "d", costUsd: 0.1, turns: 1, durationMs: 10, structured: null, result: "" };
    },
    git: {
      currentBranch: () => "stage3-pipeline",
      headSha: () => "abc123",
      worktreeExists: () => false,
      branchExists: () => branchExists,
      createWorktree: (_r, wt) => mkdirSync(functional ? path.join(wt, "tests", "Ordering.FunctionalTests") : wt, { recursive: true }),
      remoteBranchExists: () => remote,
      removeWorktree: () => {},
      changedFiles: () => ["src/Ordering.API/Apis/OrdersApi.cs"],
      restoreLineEndingOnly: () => [],
      diffPatch: () => "diff --git a b\n",
      numstat: () => ({ files: 3, added: 40, removed: 5, docsAdded: 0, docsRemoved: 0 }),
      commitByName: (wt, files, msg) => { commits.push({ files, msg }); return "deadbeef"; },
      pushBranch: () => { pushes.push(1); throw new Error("must not push"); },
    },
    tests: {
      runTests: (_wt, _files, k) => ({ green: testsGreen(), buildOk: true, ran: [], noTests: true, log: "build ok\n" }),
      dockerAvailable: () => docker(),
    },
    gh: {
      issueView: () => ({ title: "Stop logging card data", body: "body" }),
      prCreate: () => { throw new Error("must not create a PR"); },
    },
  };
  return { repo, workDir, deps, calls, commits, pushes };
}

const run = (s, argv) => main({ argv, repo: s.repo, deps: s.deps, log: () => {} });

test("build: round 1 CHANGES_REQUESTED, round 2 APPROVE -> exit 0, artifacts, resume", async () => {
  const s = setup({ reviews: [review("CHANGES_REQUESTED", [block]), review("APPROVE", [{ ...block, severity: "non-blocking" }])] });
  const code = await run(s, ["build", "7"]);
  assert.equal(code, 0);
  const m = JSON.parse(readFileSync(path.join(s.workDir, "metrics.json"), "utf8"));
  assert.equal(m.rounds, 2);
  assert.equal(m.outcome, "success");
  assert.equal(m.costLabel, "client-side estimate");
  assert.equal(m.nonBlocking.length, 1);
  const impl = s.calls.filter((c) => c.role === "implementer");
  assert.equal(impl.length, 2);
  assert.equal(impl[0].resumeId, undefined);
  assert.equal(impl[1].resumeId, "impl-1");
  // per-round implementer cost is a delta of the cumulative total
  const implCosts = m.roles.filter((r) => r.role === "implementer").map((r) => r.costUsd);
  assert.deepEqual(implCosts, [1, 1]);
  for (const c of s.calls) assert.ok(c.addDirs.includes(s.workDir));
  assert.ok(path.isAbsolute(s.workDir));
  assert.ok(impl[1].prompt.includes(path.join(s.workDir, "round-1", "review.md")));
  assert.ok(existsSync(path.join(s.workDir, "round-1", "review.md")));
  assert.ok(existsSync(path.join(s.workDir, "round-2", "diff.patch")));
  assert.ok(readFileSync(path.join(s.workDir, "report.md"), "utf8").includes("Rounds: 2"));
  assert.equal(s.calls.find((c) => c.role === "planner").cwd, path.join(s.workDir, "wt"));
  assert.equal(s.commits.length, 1);
  assert.match(s.commits[0].msg, /^Stop logging card data\n\nCloses #7$/);
});

test("build: three red rounds -> exit 2 and escalation.md, no commit", async () => {
  const rv = review("CHANGES_REQUESTED", [block]);
  const s = setup({ reviews: [rv, rv, rv] });
  const code = await run(s, ["build", "7"]);
  assert.equal(code, 2);
  assert.ok(existsSync(path.join(s.workDir, "escalation.md")));
  assert.match(readFileSync(path.join(s.workDir, "escalation.md"), "utf8"), /still logs the CVV/);
  assert.equal(s.commits.length, 0);
  assert.equal(JSON.parse(readFileSync(path.join(s.workDir, "metrics.json"), "utf8")).outcome, "escalated");
});

test("build: missing spec.md -> exit 1", async () => {
  const s = setup({ reviews: [] });
  const code = await main({ argv: ["build", "8"], repo: s.repo, deps: s.deps, log: () => {} });
  assert.equal(code, 1);
});

const OK = { ok: true, subtype: "success", turns: 1, durationMs: 1, structured: null, result: "" };
const rv = review("CHANGES_REQUESTED", [block]);

test("build: a timed-out implementer round does not corrupt per-round costs", async () => {
  const s = setup({
    reviews: [rv, rv, review("APPROVE")],
    implementer: (i) =>
      i === 2 ? { ...OK, ok: false, subtype: "timeout", sessionId: null, costUsd: 0 } : { ...OK, sessionId: "impl-1", costUsd: i === 1 ? 1 : 1.5 },
  });
  assert.equal(await run(s, ["build", "7"]), 0);
  const m = JSON.parse(readFileSync(path.join(s.workDir, "metrics.json"), "utf8"));
  assert.deepEqual(m.roles.filter((r) => r.role === "implementer").map((r) => r.costUsd), [1, 0, 0.5]);
  const impl = s.calls.filter((c) => c.role === "implementer");
  assert.equal(impl[2].resumeId, "impl-1");
});

test("build: no session after a failed round 1 -> round 2 is a new session with the full task prompt", async () => {
  const s = setup({
    reviews: [rv, review("APPROVE")],
    implementer: (i) => (i === 1 ? { ...OK, ok: false, subtype: "timeout", sessionId: null, costUsd: 0 } : { ...OK, sessionId: "impl-2", costUsd: 2 }),
  });
  assert.equal(await run(s, ["build", "7"]), 0);
  const impl = s.calls.filter((c) => c.role === "implementer");
  assert.equal(impl[1].resumeId, undefined);
  assert.ok(impl[1].prompt.includes("implement the plan"));
  assert.ok(impl[1].prompt.includes(path.join(s.workDir, "round-1", "review.md")));
  const m = JSON.parse(readFileSync(path.join(s.workDir, "metrics.json"), "utf8"));
  assert.deepEqual(m.roles.filter((r) => r.role === "implementer").map((r) => r.costUsd), [0, 2]);
});

test("build: an aborted build (branch exists, no --fresh) logs no intervention", async () => {
  const s = setup({ reviews: [], branchExists: true });
  writeFileSync(path.join(s.workDir, "spec.sha256"), "stale-hash");
  assert.equal(await run(s, ["build", "7"]), 1);
  assert.equal(existsSync(path.join(s.workDir, "interventions.json")), false);
});

test("build: an ok:false implementer run with a cost (error_max_turns) is counted", async () => {
  const s = setup({
    reviews: [rv, review("APPROVE")],
    implementer: (i) => (i === 1 ? { ...OK, ok: false, subtype: "error_max_turns", sessionId: "impl-1", costUsd: 2 } : { ...OK, sessionId: "impl-1", costUsd: 3 }),
  });
  assert.equal(await run(s, ["build", "7"]), 0);
  const m = JSON.parse(readFileSync(path.join(s.workDir, "metrics.json"), "utf8"));
  assert.deepEqual(m.roles.filter((r) => r.role === "implementer").map((r) => r.costUsd), [2, 1]);
});

test("build: a resumed run that returns a different session id is a new session (no delta)", async () => {
  const s = setup({
    reviews: [rv, review("APPROVE")],
    implementer: (i) => (i === 1 ? { ...OK, sessionId: "impl-1", costUsd: 2 } : { ...OK, sessionId: "impl-other", costUsd: 0.5 }),
  });
  assert.equal(await run(s, ["build", "7"]), 0);
  const m = JSON.parse(readFileSync(path.join(s.workDir, "metrics.json"), "utf8"));
  assert.deepEqual(m.roles.filter((r) => r.role === "implementer").map((r) => r.costUsd), [2, 0.5]);
});

test("build --pr: base branch missing on origin -> exit 1 before any model call or push", async () => {
  const s = setup({ reviews: [], remote: false });
  const msgs = [];
  const code = await main({ argv: ["build", "7", "--pr"], repo: s.repo, deps: s.deps, log: (m) => msgs.push(m) });
  assert.equal(code, 1);
  assert.match(msgs.join("\n"), /does not exist on origin.*Push it first/);
  assert.equal(s.calls.length, 0);
  assert.equal(s.pushes.length, 0);
});

test("build: Docker goes down mid-run -> exit 1 as an environment problem, not a round", async () => {
  let n = 0;
  const s = setup({ reviews: [], functional: true, docker: () => ++n === 1 });
  const msgs = [];
  const code = await main({ argv: ["build", "7"], repo: s.repo, deps: s.deps, log: (m) => msgs.push(m) });
  assert.equal(code, 1);
  assert.match(msgs.join("\n"), /not a round/);
  assert.equal(s.calls.filter((c) => c.role === "reviewer").length, 0);
  assert.equal(s.commits.length, 0);
  assert.equal(existsSync(path.join(s.workDir, "round-1", "tests.txt")), false);
});

test("planFiles normalises backslashes", () => {
  assert.deepEqual(planFiles("edit src\\Ordering.API\\Apis\\x.cs and src/Basket.API/y.cs"), ["src/Ordering.API/x", "src/Basket.API/x"]);
});

test("build: metrics carry wall-clock per role and per test step", async () => {
  const s = setup({ reviews: [review("APPROVE")] });
  assert.equal(await run(s, ["build", "7"]), 0);
  const m = JSON.parse(readFileSync(path.join(s.workDir, "metrics.json"), "utf8"));
  for (const r of m.roles) assert.equal(typeof r.wallMs, "number", r.role);
  assert.equal(m.roles.find((r) => r.role === "implementer").durationMs, 10);
  assert.equal(m.tests.length, 1);
  assert.equal(m.tests[0].round, 1);
  assert.equal(typeof m.tests[0].wallMs, "number");
});

test("build --fresh rerun does not log spec-edited twice for the same edited spec", async () => {
  const s = setup({ reviews: [review("APPROVE"), review("APPROVE")] });
  writeFileSync(path.join(s.workDir, "spec.sha256"), "analyst-version-hash");
  assert.equal(await run(s, ["build", "7"]), 0);
  s.deps.git.branchExists = () => true;
  assert.equal(await run(s, ["build", "7", "--fresh"]), 0);
  const edits = JSON.parse(readFileSync(path.join(s.workDir, "interventions.json"), "utf8")).filter((i) => i.kind === "spec-edited");
  assert.equal(edits.length, 1);
});

test("build: the planner prompt carries the protected-paths instruction (E13)", async () => {
  const s = setup({ reviews: [review("APPROVE")] });
  await run(s, ["build", "7"]);
  const planner = s.calls.find((c) => c.role === "planner");
  assert.match(planner.prompt, /\.claude\/\*\*/);
  assert.match(planner.prompt, /## Human after merge/);
});

test("build: escalation.md carries the implementer's last message from runs/implementer-<k>.json (E13)", async () => {
  const rv = review("CHANGES_REQUESTED", [block]);
  const s = setup({ reviews: [rv, rv, rv] });
  const inner = s.deps.claude;
  s.deps.claude = async (o) => {
    const r = await inner(o);
    if (o.role === "implementer") {
      const text = `round ${o.logPath.match(/implementer-(\d+)/)[1]}: the edit tool refused .claude/rules/ordering.md`;
      mkdirSync(path.dirname(o.logPath), { recursive: true });
      writeFileSync(o.logPath, JSON.stringify({ result: text }));
      return { ...r, result: text };
    }
    return r;
  };
  assert.equal(await run(s, ["build", "7"]), 2);
  const md = readFileSync(path.join(s.workDir, "escalation.md"), "utf8");
  assert.match(md, /## Implementer's last message \(round 3\)/);
  assert.match(md, /round 3: the edit tool refused \.claude\/rules\/ordering\.md/);
  assert.match(md, /still logs the CVV/);
});

test("spec: the analyst prompt carries the instruction, and a protected path the spec asks for is warned about", async () => {
  const s = setup({ reviews: [] });
  const inner = s.deps.claude;
  let analystPrompt = null;
  s.deps.claude = async (o) => {
    if (o.role === "analyst") {
      analystPrompt = o.prompt;
      writeFileSync(path.join(o.workDir, "spec.md"), "# Spec\n## Scope\n- Update `.claude/rules/ordering.md:12`.\n## Acceptance criteria\n- x\n");
      return { ok: true, subtype: "success", sessionId: "a", costUsd: 0.2, turns: 2, durationMs: 10, structured: null, result: "" };
    }
    return inner(o);
  };
  const logs = [];
  const code = await main({ argv: ["spec", "7"], repo: s.repo, deps: s.deps, log: (m) => logs.push(m) });
  assert.equal(code, 0);
  assert.match(analystPrompt, /\.claude\/\*\*/);
  assert.match(analystPrompt, /## Human after merge/);
  assert.ok(logs.some((m) => /WARNING: .*\.claude\/rules\/ordering\.md/.test(m)), logs.join("\n"));
});

test("build: the reviewer prompt says Human-after-merge items are never blocking", async () => {
  const s = setup({ reviews: [review("APPROVE")] });
  await run(s, ["build", "7"]);
  const reviewer = s.calls.find((c) => c.role === "reviewer");
  assert.match(reviewer.prompt, /Human after merge/);
  assert.match(reviewer.prompt, /never a blocking finding/);
});

test("build --fresh: escalation.md uses this run's implementer message, not an older run's log", async () => {
  const s = setup({
    branchExists: true,
    reviews: [null, null],
    implementer: () => ({ ok: true, subtype: "success", sessionId: "impl-1", costUsd: 1, turns: 4, durationMs: 10, structured: null, result: "new run, round 1" }),
  });
  mkdirSync(path.join(s.workDir, "runs"), { recursive: true });
  writeFileSync(path.join(s.workDir, "runs", "implementer-3.json"), JSON.stringify({ result: "OLD run, round 3" }));
  assert.equal(await run(s, ["build", "7", "--fresh"]), 2);
  const md = readFileSync(path.join(s.workDir, "escalation.md"), "utf8");
  assert.match(md, /Reason: reviewer-no-verdict/);
  assert.match(md, /## Implementer's last message \(round 1\)/);
  assert.match(md, /new run, round 1/);
  assert.doesNotMatch(md, /OLD run/);
});

test("build: a timed-out last implementer round still puts its reason into escalation.md", async () => {
  const rv = review("CHANGES_REQUESTED", [block]);
  const s = setup({
    reviews: [rv, rv, rv],
    implementer: (n) => n < 3
      ? { ok: true, subtype: "success", sessionId: "impl-1", costUsd: n, turns: 4, durationMs: 10, structured: null, result: "" }
      : { ok: false, subtype: "timeout", sessionId: null, costUsd: 0, turns: 0, durationMs: 10, structured: null, result: "killed after 2700000 ms" },
  });
  assert.equal(await run(s, ["build", "7"]), 2);
  assert.match(readFileSync(path.join(s.workDir, "escalation.md"), "utf8"), /round 3\)\n\nkilled after 2700000 ms/);
});
