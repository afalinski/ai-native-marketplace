import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const IGNORED = ["docs/", "tools/", ".claude/"];

// Maps src/<P>/... to tests/<P>.UnitTests and tests/<P>.FunctionalTests where those folders exist.
// A trailing ".API" is stripped; other suffixes are not (src/Ordering.Domain maps to nothing).
export function mapTestProjects(files, repoRoot) {
  const unit = new Set();
  const functional = new Set();
  for (const raw of files) {
    const f = raw.replace(/\\/g, "/");
    if (IGNORED.some((p) => f.startsWith(p))) continue;
    const m = /^src\/([^/]+)\//.exec(f);
    if (!m) continue;
    // src/Ordering.API -> tests/Ordering.UnitTests; the exact folder name is tried too.
    for (const name of new Set([m[1], m[1].replace(/\.API$/, "")])) {
      const u = `tests/${name}.UnitTests`;
      const fn = `tests/${name}.FunctionalTests`;
      if (existsSync(path.join(repoRoot, u))) unit.add(u);
      if (existsSync(path.join(repoRoot, fn))) functional.add(fn);
    }
  }
  return { unit: [...unit], functional: [...functional] };
}

function tail(text, n = 200) {
  const lines = text.split(/\r?\n/);
  return lines.length > n ? lines.slice(-n).join("\n") : text;
}

function exec(cwd, args) {
  const r = spawnSync("dotnet", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 256 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`;
  return { ok: r.status === 0, log: `$ dotnet ${args.join(" ")}\n${tail(out)}\n` };
}

export function runTests(wt, files) {
  const { unit, functional } = mapTestProjects(files, wt);
  const projects = [...unit, ...functional];
  let log = "";
  const build = exec(wt, ["build", "eShop.Web.slnf"]);
  log += build.log;
  const ran = [];
  let testsOk = true;
  if (build.ok) {
    for (const p of projects) {
      const t = exec(wt, ["test", "--project", p]);
      log += t.log;
      ran.push(p);
      if (!t.ok) testsOk = false;
    }
  }
  return {
    green: build.ok && testsOk,
    buildOk: build.ok,
    ran,
    noTests: projects.length === 0,
    log,
  };
}

export function dockerAvailable() {
  const r = spawnSync("docker", ["info"], { stdio: "ignore", shell: false });
  return r.status === 0;
}
