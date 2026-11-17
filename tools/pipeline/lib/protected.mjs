// Paths the pipeline cannot change (E13): Claude Code treats `.claude/` as sensitive, so an Edit there
// is denied even under acceptEdits. This list is the single source: the analyst, planner and reviewer
// prompts are built from it, and `spec` checks the spec against it.
// Entries have the form "<directory>/**"; a path is protected when any of its segments is that directory
// (so `.claude`, `.claude/rules/x.md`, `src/X/.claude/settings.json` and absolute paths all match).
export const PROTECTED_PATHS = [".claude/**"];

const PROTECTED_DIRS = PROTECTED_PATHS.map((p) => p.replace(/\/\*\*$/, ""));
const HUMAN_SECTION = "Human after merge";

const segments = (p) => String(p).replace(/\\/g, "/").split("/").filter(Boolean);

export function isProtectedPath(p) {
  return segments(p).some((s) => PROTECTED_DIRS.includes(s));
}

const list = () => PROTECTED_PATHS.map((p) => `\`${p}\``).join(", ");

// For the analyst and the planner.
export function protectedPathsInstruction() {
  return [
    `The pipeline cannot change these paths: ${list()}. Claude Code denies edits there.`,
    "Do not put a change to them in scope, in an acceptance criterion or in a plan step.",
    `If the task needs one, list it in a separate section \`## ${HUMAN_SECTION}\`: the file and the exact change, for a person to make after the merge.`,
  ].join(" ");
}

// For the reviewer.
export function reviewerProtectedPathsInstruction() {
  return [
    `The pipeline cannot change ${list()}.`,
    `Items in the spec's \`## ${HUMAN_SECTION}\` section, and any change to those paths, are made by a person after the merge.`,
    "Their absence from the diff is never a blocking finding.",
  ].join(" ");
}

// Protected paths that the spec asks the pipeline to deliver: path-like tokens in every section except
// "Out of scope" and "Human after merge" (mentions there are expected).
export function protectedPathsInSpec(specText) {
  const found = new Set();
  let skip = false;
  for (const line of String(specText).split(/\r?\n/)) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      skip = /^(out of scope|human after merge)\b/i.test(h[1].trim());
      continue;
    }
    if (skip) continue;
    for (const m of line.matchAll(/[^\s`'"()<>[\]]*\.claude(?:[\\/][^\s`'"()<>[\]]*)?/g)) {
      const p = m[0].replace(/:\d+(-\d+)?$/, "").replace(/[.,;:]+$/, "");
      if (isProtectedPath(p)) found.add(p.replace(/\\/g, "/"));
    }
  }
  return [...found];
}
