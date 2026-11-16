import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRound, runRounds, renderReviewMd } from "./loop.mjs";

const green = { green: true, buildOk: true, ran: true, noTests: false, log: "ok" };
const red = { green: false, buildOk: true, ran: true, noTests: false, log: "FAILED x" };
const approve = { verdict: "APPROVE", summary: "fine", findings: [] };
const blockingFinding = { severity: "blocking", file: "a.cs", line: 3, rule: "R1", summary: "null deref" };
const nonBlockingFinding = { severity: "non-blocking", file: "b.cs", line: 9, rule: "R2", summary: "naming" };
const changes = (...findings) => ({ verdict: "CHANGES_REQUESTED", summary: "needs work", findings });

function fakes({ tests, reviews, implResults }) {
  const calls = { implement: [], test: [], review: [] };
  return {
    calls,
    implement: async (k, feedback) => { calls.implement.push({ k, feedback }); return implResults?.[k - 1] ?? { ok: true }; },
    test: async (k) => { calls.test.push(k); return tests[Math.min(k, tests.length) - 1]; },
    review: async (k) => { calls.review.push(k); return { structured: reviews.shift() }; },
  };
}

test("evaluateRound counts blocking findings and consistency", () => {
  assert.deepEqual(evaluateRound({ tests: green, review: approve }), { pass: true, blocking: 0, consistent: true });
  const r = evaluateRound({ tests: green, review: changes(blockingFinding) });
  assert.deepEqual(r, { pass: false, blocking: 1, consistent: true });
  assert.equal(evaluateRound({ tests: red, review: approve }).pass, false);
  assert.equal(evaluateRound({ tests: green, review: null }).pass, false);
});

test("passes in round 1: implement called once, feedback null", async () => {
  const f = fakes({ tests: [green], reviews: [approve] });
  const r = await runRounds(f);
  assert.equal(r.outcome, "success");
  assert.equal(r.rounds, 1);
  assert.equal(f.calls.implement.length, 1);
  assert.equal(f.calls.implement[0].feedback, null);
  assert.deepEqual(r.consistency, [true]);
  assert.deepEqual(r.nonBlocking, []);
  assert.equal(r.history[0].reviewRetried, false);
});

test("fails round 1, passes round 2 with feedback from round 1", async () => {
  const f = fakes({ tests: [red, green], reviews: [changes(blockingFinding), approve] });
  const r = await runRounds(f);
  assert.equal(r.outcome, "success");
  assert.equal(r.rounds, 2);
  const fb = f.calls.implement[1].feedback;
  assert.match(fb.reviewMd, /null deref/);
  assert.equal(fb.testsLog, "FAILED x");
  assert.equal(r.history.length, 2);
  assert.deepEqual(Object.keys(r.history[0]).sort(), ["evaluation", "implement", "k", "review", "reviewRetried", "tests"]);
});

test("red in all 3 rounds escalates with max-rounds and no 4th implement", async () => {
  const f = fakes({ tests: [red], reviews: [approve, approve, approve] });
  const r = await runRounds(f);
  assert.equal(r.outcome, "escalated");
  assert.equal(r.reason, "max-rounds");
  assert.equal(r.rounds, 3);
  assert.equal(f.calls.implement.length, 3);
});

test("reviewer null twice escalates with reviewer-no-verdict", async () => {
  const f = fakes({ tests: [green], reviews: [null, null] });
  const r = await runRounds(f);
  assert.equal(r.outcome, "escalated");
  assert.equal(r.reason, "reviewer-no-verdict");
  assert.equal(r.rounds, 1);
  assert.equal(f.calls.review.length, 2);
  assert.equal(r.history[0].reviewRetried, true);
  assert.equal(f.calls.implement.length, 1);
});

test("reviewer null once is retried and the round continues", async () => {
  const f = fakes({ tests: [green], reviews: [null, approve] });
  const r = await runRounds(f);
  assert.equal(r.outcome, "success");
  assert.equal(r.history[0].reviewRetried, true);
});

test("implementer error_max_turns still runs test and review", async () => {
  const f = fakes({ tests: [green], reviews: [approve], implResults: [{ ok: false, subtype: "error_max_turns" }] });
  const r = await runRounds(f);
  assert.equal(r.outcome, "success");
  assert.deepEqual(f.calls.test, [1]);
  assert.deepEqual(f.calls.review, [1]);
  assert.equal(r.history[0].implement.subtype, "error_max_turns");
});

test("CHANGES_REQUESTED with only non-blocking findings and green passes, inconsistent", async () => {
  const f = fakes({ tests: [green], reviews: [changes(nonBlockingFinding)] });
  const r = await runRounds(f);
  assert.equal(r.outcome, "success");
  assert.deepEqual(r.consistency, [false]);
  assert.deepEqual(r.nonBlocking, [nonBlockingFinding]);
});

test("renderReviewMd lists blocking and non-blocking, none when empty", () => {
  const md = renderReviewMd(changes(blockingFinding, nonBlockingFinding));
  assert.match(md, /CHANGES_REQUESTED/);
  assert.match(md, /needs work/);
  assert.match(md, /- `a\.cs:3` \[R1\] null deref/);
  assert.match(md, /- `b\.cs:9` \[R2\] naming/);
  const empty = renderReviewMd(approve);
  assert.match(empty, /Blocking[\s\S]*none[\s\S]*Non-blocking[\s\S]*none/);
});
