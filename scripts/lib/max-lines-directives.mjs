// File-level lint directives that switch max-lines off, read by scripts/check-max-lines-caps.mjs.

/**
 * A file-level `eslint-disable` or `oxlint-disable` directive, in a block or line comment
 * (oxlint honors both forms). `-next-line` and `-line` cover one statement, not a file.
 */
const FILE_DIRECTIVE = /(?:\/\*|\/\/)\s*(?:eslint|oxlint)-disable(?![-\w])([^\n]*)/g;

/** Whether a file turns max-lines off for itself: a directive naming it, or naming no rule. */
export function disablesMaxLines(text) {
  for (const [, rest] of text.matchAll(FILE_DIRECTIVE)) {
    const list = rest.split('*/')[0].split(' -- ')[0];
    const rules = list
      .split(',')
      .map((rule) => rule.trim())
      .filter(Boolean);
    if (rules.length === 0 || rules.includes('max-lines')) return true;
  }
  return false;
}
