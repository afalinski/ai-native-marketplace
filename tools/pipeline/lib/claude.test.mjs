import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeArgs, costDelta, parseShim, ROLE_LIMITS, IMPLEMENTER_ALLOWED_TOOLS } from "./claude.mjs";

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../review.schema.json");
const IMPL_TOOLS = "Bash(dotnet build *),Bash(dotnet test *),Bash(git status *),Bash(git diff *)";
const val = (args, flag) => args[args.indexOf(flag) + 1];

test("buildClaudeArgs: reviewer", () => {
  const a = buildClaudeArgs({ role: "reviewer", schemaPath });
  assert.ok(a.includes("-p"));
  assert.equal(val(a, "--agent"), "reviewer");
  assert.equal(val(a, "--output-format"), "json");
  assert.ok(!a.includes("--bare"));
  const schema = JSON.parse(val(a, "--json-schema"));
  assert.ok(!("$schema" in schema));
  for (const k of ["verdict", "summary", "findings"]) assert.ok(schema.required.includes(k));
});

test("buildClaudeArgs: implementer resume keeps --agent and tool rights", () => {
  const a = buildClaudeArgs({ role: "implementer", resumeId: "abc", permissionMode: "acceptEdits", allowedTools: IMPLEMENTER_ALLOWED_TOOLS, maxTurns: 60, maxBudgetUsd: 5 });
  assert.equal(val(a, "--resume"), "abc");
  assert.equal(val(a, "--agent"), "implementer");
  assert.equal(val(a, "--allowedTools"), IMPL_TOOLS);
  assert.equal(val(a, "--permission-mode"), "acceptEdits");
  assert.equal(val(a, "--max-turns"), "60");
  assert.equal(val(a, "--max-budget-usd"), "5");
  assert.ok(!a.includes("--json-schema"));
});

test("buildClaudeArgs: addDirs", () => {
  const a = buildClaudeArgs({ role: "analyst", addDirs: ["/x", "/y"] });
  assert.deepEqual(a.slice(a.indexOf("--add-dir")), ["--add-dir", "/x", "--add-dir", "/y"]);
});

test("ROLE_LIMITS", () => {
  assert.deepEqual(ROLE_LIMITS.implementer, { maxTurns: 60, maxBudgetUsd: 5 });
  assert.deepEqual(ROLE_LIMITS["docs-writer"], { maxTurns: 15, maxBudgetUsd: 1 });
});

test("costDelta", () => {
  assert.equal(costDelta(null, 0.4), 0.4);
  assert.ok(Math.abs(costDelta(0.4, 1.1) - 0.7) < 1e-9);
});

// Fixtures write "|" for a backslash so the strings stay readable.
const bs = (s) => s.replaceAll("|", String.fromCharCode(92));
const DIR = bs("C:|npm");

test("parseShim: native exe shim (real shape)", () => {
  const cmd = bs('@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%|node_modules|@anthropic-ai|claude-code|bin|claude.exe"   %*\r\n');
  const r = parseShim(cmd, DIR);
  assert.equal(r.command, bs("C:|npm|node_modules|@anthropic-ai|claude-code|bin|claude.exe"));
  assert.deepEqual(r.prefixArgs, []);
});

test("parseShim: JS entry shim", () => {
  const cmd = bs('@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\nIF EXIST "%dp0%|node.exe" (\r\n  SET "_prog=%dp0%|node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n"%_prog%"  "%dp0%|node_modules|@anthropic-ai|claude-code|cli.js" %*\r\n');
  const r = parseShim(cmd, DIR);
  assert.equal(r.command, process.execPath);
  assert.deepEqual(r.prefixArgs, [bs("C:|npm|node_modules|@anthropic-ai|claude-code|cli.js")]);
});

test("parseShim: unrecognised shim throws", () => {
  assert.throws(() => parseShim("@echo hi", DIR), /claude/i);
});
