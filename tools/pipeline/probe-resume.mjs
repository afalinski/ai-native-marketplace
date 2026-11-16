// Probe: does --agent (and its tool limits) survive --resume, is total_cost_usd cumulative,
// and what subtype does a max-turns stop have. Prompts go on stdin.
// Run from the repo root: node tools/pipeline/probe-resume.mjs
// Spawn form that works on this Windows host: spawnSync("claude", args, { shell: true }).
// Plain "claude" and "claude.exe" give ENOENT, "claude.cmd" without a shell gives EINVAL.
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "probe-resume-"));
const agentsFile = join(dir, "agents.json");
writeFileSync(agentsFile, JSON.stringify({
  "probe-readonly": {
    description: "Read-only probe agent",
    prompt: "You are a read-only probe. Answer briefly.",
    tools: ["Read", "Grep", "Glob"],
    model: "sonnet",
  },
}));
const agentArgs = ["--agent", "probe-readonly"];
const agentsDef = ["--agents", `"${agentsFile}"`];

function claude(prompt, args) {
  const r = spawnSync("claude", ["-p", ...args], { input: prompt, encoding: "utf8", shell: true });
  // A max-turns stop exits with status 1 but still prints the result JSON, so only fail on no output.
  if (r.error || !r.stdout) {
    console.log("claude failed", r.error, r.status, r.stderr, r.stdout);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  return r.stdout;
}

function summary(j) {
  return {
    session_id: j.session_id,
    total_cost_usd: j.total_cost_usd,
    num_turns: j.num_turns,
    subtype: j.subtype,
    permission_denials: (j.permission_denials || []).map((d) => d.tool_name),
  };
}

function run(label, prompt, extra) {
  const j = JSON.parse(claude(prompt, ["--output-format", "json", ...agentsDef, ...extra]));
  console.log(label, JSON.stringify(summary(j)));
  console.log("  result:", String(j.result ?? "").slice(0, 200).replace(/\s+/g, " "));
  return j;
}

// stream-json run: print the system/init tools array (what the model is actually offered).
function runStream(label, prompt, extra) {
  const lines = claude(prompt, ["--output-format", "stream-json", "--verbose", ...extra])
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const init = lines.find((e) => e.type === "system" && e.subtype === "init");
  const res = lines.find((e) => e.type === "result");
  console.log(label, "init.session_id:", init?.session_id, "init.tools:", JSON.stringify(init?.tools));
  console.log(" ", label, JSON.stringify(summary(res)));
  return { init, res };
}

try {
  const r1 = run("run1", "List the tools you have, then stop.", [...agentArgs, "--max-turns", "2"]);
  const r2 = run("run2", "Try to run the Bash command `git status`.", ["--resume", r1.session_id, ...agentArgs]);
  const r3 = run("run3", "Read package.json, then README.md, then CLAUDE.md, then summarize each in one line.", ["--resume", r2.session_id, ...agentArgs, "--max-turns", "1"]);
  // run 4: resume, --agent re-passed (how the orchestrator will call it)
  runStream("run4", "Say OK.", ["--resume", r1.session_id, ...agentsDef, ...agentArgs]);
  // run 5: resume, no --agent / --agents
  runStream("run5", "Say OK.", ["--resume", r1.session_id]);
  console.log("cost run2 >= run1:", r2.total_cost_usd >= r1.total_cost_usd);
  console.log("run3 subtype:", r3.subtype);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
