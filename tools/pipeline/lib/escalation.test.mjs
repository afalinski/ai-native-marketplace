import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { escalationMd, lastImplementerMessage } from "./escalation.mjs";

const result = { reason: "max-rounds", rounds: 3 };
const lastReview = { findings: [
  { severity: "blocking", file: ".claude/rules/ordering.md", line: 12, rule: "spec", summary: "line not updated" },
  { severity: "non-blocking", file: "src/A.cs", line: 1, rule: "test", summary: "nit" },
] };
const lastTests = { green: true, log: "all passed" };

function workDirWithRuns(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pipe-esc-"));
  mkdirSync(path.join(dir, "runs"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, "runs", name), body);
  return dir;
}

test("escalation.md has the reviewer's blocking findings, the tests and the implementer's last message", () => {
  const md = escalationMd({ result, lastTests, lastReview, implementerLast: { round: 3, text: "The edit tool refused it: the file is sensitive." } });
  assert.match(md, /Reason: max-rounds/);
  assert.match(md, /`\.claude\/rules\/ordering\.md:12` \[spec\] line not updated/);
  assert.doesNotMatch(md, /nit/);
  assert.match(md, /## Implementer's last message \(round 3\)/);
  assert.match(md, /The edit tool refused it: the file is sensitive\./);
  assert.match(md, /green/);
});

test("escalation.md says so when there is no implementer message", () => {
  const md = escalationMd({ result, lastTests, lastReview, implementerLast: null });
  assert.match(md, /## Implementer's last message/);
  assert.match(md, /not available/);
});

test("lastImplementerMessage reads the given round, not the highest file on disk (a --fresh rerun)", () => {
  const dir = workDirWithRuns({
    "implementer-1.json": JSON.stringify({ result: "this run, round one" }),
    "implementer-3.json": JSON.stringify({ result: "an older run, round three" }),
  });
  assert.deepEqual(lastImplementerMessage(dir, 1), { round: 1, text: "this run, round one" });
});

test("lastImplementerMessage falls back to the in-memory result when the log is empty, not JSON or missing", () => {
  const dir = workDirWithRuns({ "implementer-2.json": "", "implementer-3.json": "not json" });
  assert.deepEqual(lastImplementerMessage(dir, 2, "killed after 2700000 ms"), { round: 2, text: "killed after 2700000 ms" });
  assert.deepEqual(lastImplementerMessage(dir, 3, "fallback"), { round: 3, text: "fallback" });
  assert.deepEqual(lastImplementerMessage(dir, 4, "no log at all"), { round: 4, text: "no log at all" });
  assert.equal(lastImplementerMessage(dir, 3, ""), null);
  assert.equal(lastImplementerMessage(dir, undefined, "x"), null);
});
