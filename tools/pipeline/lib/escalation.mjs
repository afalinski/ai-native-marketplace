import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The implementer's last message (E13: the reason for the escalation was there, not in the reviewer's
// findings). Read from runs/implementer-<round>.json of this build's last implementer round. When that log
// is missing, unreadable or has no `result` (a timeout leaves it empty), use the result already in memory.
export function lastImplementerMessage(workDir, round, fallbackText = "") {
  if (!round) return null;
  const file = path.join(workDir, "runs", `implementer-${round}.json`);
  let text = "";
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      if (typeof j?.result === "string") text = j.result.trim();
    } catch {
      // unreadable log: fall back below
    }
  }
  if (!text) text = String(fallbackText ?? "").trim();
  return text ? { round, text } : null;
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
    implementerLast ? implementerLast.text : "not available (no implementer output for the last round)",
    "",
    "## Tests",
    "",
    lastTests ? `${lastTests.green ? "green" : "red"}\n\n\`\`\`\n${lastTests.log}\n\`\`\`` : "not run",
    "",
  ].join("\n");
}
