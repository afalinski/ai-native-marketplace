import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mapTestProjects } from "./testrun.mjs";

function tree() {
  const dir = mkdtempSync(path.join(tmpdir(), "pipe-tr-"));
  mkdirSync(path.join(dir, "tests/Ordering.UnitTests"), { recursive: true });
  mkdirSync(path.join(dir, "tests/Ordering.FunctionalTests"), { recursive: true });
  return dir;
}

test("maps src project to existing test projects, ignores docs", () => {
  const dir = tree();
  try {
    assert.deepEqual(
      mapTestProjects(["src/Ordering.API/Apis/OrdersApi.cs", "docs/x.md"], dir),
      { unit: ["tests/Ordering.UnitTests"], functional: ["tests/Ordering.FunctionalTests"] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("docs-only maps to nothing", () => {
  const dir = tree();
  try {
    assert.deepEqual(mapTestProjects(["docs/x.md"], dir), { unit: [], functional: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing test folders and tools/.claude are ignored; backslashes normalised", () => {
  const dir = tree();
  try {
    assert.deepEqual(
      mapTestProjects(["tools/a.mjs", ".claude/x", "src\\Basket.API\\a.cs", "src/Ordering.Domain/x.cs"], dir),
      { unit: [], functional: [] });
    assert.deepEqual(
      mapTestProjects(["src\\Ordering.API\\a.cs"], dir),
      { unit: ["tests/Ordering.UnitTests"], functional: ["tests/Ordering.FunctionalTests"] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
