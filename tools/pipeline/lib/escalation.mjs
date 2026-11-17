import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The implementer's last message, from the highest round in runs/implementer-<k>.json (E13: the reason
// for the escalation was there, not in the reviewer's findings). Null if there is no readable log.
export function lastImplementerMessage(workDir) {
  const dir = path.join(workDir, "runs");
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir)
    .map((f) => /^implementer-(\d+)\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => ({ round: Number(m[1]), file: path.join(dir, m[0]) }))
    .sort((a, b) => b.round - a.round);
  if (!runs.length) return null;
  try {
    const j = JSON.parse(readFileSync(runs[0].file, "utf8"));
    return typeof j?.result === "string" && j.result.trim() ? { round: runs[0].round, text: j.result.trim() } : null;
  } catch {
    return null;
  }
}

export function escalationMd({ result, lastTests, lastReview, implementerLast }) {
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
    implementerLast ? `## Implementer's last message (round ${implementerLast.round})` : "## Implementer's last message",
    "",
    implementerLast ? implementerLast.text : "not available (no readable runs/implementer-<k>.json)",
    "",
    "## Tests",
    "",
    lastTests ? `${lastTests.green ? "green" : "red"}\n\n\`\`\`\n${lastTests.log}\n\`\`\`` : "not run",
    "",
  ].join("\n");
}
