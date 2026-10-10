// The file-head `/** … */` doc-block, which is not always the file's first
// comment: commercially licensed packages carry a `/* … */` licence banner
// above it (inserted by `license-check-and-add`, checked by
// `license:check`). A banner is a legal notice, not the entry description, so
// it is skipped rather than mistaken for one — without this, an entry barrel
// with a banner looks like a barrel with no `@packageDocumentation` at all and
// the published `.d.ts` silently loses its package description.

const BANNER = /^\s*\/\*(?!\*)[\s\S]*?\*\//;
const DOC_BLOCK = /^\s*\/\*\*([\s\S]*?)\*\//;

/**
 * @param {string} content
 * @returns {RegExpExecArray | null} the doc-block match, or null if the file has none.
 */
export function matchHeadDocBlock(content) {
  const banner = BANNER.exec(content);
  return DOC_BLOCK.exec(banner ? content.slice(banner[0].length) : content);
}
