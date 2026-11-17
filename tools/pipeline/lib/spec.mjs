import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROLE_LIMITS } from "./claude.mjs";
import { addIntervention, roleEntry, sha256, workDirFor } from "./workdir.mjs";
import { protectedPathsInScope, protectedPathsInstruction } from "./protected.mjs";

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
  const t0 = Date.now();
  const r = await deps.claude({
    role: "analyst",
    prompt: `Work directory (absolute): ${workDir}\nRead ${path.join(workDir, "issue.md")} and write ${specPath}.\n${protectedPathsInstruction()}`,
    cwd: repo,
    workDir,
    permissionMode: "acceptEdits",
    addDirs: [workDir],
    logPath: path.join(workDir, "runs", "analyst-0.json"),
    ...ROLE_LIMITS.analyst,
  });
  writeFileSync(path.join(workDir, "spec-run.json"), JSON.stringify(roleEntry("analyst", 0, { ...r, wallMs: Date.now() - t0 })));
  if (!r.ok) {
    log(`analyst failed (${r.subtype}): ${r.result}`);
    return 1;
  }
  if (!existsSync(specPath)) {
    log("analyst finished but did not write spec.md");
    return 1;
  }
  const specText = readFileSync(specPath, "utf8");
  writeFileSync(path.join(workDir, "spec.sha256"), sha256(specText));
  const inScope = protectedPathsInScope(specText);
  if (inScope.length) {
    log(`WARNING: the Scope section names paths the pipeline cannot change: ${inScope.join(", ")}. Move them to "## Human after merge" before "build ${n}", or the build will escalate.`);
  }
  log(`spec written: ${specPath}\nReview and edit it; running "build ${n}" counts as approval.`);
  return 0;
}
