// PreToolUse guard for the pipeline roles (analyst, planner, docs-writer).
// Usage: node pipeline-write.mjs <work|docs|worktree>
//   work: may write only under $PIPELINE_WORK_DIR (set by the orchestrator), but not under its wt/ subfolder (the worktree).
//   worktree: may write only under $CLAUDE_PROJECT_DIR (the implementer's worktree).
//   docs: may write only under <project>/docs/ and to <project>/CLAUDE.md.
// Wired in each agent's frontmatter. Exit code 2 blocks the call.
import { readFileSync } from "node:fs";
import path from "node:path";

// Fail closed: a crash inside this guard must block the call, not let it through.
process.on("uncaughtException", (error) => {
  process.stderr.write(`Guard failed, blocking to be safe: ${error.message}\n`);
  process.exit(2);
});

const block = (message) => {
  process.stderr.write(`Blocked by .claude/hooks/pipeline-write.mjs: ${message}\n`);
  process.exit(2);
};

const mode = process.argv[2];
const input = JSON.parse(readFileSync(0, "utf8"));
const file = String(input.tool_input?.file_path ?? "");
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd;
const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

if (!file) block("no file path.");

let dirs; // allowed subtrees
let files = []; // allowed exact files
let excluded = []; // subtrees blocked even inside an allowed one
if (mode === "work") {
  const work = process.env.PIPELINE_WORK_DIR;
  if (!work) block("PIPELINE_WORK_DIR is not set.");
  dirs = [path.resolve(work)];
  excluded = [path.resolve(work, "wt")];
} else if (mode === "worktree") {
  const proj = process.env.CLAUDE_PROJECT_DIR;
  if (!proj) block("CLAUDE_PROJECT_DIR is not set.");
  dirs = [path.resolve(proj)];
} else if (mode === "docs") {
  dirs = [path.resolve(root, "docs")];
  files = [path.resolve(root, "CLAUDE.md")];
} else {
  block(`unknown mode "${mode ?? ""}" (expected work, docs or worktree).`);
}

// file_path arrives absolute, with backslashes on Windows. path.resolve normalises both.
const target = fold(path.resolve(root, file));
const ok =
  !excluded.some((d) => target === fold(d) || target.startsWith(fold(d) + path.sep)) &&
  dirs.some((d) => target.startsWith(fold(d) + path.sep)) || files.some((f) => target === fold(f));

if (!ok) {
  block(
    `mode "${mode}" may write only ${{ work: "under PIPELINE_WORK_DIR (not its wt/)", worktree: "under CLAUDE_PROJECT_DIR", docs: "under docs/ and to CLAUDE.md" }[mode]}, not to ${file}.`
  );
}
