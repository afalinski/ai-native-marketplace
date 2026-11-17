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

test("lastImplementerMessage reads the highest round from runs/implementer-<k>.json", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pipe-esc-"));
  mkdirSync(path.join(dir, "runs"));
  writeFileSync(path.join(dir, "runs", "implementer-1.json"), JSON.stringify({ result: "round one" }));
  writeFileSync(path.join(dir, "runs", "implementer-3.json"), JSON.stringify({ result: "round three" }));
  writeFileSync(path.join(dir, "runs", "implementer-2.json"), JSON.stringify({ result: "round two" }));
  writeFileSync(path.join(dir, "runs", "reviewer-3.json"), JSON.stringify({ result: "not me" }));
  assert.deepEqual(lastImplementerMessage(dir), { round: 3, text: "round three" });
});

test("lastImplementerMessage returns null when there is no run log or it is not JSON", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pipe-esc-"));
  assert.equal(lastImplementerMessage(dir), null);
  mkdirSync(path.join(dir, "runs"));
  writeFileSync(path.join(dir, "runs", "implementer-1.json"), "not json");
  assert.equal(lastImplementerMessage(dir), null);
});
