import { spawnSync } from "node:child_process";
import path from "node:path";

function run(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(" ")} failed (${r.status}): ${(r.stderr || "").trim()}`);
  }
  return r;
}

const norm = (p) => p.replace(/\\/g, "/");

export function createWorktree(repo, wtPath, branch) {
  run(repo, ["worktree", "add", "-b", branch, wtPath, "HEAD"]);
}

export function worktreeExists(repo, wtPath, branch) {
  const out = run(repo, ["worktree", "list", "--porcelain"]).stdout;
  const want = path.resolve(wtPath).toLowerCase();
  const found = out.split(/\r?\n/).some(
    (l) => l.startsWith("worktree ") && path.resolve(l.slice(9)).toLowerCase() === want);
  if (!found) return false;
  return run(repo, ["branch", "--list", branch]).stdout.trim() !== "";
}

export function removeWorktree(repo, wtPath, branch) {
  run(repo, ["worktree", "remove", "--force", wtPath], { allowFail: true });
  run(repo, ["worktree", "prune"], { allowFail: true });
  run(repo, ["branch", "-D", branch], { allowFail: true });
}

// Paths from `git status --porcelain -z`, including untracked files (each file listed, not directories).
export function changedFiles(wt) {
  const out = run(wt, ["status", "--porcelain", "-z", "--untracked-files=all"]).stdout;
  const parts = out.split("\0").filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    files.push(parts[i].slice(3));
    if (code[0] === "R" || code[0] === "C") i++; // skip the original path of a rename
  }
  return files;
}

function globToRegExp(glob) {
  const re = norm(glob).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${re}$`);
}

export function restoreLineEndingOnly(wt, globs = ["src/Catalog.API/Catalog.API*.json"]) {
  const res = globs.map(globToRegExp);
  const modified = run(wt, ["diff", "--name-only", "-z"]).stdout.split("\0").filter(Boolean);
  const restored = [];
  for (const f of modified) {
    if (!res.some((re) => re.test(f))) continue;
    const q = run(wt, ["diff", "--ignore-cr-at-eol", "--quiet", "--", f], { allowFail: true });
    if (q.status === 0) {
      run(wt, ["checkout", "--", f]);
      restored.push(f);
    }
  }
  return restored;
}

function intentToAdd(wt) {
  const untracked = run(wt, ["ls-files", "--others", "--exclude-standard", "-z"]).stdout.split("\0").filter(Boolean);
  for (const f of untracked) run(wt, ["add", "-N", "--", f]);
}

export function diffPatch(wt, base) {
  intentToAdd(wt);
  return run(wt, ["diff", base]).stdout;
}

const isDocs = (f) => f === "CLAUDE.md" || f.startsWith("docs/");

export function numstat(wt, base) {
  intentToAdd(wt);
  const out = run(wt, ["diff", "--numstat", "-z", base]).stdout;
  const r = { files: 0, added: 0, removed: 0, docsAdded: 0, docsRemoved: 0 };
  // With -z: "<add>\t<del>\t<path>\0"; renames: "<add>\t<del>\t\0old\0new\0" (new path is used).
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const m = /^(\S+)\t(\S+)\t(.*)$/s.exec(parts[i]);
    if (!m) continue;
    let file = m[3];
    if (file === "") { file = parts[i + 2] ?? ""; i += 2; }
    const a = m[1] === "-" ? 0 : Number(m[1]);
    const d = m[2] === "-" ? 0 : Number(m[2]);
    r.files++;
    if (isDocs(file)) { r.docsAdded += a; r.docsRemoved += d; }
    else { r.added += a; r.removed += d; }
  }
  return r;
}

export function commitByName(wt, files, message) {
  if (!files.length) throw new Error("commitByName: no files");
  run(wt, ["add", "--", ...files]);
  run(wt, ["commit", "-m", message, "--", ...files]);
  return run(wt, ["rev-parse", "HEAD"]).stdout.trim();
}
