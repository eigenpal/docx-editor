// File-level lint directives that switch max-lines off, read by scripts/check-max-lines-caps.mjs.

/**
 * A file-level `eslint-disable` or `oxlint-disable` directive. oxlint honors block and line
 * comments, and a block comment may span lines. `-next-line` and `-line` cover one statement,
 * not a file, so the negative lookahead skips them.
 */
const BLOCK_DIRECTIVE = /\/\*\s*(?:eslint|oxlint)-disable(?![-\w])([\s\S]*?)\*\//g;
const LINE_DIRECTIVE = /\/\/\s*(?:eslint|oxlint)-disable(?![-\w])([^\n]*)/g;

/** `max-lines`, with or without the `eslint/` plugin prefix oxlint also accepts. */
export function isMaxLinesRule(name) {
  return name === 'max-lines' || name === 'eslint/max-lines';
}

/** The rules a directive names: before the ` -- ` reason, comma separated. */
function directiveRules(body) {
  return body
    .split(/\s--\s/)[0]
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean);
}

/** Whether a file turns max-lines off for itself: a directive naming it, or naming no rule. */
export function disablesMaxLines(text) {
  for (const pattern of [BLOCK_DIRECTIVE, LINE_DIRECTIVE]) {
    for (const [, body] of text.matchAll(pattern)) {
      const rules = directiveRules(body);
      if (rules.length === 0 || rules.some(isMaxLinesRule)) return true;
    }
  }
  return false;
}
