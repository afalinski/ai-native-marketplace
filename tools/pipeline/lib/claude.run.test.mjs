import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runClaude } from "./claude.mjs";

// The fake claude is a node script: PIPELINE_CLAUDE_BIN = node, PIPELINE_CLAUDE_PREFIX_ARGS = JSON ["<script>"].
function withFake(body, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fakeclaude-"));
  const script = path.join(dir, "fake.mjs");
  writeFileSync(script, body);
  const saved = [process.env.PIPELINE_CLAUDE_BIN, process.env.PIPELINE_CLAUDE_PREFIX_ARGS];
  process.env.PIPELINE_CLAUDE_BIN = process.execPath;
  process.env.PIPELINE_CLAUDE_PREFIX_ARGS = JSON.stringify([script]);
  const restore = () => {
    for (const [i, k] of ["PIPELINE_CLAUDE_BIN", "PIPELINE_CLAUDE_PREFIX_ARGS"].entries()) {
      if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i];
    }
  };
  return fn(dir).finally(restore);
}

test("runClaude: timeout kills the child and returns subtype timeout", () =>
  withFake("setTimeout(() => {}, 60000);", async (dir) => {
    const r = await runClaude({ prompt: "x", cwd: dir, workDir: dir, role: "analyst", timeoutMs: 300 });
    assert.equal(r.ok, false);
    assert.equal(r.subtype, "timeout");
  }));

test("runClaude: valid but non-object JSON is invalid_output", () =>
  withFake("process.stdout.write('null');", async (dir) => {
    const r = await runClaude({ prompt: "x", cwd: dir, workDir: dir, role: "analyst" });
    assert.equal(r.ok, false);
    assert.equal(r.subtype, "invalid_output");
  }));

test("runClaude: normal success through the fake", () =>
  withFake("process.stdout.write(JSON.stringify({subtype:'success',session_id:'s1',total_cost_usd:0.5,num_turns:3,result:'hi'}));", async (dir) => {
    const r = await runClaude({ prompt: "x", cwd: dir, workDir: dir, role: "analyst" });
    assert.equal(r.ok, true);
    assert.equal(r.sessionId, "s1");
    assert.equal(r.costUsd, 0.5);
  }));
