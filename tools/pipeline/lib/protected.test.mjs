import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTECTED_PATHS, isProtectedPath, protectedPathsInstruction, reviewerProtectedPathsInstruction, protectedPathsInSpec,
} from "./protected.mjs";

test("PROTECTED_PATHS is the single list and covers .claude/**", () => {
  assert.ok(PROTECTED_PATHS.includes(".claude/**"));
});

test("isProtectedPath matches a .claude segment anywhere, either slash, and ignores look-alikes", () => {
  assert.equal(isProtectedPath(".claude"), true);
  assert.equal(isProtectedPath(".claude/rules/ordering.md"), true);
  assert.equal(isProtectedPath(".claude\\agents\\analyst.md"), true);
  assert.equal(isProtectedPath("./.claude/settings.json"), true);
  assert.equal(isProtectedPath("C:\\Users\\u\\eShop\\.claude\\rules\\ordering.md"), true);
  assert.equal(isProtectedPath("src/X/.claude/settings.json"), true);
  assert.equal(isProtectedPath("docs/.claude-notes.md"), false);
  assert.equal(isProtectedPath("src/Ordering.API/Apis/OrdersApi.cs"), false);
});

test("the analyst/planner instruction names every protected path and the 'Human after merge' section", () => {
  const text = protectedPathsInstruction();
  for (const p of PROTECTED_PATHS) assert.ok(text.includes(p), p);
  assert.match(text, /## Human after merge/);
  assert.match(text, /acceptance criterion/);
});

test("the reviewer instruction says Human-after-merge items are never blocking", () => {
  const text = reviewerProtectedPathsInstruction();
  for (const p of PROTECTED_PATHS) assert.ok(text.includes(p), p);
  assert.match(text, /Human after merge/);
  assert.match(text, /never a blocking finding/);
});

test("protectedPathsInSpec finds protected paths in Scope and Acceptance criteria, not in Out of scope or Human after merge", () => {
  const spec = [
    "# Spec",
    "## Scope",
    "- Update `src/Ordering.API/Apis/OrdersApi.cs`.",
    "- Update `.claude/rules/ordering.md:12`.",
    "## Acceptance criteria",
    "1. `C:\\repo\\.claude\\agents\\planner.md` mentions it.",
    "## Out of scope",
    "- `.claude/agents/analyst.md` stays as is.",
    "## Human after merge",
    "- Edit `.claude/settings.json`.",
  ].join("\n");
  assert.deepEqual(protectedPathsInSpec(spec), [".claude/rules/ordering.md", "C:/repo/.claude/agents/planner.md"]);
});

test("protectedPathsInSpec handles other heading levels and clean specs", () => {
  assert.deepEqual(protectedPathsInSpec("# Scope\n- touch .claude/rules/x.md\n"), [".claude/rules/x.md"]);
  assert.deepEqual(protectedPathsInSpec("# Spec\n## Scope\n- only src/A.cs\n"), []);
  assert.deepEqual(protectedPathsInSpec("no headings at all\n"), []);
});
