// Probe: does --agent (and its tool limits) survive --resume, is total_cost_usd cumulative,
// and what subtype does a max-turns stop have. Prompts go on stdin.
// Spawn form that works on this Windows host: spawnSync("claude", args, { shell: true }).
// Plain "claude" and "claude.exe" give ENOENT, "claude.cmd" without a shell gives EINVAL.
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
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

function run(label, prompt, extra) {
  const args = ["-p", "--output-format", "json", "--agents", `"${agentsFile}"`, ...extra];
  const r = spawnSync("claude", args, { input: prompt, encoding: "utf8", shell: true });
  let j;
  try { j = JSON.parse(r.stdout); } catch { console.log(label, "unparseable", r.status, r.stdout, r.stderr); process.exit(1); }
  console.log(label, JSON.stringify({
    session_id: j.session_id,
    total_cost_usd: j.total_cost_usd,
    num_turns: j.num_turns,
    subtype: j.subtype,
    permission_denials: (j.permission_denials || []).map((d) => d.tool_name),
  }));
  console.log("  result:", String(j.result ?? "").slice(0, 200).replace(/\s+/g, " "));
  return j;
}

const r1 = run("run1", "List the tools you have, then stop.", ["--agent", "probe-readonly", "--max-turns", "2"]);
const r2 = run("run2", "Try to run the Bash command `git status`.", ["--resume", r1.session_id, "--agent", "probe-readonly"]);
const r3 = run("run3", "Read package.json, then README.md, then CLAUDE.md, then summarize each in one line.", ["--resume", r2.session_id, "--agent", "probe-readonly", "--max-turns", "1"]);
console.log("cost cumulative (run2 >= run1):", r2.total_cost_usd >= r1.total_cost_usd);
console.log("run3 subtype:", r3.subtype);
