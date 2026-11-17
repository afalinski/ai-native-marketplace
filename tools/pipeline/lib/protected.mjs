// Paths the pipeline cannot change (E13): Claude Code treats `.claude/` as sensitive, so an Edit there
// is denied even under acceptEdits. This list is the single source: the analyst and planner prompts are
// built from it, and `spec` checks the Scope section against it.
export const PROTECTED_PATHS = [".claude/**"];

const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "");

function globToRegExp(glob) {
  const re = glob
    .split("**")
    .map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${re}$`);
}

const PATTERNS = PROTECTED_PATHS.map(globToRegExp);

export function isProtectedPath(p) {
  const f = norm(p);
  return PATTERNS.some((re) => re.test(f));
}

export function protectedPathsInstruction() {
  const list = PROTECTED_PATHS.map((p) => `\`${p}\``).join(", ");
  return [
    `The pipeline cannot change these paths: ${list}. Claude Code denies edits there.`,
    "Do not put a change to them in scope or in a plan step.",
    "If the task needs one, list it in a separate section `## Human after merge`: the file and the exact change, for a person to make after the merge.",
  ].join(" ");
}

// Protected paths mentioned inside the `## Scope` section of a spec (path-like tokens only).
export function protectedPathsInScope(specText) {
  const lines = String(specText).split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Scope\b/i.test(l));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const scope = lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
  const found = new Set();
  for (const m of scope.matchAll(/[\w./\\-]*\.claude[\\/][\w./\\-]+/g)) {
    const p = norm(m[0]).replace(/:\d+(-\d+)?$/, "").replace(/[.,;:]+$/, "");
    if (isProtectedPath(p)) found.add(p);
  }
  return [...found];
}
