import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "./report.mjs";

const fixture = () => ({
  issue: 7,
  title: "Stop logging card data",
  startedAt: "2026-11-16T10:00:00Z",
  finishedAt: "2026-11-16T10:30:00Z",
  outcome: "success",
  rounds: 2,
  roles: [
    { role: "planner", round: 0, costUsd: 0.5, turns: 5, durationMs: 60000, subtype: "success" },
    { role: "implementer", round: 1, costUsd: 1.25, turns: 20, durationMs: 300000, subtype: "success" },
  ],
  totalCostUsd: 1.75,
  costLabel: "client-side estimate",
  diff: { files: 3, added: 40, removed: 5, docsAdded: 2, docsRemoved: 1 },
  interventions: [],
  reviewerConsistency: [false, true],
  nonBlocking: [{ severity: "non-blocking", file: "src/A.cs", line: 12, rule: "test", summary: "rename the helper" }],
  noTestsRan: false,
});

test("renderReport: success fixture", () => {
  const md = renderReport(fixture());
  assert.match(md, /Rounds: 2/);
  assert.match(md, /\$1\.75 \(client-side estimate\)/);
  assert.match(md, /Files changed: 3 \(\+40 \/ -5\)/);
  assert.match(md, /Not fixed \(non-blocking\)/);
  assert.match(md, /src\/A\.cs:12/);
  assert.match(md, /rename the helper/);
  assert.match(md, /Interventions[\s\S]*none/);
});

test("renderReport: interventions and no-tests flag", () => {
  const m = fixture();
  m.interventions = [{ kind: "spec-edited", at: "2026-11-16T09:00:00Z", note: "hash changed" }];
  m.noTestsRan = true;
  m.nonBlocking = [];
  const md = renderReport(m);
  assert.match(md, /spec-edited/);
  assert.match(md, /no tests ran/i);
  assert.match(md, /Not fixed \(non-blocking\)[\s\S]*none/);
});
