// Assertions the SHIPPED core stylesheet must satisfy — shared by the build
// (scripts/build-core-styles.mjs, which refuses to emit a bad file) and the
// standalone guard (scripts/check-core-css-compiled.mjs, which fails CI on one).
//
// The contract: dist/editor.css is fully compiled and namespaced. A raw
// `@tailwind` directive would be re-expanded by a HOST app's Tailwind against
// the host's config (collisions, wrong palette) and silently dropped in a host
// with no Tailwind at all (unstyled chrome). A selector that is not anchored to
// the editor reaches into host markup the editor does not own.
//
// STRUCTURAL, not a denylist. Naming the shapes we forbid only ever catches the
// leaks someone already thought of: `a { color }`, `:root { --doc-x }` and
// `.btn { padding }` all slipped past the four-pattern version of this check.
// The rule is inverted instead — every rule must be anchored — with a short,
// explicit allowlist for the engine's own namespaces.

import postcss from 'postcss';

/** The scope class every shipped rule must be anchored to. */
const SCOPE = '.docx-editor';

/**
 * Class prefixes the engine owns outright. These paint INSIDE the editor but are
 * matched on painted document elements rather than on chrome descendants, so
 * requiring the scope class on them would be wrong.
 *
 * OWNED means we mint the name. `.ProseMirror-` was on this list and is not
 * ours — it is ProseMirror's, and `.ProseMirror-yjs-cursor` is y-prosemirror's.
 * A host running its own ProseMirror editor on the same page got our rules on
 * its elements, which is the leak this guard exists to prevent. Anything we do
 * not mint has to carry the scope class.
 */
const OWNED_PREFIXES = ['.docx-', '.layout-', '.paged-editor'];

/** A keyframe step (`from`, `to`, `47%`) is not a selector. */
const KEYFRAME_STEP = /^(from|to|-?[\d.]+%)$/;

/**
 * Whether a selector can only ever match inside the editor.
 *
 * Either it names the scope class, or SOME compound names a class the engine owns —
 * an engine ancestor confines a rule exactly as the scope class does
 * (`.docx-paragraph *::selection`), and the class may sit behind a tag or a pseudo
 * (`a.docx-hyperlink`, `:where(.docx-paginated-surface)`). What this rejects is a
 * selector with no engine anchor anywhere in it: `a`, `:root`, `.btn`, `body`.
 */
function isAnchored(selector) {
  if (selector.includes(SCOPE)) return true;
  return OWNED_PREFIXES.some((prefix) => selector.includes(prefix));
}

/** @returns {string[]} problems; empty when the css satisfies the contract */
export function coreCssProblems(rawCss) {
  const problems = [];
  if (/@tailwind\b/.test(rawCss.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    problems.push('contains a raw @tailwind directive — the build did not expand it');
  }

  let root;
  try {
    root = postcss.parse(rawCss);
  } catch (error) {
    return [...problems, `is not parseable CSS: ${String(error)}`];
  }

  const unanchored = new Set();
  root.walkRules((rule) => {
    // Keyframe steps live under an at-rule and are not page selectors.
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      if (KEYFRAME_STEP.test(selector.trim())) continue;
      if (!isAnchored(selector)) unanchored.add(selector.trim());
    }
  });
  for (const selector of [...unanchored].sort().slice(0, 10)) {
    problems.push(`selector is not anchored to ${SCOPE} or an engine namespace: ${selector}`);
  }
  if (unanchored.size > 10) {
    problems.push(`…and ${unanchored.size - 10} more unanchored selectors`);
  }

  // `@keyframes` names are document-global; no selector strategy can scope them,
  // so they carry the editor's prefix instead (see build-core-styles.mjs).
  root.walkAtRules(/^(-\w+-)?keyframes$/, (rule) => {
    const name = rule.params.trim();
    if (!/^(docx-|hf-)/.test(name)) {
      problems.push(`@keyframes name is in the global namespace: ${name}`);
    }
  });

  // The positive half: the compiled utilities and the scoped editable-surface rules
  // have to actually BE there, or a "clean" file could simply be empty.
  if (!rawCss.includes('.docx-editor .flex')) {
    problems.push("missing '.docx-editor .flex' — utilities absent or not scoped");
  }
  if (!rawCss.includes(".docx-editor [contenteditable='true']")) {
    problems.push('missing the scoped [contenteditable] caret rule');
  }
  if (!rawCss.includes('.docx-editor {')) {
    problems.push("missing the '.docx-editor {' token block");
  }
  if (!rawCss.includes('--doc-')) {
    problems.push('missing --doc-* chrome tokens');
  }
  return problems;
}
