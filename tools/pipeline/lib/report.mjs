const usd = (n) => `$${(n ?? 0).toFixed(2)}`;
const mins = (ms) => `${((ms ?? 0) / 60000).toFixed(1)} min`;

function findingsList(findings) {
  if (!findings?.length) return "none\n";
  return findings.map((f) => `- \`${f.file}:${f.line}\` [${f.rule}] ${f.summary}`).join("\n") + "\n";
}

// Markdown for report.md and the PR body. Every cost is labelled as a client-side estimate.
export function renderReport(m) {
  const d = m.diff ?? { files: 0, added: 0, removed: 0, docsAdded: 0, docsRemoved: 0 };
  const consistency = m.reviewerConsistency ?? [];
  const lines = [
    `# Agent pipeline report: issue #${m.issue}${m.title ? ` (${m.title})` : ""}`,
    "",
    `- Outcome: ${m.outcome}`,
    `- Rounds: ${m.rounds}`,
    `- Total cost: ${usd(m.totalCostUsd)} (${m.costLabel ?? "client-side estimate"})`,
    `- Files changed: ${d.files} (+${d.added} / -${d.removed})`,
    `- Docs lines: +${d.docsAdded} / -${d.docsRemoved}`,
    `- Started: ${m.startedAt}, finished: ${m.finishedAt}`,
  ];
  if (m.noTestsRan) lines.push("- Warning: no tests ran (no test project maps to the change; green means the build passed)");
  lines.push(
    "",
    "## Roles",
    "",
    "| Role | Round | Cost (client-side estimate) | Turns | Time | Result |",
    "|---|---|---|---|---|---|",
    ...(m.roles ?? []).map((r) => `| ${r.role} | ${r.round} | ${usd(r.costUsd)} | ${r.turns} | ${mins(r.durationMs)} | ${r.subtype} |`),
    "",
    "## Reviewer consistency",
    "",
    consistency.length
      ? consistency.map((c, i) => `- Round ${i + 1}: ${c ? "verdict matches findings" : "verdict does not match findings"}`).join("\n")
      : "none",
    "",
    "## Not fixed (non-blocking)",
    "",
    findingsList(m.nonBlocking),
    "## Interventions",
    "",
    m.interventions?.length ? m.interventions.map((i) => `- ${i.kind} (${i.at}): ${i.note}`).join("\n") : "none",
    "",
  );
  return lines.join("\n");
}
