import { spawnSync } from "node:child_process";

function gh(args, cwd) {
  const r = spawnSync("gh", args, { cwd, encoding: "utf8", shell: false });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed (${r.status}): ${(r.stderr || "").trim()}`);
  return r.stdout;
}

export function issueView(n, cwd) {
  const j = JSON.parse(gh(["issue", "view", String(n), "--json", "title,body"], cwd));
  return { title: j.title ?? "", body: j.body ?? "" };
}

export function prCreate({ base, head, title, bodyFile, cwd }) {
  return gh(["pr", "create", "--base", base, "--head", head, "--title", title, "--body-file", bodyFile], cwd).trim();
}
