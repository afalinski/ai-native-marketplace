import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function workDirFor(repo, n) {
  return path.resolve(repo, ".work", String(n));
}

const interventionsPath = (workDir) => path.join(workDir, "interventions.json");

export function readInterventions(workDir) {
  const p = interventionsPath(workDir);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
}

export function addIntervention(workDir, kind, note) {
  mkdirSync(workDir, { recursive: true });
  const list = readInterventions(workDir);
  list.push({ kind, at: new Date().toISOString(), note });
  writeFileSync(interventionsPath(workDir), JSON.stringify(list, null, 2));
}

export function roleEntry(role, round, r) {
  return { role, round, costUsd: r.costUsd ?? 0, turns: r.turns ?? 0, durationMs: r.durationMs ?? 0, subtype: r.subtype };
}
