import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROLE_LIMITS } from "./claude.mjs";
import { addIntervention, roleEntry, sha256, workDirFor } from "./workdir.mjs";

// `spec <n>`: issue -> issue.md -> analyst (cwd = repo root) -> spec.md + spec.sha256. Returns an exit code.
export async function spec({ n, repo, deps, log }) {
  const workDir = workDirFor(repo, n);
  mkdirSync(workDir, { recursive: true });
  const issue = deps.gh.issueView(n, repo);
  writeFileSync(path.join(workDir, "issue.md"), `# ${issue.title}\n\n${issue.body}\n`);
  const specPath = path.join(workDir, "spec.md");
  if (existsSync(specPath)) {
    renameSync(specPath, path.join(workDir, "spec.prev.md"));
    addIntervention(workDir, "spec-rerun", "spec.md existed; kept as spec.prev.md");
  }
  const r = await deps.claude({
    role: "analyst",
    prompt: `Work directory (absolute): ${workDir}\nRead ${path.join(workDir, "issue.md")} and write ${specPath}.`,
    cwd: repo,
    workDir,
    permissionMode: "acceptEdits",
    addDirs: [workDir],
    logPath: path.join(workDir, "runs", "analyst-0.json"),
    ...ROLE_LIMITS.analyst,
  });
  writeFileSync(path.join(workDir, "spec-run.json"), JSON.stringify(roleEntry("analyst", 0, r)));
  if (!r.ok) {
    log(`analyst failed (${r.subtype}): ${r.result}`);
    return 1;
  }
  if (!existsSync(specPath)) {
    log("analyst finished but did not write spec.md");
    return 1;
  }
  writeFileSync(path.join(workDir, "spec.sha256"), sha256(readFileSync(specPath, "utf8")));
  log(`spec written: ${specPath}\nReview and edit it; running "build ${n}" counts as approval.`);
  return 0;
}
