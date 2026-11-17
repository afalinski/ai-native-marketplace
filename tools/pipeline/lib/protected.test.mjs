import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTECTED_PATHS, isProtectedPath, protectedPathsInstruction, protectedPathsInScope } from "./protected.mjs";

test("PROTECTED_PATHS is the single list and covers .claude/**", () => {
  assert.ok(PROTECTED_PATHS.includes(".claude/**"));
});

test("isProtectedPath matches .claude/** with either slash and ignores look-alikes", () => {
  assert.equal(isProtectedPath(".claude/rules/ordering.md"), true);
  assert.equal(isProtectedPath(".claude\\agents\\analyst.md"), true);
  assert.equal(isProtectedPath("./.claude/settings.json"), true);
  assert.equal(isProtectedPath("docs/.claude-notes.md"), false);
  assert.equal(isProtectedPath("src/Ordering.API/Apis/OrdersApi.cs"), false);
});

test("the instruction names every protected path and the 'Human after merge' section", () => {
  const text = protectedPathsInstruction();
  for (const p of PROTECTED_PATHS) assert.ok(text.includes(p), p);
  assert.match(text, /## Human after merge/);
});

test("protectedPathsInScope finds protected paths only inside the Scope section", () => {
  const spec = [
    "# Spec",
    "## Scope",
    "- Update `src/Ordering.API/Apis/OrdersApi.cs`.",
    "- Update `.claude/rules/ordering.md:12`.",
    "## Acceptance criteria",
    "- nothing about .claude/agents here",
    "## Human after merge",
    "- Edit `.claude/rules/ordering.md`.",
  ].join("\n");
  assert.deepEqual(protectedPathsInScope(spec), [".claude/rules/ordering.md"]);
  assert.deepEqual(protectedPathsInScope("# Spec\n## Scope\n- only src/A.cs\n"), []);
  assert.deepEqual(protectedPathsInScope("# Spec without a scope section\n"), []);
});
