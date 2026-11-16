import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createWorktree, worktreeExists, removeWorktree, changedFiles,
  restoreLineEndingOnly, diffPatch, numstat, commitByName,
} from "./git.mjs";

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

function tempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "pipe-git-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "user.email", "t@example.com");
  mkdirSync(path.join(dir, "src/Catalog.API"), { recursive: true });
  writeFileSync(path.join(dir, "src/Catalog.API/Catalog.API.json"), "a\nb\nc\n");
  writeFileSync(path.join(dir, "keep.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

test("untracked file shows in changedFiles, diffPatch, numstat", () => {
  const dir = tempRepo();
  try {
    const base = git(dir, "rev-parse", "HEAD");
    writeFileSync(path.join(dir, "new.txt"), "x\ny\n");
    mkdirSync(path.join(dir, "docs"));
    writeFileSync(path.join(dir, "docs/n.md"), "d\n");
    assert.ok(changedFiles(dir).includes("new.txt"));
    assert.ok(diffPatch(dir, base).includes("+++ b/new.txt"));
    const n = numstat(dir, base);
    assert.equal(n.files, 2);
    assert.equal(n.added, 2);
    assert.equal(n.docsAdded, 1);
    assert.equal(n.removed, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("line-ending-only change to glob file is restored and absent from numstat", () => {
  const dir = tempRepo();
  try {
    const base = git(dir, "rev-parse", "HEAD");
    writeFileSync(path.join(dir, "src/Catalog.API/Catalog.API.json"), "a\r\nb\r\nc\r\n");
    writeFileSync(path.join(dir, "keep.txt"), "one\r\ntwo\r\n"); // real change, not in glob
    const restored = restoreLineEndingOnly(dir);
    assert.deepEqual(restored, ["src/Catalog.API/Catalog.API.json"]);
    assert.ok(!changedFiles(dir).includes("src/Catalog.API/Catalog.API.json"));
    const n = numstat(dir, base);
    assert.equal(n.files, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("real change to glob file is not restored", () => {
  const dir = tempRepo();
  try {
    writeFileSync(path.join(dir, "src/Catalog.API/Catalog.API.json"), "a\nB\nc\n");
    assert.deepEqual(restoreLineEndingOnly(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("commitByName commits only named files", () => {
  const dir = tempRepo();
  try {
    writeFileSync(path.join(dir, "a.txt"), "a\n");
    writeFileSync(path.join(dir, "b.txt"), "b\n");
    const sha = commitByName(dir, ["a.txt"], "add a");
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(git(dir, "show", "--name-only", "--format=", "HEAD"), "a.txt");
    assert.ok(changedFiles(dir).includes("b.txt"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("worktree create / exists / remove", () => {
  const dir = tempRepo();
  const wt = path.join(dir, ".work/1/wt");
  try {
    assert.equal(worktreeExists(dir, wt, "agent/1"), false);
    createWorktree(dir, wt, "agent/1");
    assert.equal(worktreeExists(dir, wt, "agent/1"), true);
    removeWorktree(dir, wt, "agent/1");
    assert.equal(worktreeExists(dir, wt, "agent/1"), false);
    assert.equal(git(dir, "branch", "--list", "agent/1"), "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
