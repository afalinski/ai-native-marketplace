#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runClaude } from "./lib/claude.mjs";
import * as git from "./lib/git.mjs";
import * as ghLib from "./lib/gh.mjs";
import { runTests, dockerAvailable } from "./lib/testrun.mjs";
import { spec } from "./lib/spec.mjs";
import { build } from "./lib/build.mjs";

const USAGE = "usage: node tools/pipeline/pipeline.mjs spec <issue> | build <issue> [--pr] [--fresh]";

export const defaultDeps = () => ({
  claude: runClaude,
  git,
  tests: { runTests, dockerAvailable },
  gh: ghLib,
});

export async function main({ argv, repo, deps = defaultDeps(), log = console.error }) {
  const [cmd, issue, ...rest] = argv;
  const n = Number(issue);
  const flags = { pr: rest.includes("--pr"), fresh: rest.includes("--fresh") };
  const unknown = rest.filter((a) => !["--pr", "--fresh"].includes(a));
  if (!["spec", "build"].includes(cmd) || !Number.isInteger(n) || n <= 0 || unknown.length) {
    log(USAGE);
    return 1;
  }
  try {
    return cmd === "spec" ? await spec({ n, repo, deps, log }) : await build({ n, flags, repo, deps, log });
  } catch (e) {
    log(`error: ${e.message ?? e}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  process.exitCode = await main({ argv: process.argv.slice(2), repo });
}
