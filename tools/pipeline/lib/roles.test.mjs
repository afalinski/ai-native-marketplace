import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Small frontmatter reader: top-level "key: value" lines, with `tools` split into a list.
// The hooks block is kept as raw text.
function readRole(name) {
  const text = readFileSync(path.join(root, ".claude/agents", `${name}.md`), "utf8").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${name}: frontmatter missing`);
  const fm = { raw: m[1], body: text.slice(m[0].length) };
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  fm.toolList = (fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return fm;
}

const models = { analyst: "opus", planner: "opus", implementer: "sonnet", reviewer: "sonnet", "docs-writer": "sonnet" };

for (const [role, model] of Object.entries(models)) {
  test(`${role}: name and model`, () => {
    const fm = readRole(role);
    assert.equal(fm.name, role);
    assert.equal(fm.model, model);
    assert.ok(fm.description);
    assert.ok(!("permissionMode" in fm) && !("maxTurns" in fm));
  });
}

test("reviewer tools are exactly Read, Grep, Glob, StructuredOutput", () => {
  assert.deepEqual(readRole("reviewer").toolList, ["Read", "Grep", "Glob", "StructuredOutput"]);
});

test("reviewer and docs-writer have no Bash", () => {
  for (const r of ["reviewer", "docs-writer"]) assert.ok(!readRole(r).toolList.includes("Bash"), r);
});

test("reviewer has no Edit or Write", () => {
  const t = readRole("reviewer").toolList;
  assert.ok(!t.includes("Edit") && !t.includes("Write"));
});

test("analyst and planner: work-dir write guard", () => {
  for (const r of ["analyst", "planner"]) {
    const fm = readRole(r);
    assert.match(fm.raw, /matcher:\s*"Write"/, r);
    assert.match(fm.raw, /pipeline-write\.mjs[^\n]*"work"/, r);
  }
});

test("docs-writer: docs guard on Edit", () => {
  const fm = readRole("docs-writer");
  assert.match(fm.raw, /matcher:\s*"Edit"/);
  assert.match(fm.raw, /pipeline-write\.mjs[^\n]*"docs"/);
});

test("implementer has Bash and a worktree write guard on Write|Edit", () => {
  const fm = readRole("implementer");
  assert.ok(fm.toolList.includes("Bash"));
  assert.match(fm.raw, /matcher:\s*"Write\|Edit"/);
  assert.match(fm.raw, /pipeline-write\.mjs[^\n]*"worktree"/);
});

test("review.schema.json requires verdict, summary, findings", () => {
  const s = JSON.parse(readFileSync(path.join(root, "tools/pipeline/review.schema.json"), "utf8"));
  assert.deepEqual([...s.required].sort(), ["findings", "summary", "verdict"]);
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.properties.verdict.enum, ["APPROVE", "CHANGES_REQUESTED"]);
  const f = s.properties.findings.items;
  assert.equal(f.additionalProperties, false);
  assert.deepEqual(f.properties.severity.enum, ["blocking", "non-blocking"]);
  assert.deepEqual(f.properties.rule.enum, ["spec", "claude-md", "correctness", "test"]);
  assert.equal(f.properties.line.type, "integer");
  assert.deepEqual([...f.required].sort(), ["file", "line", "rule", "severity", "summary"]);
});
