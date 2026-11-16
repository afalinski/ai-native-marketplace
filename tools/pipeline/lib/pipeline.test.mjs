import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../pipeline.mjs";

const block = { severity: "blocking", file: "src/A.cs", line: 3, rule: "spec", summary: "still logs the CVV" };
const review = (verdict, findings = []) => ({ verdict, summary: "s", findings });

function setup({ reviews, testsGreen = () => true, planText = "Touch src/Ordering.API/Apis/OrdersApi.cs" }) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "pipe-e2e-"));
  const workDir = path.join(repo, ".work", "7");
  mkdirSync(workDir, { recursive: true });
  const spec = "# spec\n";
  writeFileSync(path.join(workDir, "spec.md"), spec);
  writeFileSync(path.join(workDir, "issue.md"), "# Stop logging card data\n\nbody\n");
  const calls = [];
  const commits = [];
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
      branchExists: () => false,
      createWorktree: (_r, wt) => mkdirSync(wt, { recursive: true }),
      removeWorktree: () => {},
      changedFiles: () => ["src/Ordering.API/Apis/OrdersApi.cs"],
      restoreLineEndingOnly: () => [],
      diffPatch: () => "diff --git a b\n",
      numstat: () => ({ files: 3, added: 40, removed: 5, docsAdded: 0, docsRemoved: 0 }),
      commitByName: (wt, files, msg) => { commits.push({ files, msg }); return "deadbeef"; },
      pushBranch: () => { throw new Error("must not push"); },
    },
    tests: {
      runTests: (_wt, _files, k) => ({ green: testsGreen(), buildOk: true, ran: [], noTests: true, log: "build ok\n" }),
      dockerAvailable: () => true,
    },
    gh: {
      issueView: () => ({ title: "Stop logging card data", body: "body" }),
      prCreate: () => { throw new Error("must not create a PR"); },
    },
  };
  return { repo, workDir, deps, calls, commits };
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
