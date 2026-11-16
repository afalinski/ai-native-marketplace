import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const ROLE_LIMITS = {
  analyst: { maxTurns: 30, maxBudgetUsd: 3 },
  planner: { maxTurns: 30, maxBudgetUsd: 3 },
  implementer: { maxTurns: 60, maxBudgetUsd: 5 },
  reviewer: { maxTurns: 25, maxBudgetUsd: 2 },
  "docs-writer": { maxTurns: 15, maxBudgetUsd: 1 },
};

export const IMPLEMENTER_ALLOWED_TOOLS =
  "Bash(dotnet build *),Bash(dotnet test *),Bash(git status *),Bash(git diff *)";

// Pure. --agent is always passed, also with --resume (the role is lost otherwise).
// --json-schema takes the schema JSON text, not a path. Never --bare.
export function buildClaudeArgs({ role, resumeId, schemaPath, maxTurns, maxBudgetUsd, permissionMode, allowedTools, addDirs }) {
  const args = ["-p", "--output-format", "json", "--agent", role];
  if (resumeId) args.push("--resume", resumeId);
  if (schemaPath) {
    // claude rejects the draft 2020-12 "$schema" URI (unknown ref), so it is dropped from the text.
    const { $schema, ...schema } = JSON.parse(readFileSync(schemaPath, "utf8"));
    args.push("--json-schema", JSON.stringify(schema));
  }
  if (maxTurns != null) args.push("--max-turns", String(maxTurns));
  if (maxBudgetUsd != null) args.push("--max-budget-usd", String(maxBudgetUsd));
  if (permissionMode) args.push("--permission-mode", permissionMode);
  if (allowedTools) args.push("--allowedTools", allowedTools);
  for (const d of addDirs ?? []) args.push("--add-dir", d);
  return args;
}

export function costDelta(prevCumulativeUsd, currentUsd) {
  return currentUsd - (prevCumulativeUsd ?? 0);
}

// Parse an npm .cmd shim: find the program it runs. A native .exe is returned as the command;
// a .js/.mjs/.cjs entry is run with node.
export function parseShim(text, shimDir) {
  const refs = [...text.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs.reverse()) {
    const full = path.win32.join(shimDir, ref);
    if (/\.exe$/i.test(ref) && !/(^|\\)node\.exe$/i.test(ref)) return { command: full, prefixArgs: [] };
    if (/\.(c|m)?js$/i.test(ref)) return { command: process.execPath, prefixArgs: [full] };
  }
  throw new Error("cannot find the claude entry in the claude.cmd shim");
}

export function resolveClaudeCommand() {
  if (process.env.PIPELINE_CLAUDE_BIN) return { command: process.env.PIPELINE_CLAUDE_BIN, prefixArgs: [] };
  if (process.platform !== "win32") return { command: "claude", prefixArgs: [] };
  for (const dir of (process.env.PATH ?? "").split(";").filter(Boolean)) {
    const shim = path.join(dir, "claude.cmd");
    if (existsSync(shim)) return parseShim(readFileSync(shim, "utf8"), dir);
  }
  throw new Error("claude.cmd not found on PATH (set PIPELINE_CLAUDE_BIN)");
}

export function runClaude({ prompt, cwd, workDir, logPath, ...argsOpts }) {
  const { command, prefixArgs } = resolveClaudeCommand();
  const args = [...prefixArgs, ...buildClaudeArgs(argsOpts)];
  const env = { ...process.env, PIPELINE_WORK_DIR: path.resolve(workDir) };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      if (logPath) {
        mkdirSync(path.dirname(logPath), { recursive: true });
        writeFileSync(logPath, stdout);
      }
      let j;
      try {
        j = JSON.parse(stdout);
      } catch {
        resolve({
          ok: false, subtype: "invalid_output", sessionId: null, costUsd: 0, turns: 0, durationMs: 0,
          structured: null, result: `exit ${code}; stderr: ${Buffer.concat(err).toString("utf8").slice(0, 500)}`,
        });
        return;
      }
      resolve({
        ok: j.subtype === "success",
        subtype: j.subtype,
        sessionId: j.session_id ?? null,
        costUsd: j.total_cost_usd ?? 0, // raw cumulative; callers take costDelta for resumed sessions
        turns: j.num_turns ?? 0,
        durationMs: j.duration_ms ?? 0,
        structured: j.structured_output ?? null,
        result: j.result ?? "",
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt ?? "");
  });
}
