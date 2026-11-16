import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IMPLEMENTER_ALLOWED_TOOLS, ROLE_LIMITS, costDelta } from "./claude.mjs";
import { mapTestProjects } from "./testrun.mjs";
import { renderReviewMd, runRounds } from "./loop.mjs";
import { renderReport } from "./report.mjs";
import { addIntervention, readInterventions, roleEntry, sha256, workDirFor } from "./workdir.mjs";

const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../review.schema.json");
const write = (p, text) => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const nowIso = () => new Date().toISOString();

// Files named in plan.md as src/<Project>/... paths (a simple regex; used for the Docker check before round 1).
export function planFiles(planText) {
  return [...new Set([...planText.replace(/\\/g, "/").matchAll(/src\/[A-Za-z0-9_.-]+\//g)].map((m) => m[0] + "x"))];
}

class EnvironmentError extends Error {}

function readSpecRun(workDir) {
  const p = path.join(workDir, "spec-run.json");
  return existsSync(p) ? [JSON.parse(readFileSync(p, "utf8"))] : [];
}

function escalationMd({ result, lastTests, lastReview }) {
  const open = (lastReview?.findings ?? []).filter((f) => f.severity === "blocking");
  return [
    "# Escalation",
    "",
    `Reason: ${result.reason}`,
    `Rounds used: ${result.rounds}`,
    "",
    "## Open blocking findings",
    "",
    open.length ? open.map((f) => `- \`${f.file}:${f.line}\` [${f.rule}] ${f.summary}`).join("\n") : "none (see reason)",
    "",
    "## Tests",
    "",
    lastTests ? `${lastTests.green ? "green" : "red"}\n\n\`\`\`\n${lastTests.log}\n\`\`\`` : "not run",
    "",
  ].join("\n");
}

// `build <n>`: plan -> rounds -> docs -> commit -> report (-> push + PR). Returns an exit code (0 / 1 / 2).
export async function build({ n, flags, repo, deps, log }) {
  const workDir = workDirFor(repo, n);
  const wt = path.join(workDir, "wt");
  const branch = `agent/${n}`;
  const specPath = path.join(workDir, "spec.md");
  if (!existsSync(specPath)) {
    log(`spec.md not found at ${specPath}. Run "spec ${n}" first.`);
    return 1;
  }
  const { git, tests, gh } = deps;
  if (flags.pr) {
    // Fail before spending any model budget: the PR base must already be on origin.
    const prBase = git.currentBranch(repo);
    if (!git.remoteBranchExists(repo, prBase)) {
      log(`base branch "${prBase}" does not exist on origin. Push it first (git push -u origin ${prBase}), then rerun with --pr.`);
      return 1;
    }
  }
  const startedAt = nowIso();

  if (git.worktreeExists(repo, wt, branch) || git.branchExists(repo, branch) || existsSync(wt)) {
    if (!flags.fresh) {
      log(`worktree or branch ${branch} already exists (${wt}). Use --fresh to remove it and start over.`);
      return 1;
    }
    git.removeWorktree(repo, wt, branch);
    rmSync(wt, { recursive: true, force: true });
    for (const name of readdirSync(workDir)) {
      if (/^round-\d+$/.test(name) || ["plan.md", "escalation.md", "report.md", "metrics.json", "diff.patch"].includes(name)) {
        rmSync(path.join(workDir, name), { recursive: true, force: true });
      }
    }
    addIntervention(workDir, "build-rerun", `removed ${branch} and its worktree (--fresh)`);
  }

  const hashPath = path.join(workDir, "spec.sha256");
  const specHash = sha256(readFileSync(specPath, "utf8"));
  if (existsSync(hashPath) && readFileSync(hashPath, "utf8").trim() !== specHash) {
    // Logged once per distinct edited version: a --fresh rerun with the same spec.md adds nothing.
    const note = `spec.md differs from the analyst's version (human edit), sha256 ${specHash}`;
    if (!readInterventions(workDir).some((i) => i.kind === "spec-edited" && i.note === note)) {
      addIntervention(workDir, "spec-edited", note);
    }
  }

  const baseBranch = git.currentBranch(repo);
  const base = git.headSha(repo);
  git.createWorktree(repo, wt, branch);

  const roles = [...readSpecRun(workDir)];
  const callRole = async (role, round, opts, tag = `${role}-${round}`) => {
    const t0 = Date.now();
    const r = await deps.claude({
      role,
      cwd: wt,
      workDir,
      addDirs: [workDir],
      logPath: path.join(workDir, "runs", `${tag}.json`),
      ...ROLE_LIMITS[role],
      ...opts,
    });
    return { ...r, wallMs: Date.now() - t0 };
  };
  const record = (role, round, r, cost = r.costUsd) => roles.push(roleEntry(role, round, { ...r, costUsd: cost }));
  const testTimes = [];

  // planner
  const planPath = path.join(workDir, "plan.md");
  const plan = await callRole("planner", 0, {
    prompt: `Work directory (absolute): ${workDir}\nRead ${specPath} and write ${planPath}.`,
    permissionMode: "acceptEdits",
  });
  record("planner", 0, plan);
  if (!plan.ok || !existsSync(planPath)) {
    log(`planner failed (${plan.subtype}); plan.md ${existsSync(planPath) ? "exists" : "missing"}: ${plan.result}`);
    return 1;
  }

  // Docker check before round 1, from the src/<Project>/ paths named in plan.md.
  const planned = mapTestProjects(planFiles(readFileSync(planPath, "utf8")), wt);
  if (planned.functional.length && !tests.dockerAvailable()) {
    log(`Docker is not running, but functional tests are needed (${planned.functional.join(", ")}). Start Docker and rerun with --fresh.`);
    return 1;
  }

  let implSession = null;
  let prevCumulative = null;
  let lastTests = null;
  let noTestsRan = false;
  let lastVerdict = null;
  const attempts = {};

  const roundDir = (k) => path.join(workDir, `round-${k}`);

  const implement = async (k, feedback) => {
    const rd = roundDir(k);
    const first = `Work directory (absolute): ${workDir}
Round 1. Read ${specPath} and ${planPath} and implement the plan in the current worktree.`;
    const fix = `Round ${k}. Fix the blocking findings in ${path.join(roundDir(k - 1), "review.md")} and the failing tests in ${path.join(roundDir(k - 1), "tests.txt")}. Do not widen the change.`;
    // --resume only when a session exists; otherwise start a new session with the full task plus the feedback.
    const resumeId = k > 1 ? implSession ?? undefined : undefined;
    const prompt = k === 1 ? first : resumeId ? `Work directory (absolute): ${workDir}
${fix}` : `${first}

${fix}`;
    void feedback;
    mkdirSync(rd, { recursive: true });
    if (!resumeId) prevCumulative = null; // a new session starts its cumulative cost from 0
    const r = await callRole("implementer", k, {
      prompt,
      resumeId,
      permissionMode: "acceptEdits",
      allowedTools: IMPLEMENTER_ALLOWED_TOOLS,
    });
    if (r.sessionId) implSession = r.sessionId;
    // Cost is counted whenever the run reported one (an error_max_turns run still spent money).
    // The delta applies only to the same resumed session; any other session starts from 0.
    if (r.costUsd > 0) {
      const sameSession = resumeId && r.sessionId === resumeId;
      record("implementer", k, r, costDelta(sameSession ? prevCumulative : null, r.costUsd));
      prevCumulative = r.costUsd;
    } else {
      record("implementer", k, r, 0);
    }
    return r;
  };

  const test = async (k) => {
    const rd = roundDir(k);
    git.restoreLineEndingOnly(wt);
    const files = git.changedFiles(wt);
    const mapped = mapTestProjects(files, wt);
    if (mapped.functional.length && !tests.dockerAvailable()) {
      throw new EnvironmentError(`Docker is not running, but functional tests are needed (${mapped.functional.join(", ")}). Environment problem, not a round. Start Docker and rerun with --fresh.`);
    }
    const t0 = Date.now();
    const res = await tests.runTests(wt, files);
    testTimes.push({ round: k, wallMs: Date.now() - t0 });
    git.restoreLineEndingOnly(wt);
    write(path.join(rd, "diff.patch"), git.diffPatch(wt, base));
    write(path.join(rd, "tests.txt"), res.log);
    lastTests = res;
    noTestsRan = Boolean(res.noTests);
    return res;
  };

  const review = async (k) => {
    const rd = roundDir(k);
    attempts[k] = (attempts[k] ?? 0) + 1;
    const r = await callRole(
      "reviewer",
      k,
      {
        prompt: [
          `Work directory (absolute): ${workDir}`,
          `Round ${k}. Review these files:`,
          `- spec: ${specPath}`,
          `- plan: ${planPath}`,
          `- diff: ${path.join(rd, "diff.patch")}`,
          `- tests: ${path.join(rd, "tests.txt")}`,
          `Write your verdict as structured output.`,
        ].join("\n"),
        schemaPath: SCHEMA_PATH,
      },
      `reviewer-${k}${attempts[k] > 1 ? `-retry${attempts[k] - 1}` : ""}`,
    );
    record("reviewer", k, r);
    if (r.structured) {
      lastVerdict = r.structured;
      write(path.join(rd, "review.json"), JSON.stringify(r.structured, null, 2));
      write(path.join(rd, "review.md"), renderReviewMd(r.structured));
    }
    return r;
  };

  let result;
  try {
    result = await runRounds({ implement, test, review });
  } catch (e) {
    if (!(e instanceof EnvironmentError)) throw e;
    addIntervention(workDir, "environment", e.message);
    log(e.message);
    return 1;
  }
  const diffStats = () => git.numstat(wt, base);
  const interventions = () => readInterventions(workDir);
  const sum = () => roles.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const issueTitle = (() => {
    const p = path.join(workDir, "issue.md");
    return existsSync(p) ? /^# (.*)/.exec(readFileSync(p, "utf8"))?.[1] ?? `Issue #${n}` : `Issue #${n}`;
  })();
  const finish = (outcome, extra = {}) => {
    const metrics = {
      issue: n,
      title: issueTitle,
      startedAt,
      finishedAt: nowIso(),
      outcome,
      rounds: result.rounds,
      roles,
      tests: testTimes,
      totalCostUsd: sum(),
      costLabel: "client-side estimate",
      diff: extra.diff ?? diffStats(),
      interventions: interventions(),
      reviewerConsistency: result.consistency ?? result.history.map((h) => h.evaluation.consistent),
      nonBlocking: result.nonBlocking ?? [],
      noTestsRan,
    };
    write(path.join(workDir, "metrics.json"), JSON.stringify(metrics, null, 2));
    write(path.join(workDir, "report.md"), renderReport(metrics));
    return metrics;
  };

  if (result.outcome !== "success") {
    write(path.join(workDir, "escalation.md"), escalationMd({ result, lastTests, lastReview: lastVerdict }));
    addIntervention(workDir, "escalation", `${result.reason} after ${result.rounds} round(s)`);
    finish("escalated");
    log(`escalated (${result.reason}) after ${result.rounds} round(s); see ${path.join(workDir, "escalation.md")}`);
    return 2;
  }

  // docs-writer: a failure is recorded, never fatal.
  write(path.join(workDir, "diff.patch"), git.diffPatch(wt, base));
  try {
    const d = await callRole("docs-writer", 0, {
      prompt: `Work directory (absolute): ${workDir}\nFinal diff: ${path.join(workDir, "diff.patch")}\nUpdate only the notes this diff makes wrong.`,
      permissionMode: "acceptEdits",
    });
    record("docs-writer", 0, d);
    if (!d.ok) addIntervention(workDir, "docs-failed", `docs-writer ${d.subtype}`);
  } catch (e) {
    record("docs-writer", 0, { subtype: "error" });
    addIntervention(workDir, "docs-failed", String(e.message ?? e));
  }

  git.restoreLineEndingOnly(wt);
  const files = git.changedFiles(wt);
  if (files.length) git.commitByName(wt, files, `${issueTitle}\n\nCloses #${n}`);
  else log("no changed files to commit");
  finish("success");
  log(`success after ${result.rounds} round(s); branch ${branch}; report: ${path.join(workDir, "report.md")}`);

  if (flags.pr) {
    git.pushBranch(wt, branch);
    const url = gh.prCreate({ base: baseBranch, head: branch, title: issueTitle, bodyFile: path.join(workDir, "report.md"), cwd: repo });
    log(`PR: ${url}`);
  }
  return 0;
}
