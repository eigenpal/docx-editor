// Assertions the SHIPPED core stylesheet must satisfy — shared by the build
// (scripts/build-core-styles.mjs, which refuses to emit a bad file) and the
// standalone guard (scripts/check-core-css-compiled.mjs, which fails CI on one).
//
// The contract: dist/editor.css is fully compiled and namespaced. A raw
// `@tailwind` directive would be re-expanded by a HOST app's Tailwind against
// the host's config (collisions, wrong palette) and silently dropped in a host
// with no Tailwind at all (unstyled chrome). Unscoped global selectors reach
// into host markup the editor does not own.

/** @returns {string[]} problems; empty when the css satisfies the contract */
export function coreCssProblems(rawCss) {
  // Comments may legitimately mention `@tailwind` or global selectors — the
  // contract is about RULES, so strip them before matching.
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const problems = [];
  if (/@tailwind\b/.test(css)) {
    problems.push('contains a raw @tailwind directive — the build did not expand it');
  }
  if (!css.includes('.docx-editor .flex')) {
    problems.push("missing '.docx-editor .flex' — utilities absent or not scoped under .docx-editor");
  }
  if (!css.includes(".docx-editor [contenteditable='true']")) {
    problems.push("missing scoped \".docx-editor [contenteditable='true']\" caret rule");
  }
  // Top-level selectors that would reach host markup. Checked against rule heads
  // only (line starts), so occurrences inside :is()/:where() or comments don't trip.
  const globalHeads = [
    /^\s*\[contenteditable/m,
    /^\s*\*\s*[,{]/m,
    /^\s*html\b[^-]/m,
    /^\s*body\b\s*[,{]/m,
  ];
  for (const head of globalHeads) {
    const match = css.match(head);
    if (match) problems.push(`unscoped global selector at rule head: ${JSON.stringify(match[0].trim())}`);
  }
  if (!css.includes('.docx-editor {')) {
    problems.push("missing the '.docx-editor {' token block");
  }
  if (!css.includes('--doc-')) {
    problems.push('missing --doc-* chrome tokens');
  }
  return problems;
}
