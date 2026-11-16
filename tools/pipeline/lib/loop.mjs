export const MAX_ROUNDS = 3;

const countBlocking = (review) => (review?.findings ?? []).filter((f) => f.severity === "blocking").length;

export function evaluateRound({ tests, review }) {
  const blocking = countBlocking(review);
  const pass = Boolean(tests.green) && review !== null && review !== undefined && blocking === 0;
  const consistent = review ? (review.verdict === "APPROVE") === (blocking === 0) : false;
  return { pass, blocking, consistent };
}

function renderList(findings) {
  if (findings.length === 0) return "none\n";
  return findings.map((f) => `- \`${f.file}:${f.line}\` [${f.rule}] ${f.summary}`).join("\n") + "\n";
}

export function renderReviewMd(review) {
  const findings = review.findings ?? [];
  return [
    `# Review: ${review.verdict}`,
    "",
    review.summary ?? "",
    "",
    "## Blocking",
    "",
    renderList(findings.filter((f) => f.severity === "blocking")),
    "## Non-blocking",
    "",
    renderList(findings.filter((f) => f.severity !== "blocking")),
  ].join("\n");
}

export async function runRounds({ implement, test, review, maxRounds = MAX_ROUNDS }) {
  const history = [];
  let feedback = null;
  for (let k = 1; k <= maxRounds; k++) {
    const impl = await implement(k, feedback);
    const tests = await test(k);
    let rev = await review(k);
    let reviewRetried = false;
    if (!rev?.structured) {
      reviewRetried = true;
      rev = await review(k);
    }
    const verdict = rev?.structured ?? null;
    const evaluation = evaluateRound({ tests, review: verdict });
    history.push({ k, implement: impl, tests, review: rev, evaluation, reviewRetried });
    if (!verdict) return { outcome: "escalated", reason: "reviewer-no-verdict", rounds: k, history };
    if (evaluation.pass) {
      return {
        outcome: "success",
        rounds: k,
        history,
        nonBlocking: (verdict.findings ?? []).filter((f) => f.severity !== "blocking"),
        consistency: history.map((h) => h.evaluation.consistent),
      };
    }
    feedback = { reviewMd: renderReviewMd(verdict), testsLog: tests.log };
  }
  return { outcome: "escalated", reason: "max-rounds", rounds: maxRounds, history };
}
