// Ownership-scoped preservation capsules (document-engine 3.1/3.2/3.5). A capsule holds a fragment
// of authored OOXML the model does NOT represent, captured VERBATIM (byte-exact) with its owning
// region + sibling position, so a semantic edit to the OWNED content (a paragraph's runs) can
// regenerate while the capsule is re-spliced unchanged. This is finer than block-level verbatim
// preservation: it lets a paragraph that carries unmodeled properties (a leading `w:pPr`) stay
// EDITABLE instead of opening the whole document read-only.
//
// Capture happens at the PRESERVATION layer, from the block's exact source byte-slice — never from a
// re-serialized parse tree — so the bytes are identical to the original (attribute order, whitespace,
// self-closing style all preserved). Anything not cleanly extractable returns null and the caller
// fails closed (stays read-only), so a capsule can never silently drop or corrupt content.

import { readXml } from './xml-reader.ts';

/** The verbatim bytes of a captured `w:pPr` (paragraph properties) element — a paragraph's leading
 *  ownership-scoped capsule. Includes the element tags exactly as authored. */
export type ParagraphPropertiesCapsule = string;

/** Extract the LEADING `<w:pPr>…</w:pPr>` (or `<w:pPr/>`) of a paragraph's exact source slice as a
 *  verbatim capsule, byte-identical to the source. Returns the capsule bytes, or null when there is
 *  no leading `w:pPr` OR it cannot be cleanly + safely isolated (so the caller fails closed):
 *  - the slice is not a well-formed single `w:p` opening (a self-closed `<w:p/>` has no properties),
 *  - a comment/PI sits before the properties (would be dropped),
 *  - the `w:pPr` is not well-formed XML on its own.
 *  `w:pPr` children are never themselves `w:pPr`, so the first `</w:pPr>` closes it unambiguously. */
export function extractParagraphPropertiesCapsule(paragraphSlice: string): ParagraphPropertiesCapsule | null {
  const s = paragraphSlice;
  // Locate the end of the `<w:p …>` opening tag. A self-closing `<w:p/>` carries no properties.
  const open = s.indexOf('<w:p');
  if (open < 0) return null;
  // The opening tag ends at the first '>' that is not inside an attribute value. Paragraph opening
  // attributes are simple (w:rsid* etc.) with no '>' in values, so the first '>' after `<w:p` ends it.
  const openEnd = s.indexOf('>', open);
  if (openEnd < 0) return null;
  if (s[openEnd - 1] === '/') return null; // `<w:p/>` — empty paragraph, no properties
  let i = openEnd + 1;
  // Skip insignificant whitespace between the opening tag and the first child.
  while (i < s.length && /\s/.test(s[i])) i += 1;
  // A comment/PI before the properties would be lost by regeneration — fail closed.
  if (s.startsWith('<!--', i) || s.startsWith('<?', i)) return null;
  if (!startsWithTag(s, i, 'w:pPr')) return null; // no leading paragraph properties
  // Balanced-match the outer w:pPr end, counting NESTED w:pPr (w:pPrChange contains a nested w:pPr!),
  // so the first '</w:pPr>' — which closes the INNER one — never truncates the capture.
  const end = matchElementEnd(s, i, 'w:pPr');
  if (end === null) return null;
  const capsule = s.slice(i, end);
  // Backstop: prove the captured bytes are well-formed XML with exactly one w:pPr root. (A truncated
  // fragment can slip past the non-strict reader, so balanced matching above is the real guarantee.)
  const parsed = readXml(capsule);
  if (!parsed.ok) return null;
  const els = parsed.nodes.filter((n) => n.type === 'element');
  if (els.length !== 1 || els[0].name !== 'w:pPr') return null;
  return capsule;
}

/** Whether `s` at `at` begins an open tag for exactly `name` (the next char is a tag boundary, so
 *  `<w:pPr` does not match `<w:pPrChange`). */
function startsWithTag(s: string, at: number, name: string): boolean {
  if (!s.startsWith(`<${name}`, at)) return false;
  const after = s[at + 1 + name.length];
  return after === undefined || /[\s/>]/.test(after);
}

/** The index just past the element `name` opened at `openStart` (index of '<'), matched with FULL
 *  tag-stack balancing (every nested element must be properly closed, not just `name`), quote-aware
 *  attribute scanning, and comment / PI / CDATA skipping. Returns null on ANY malformed/unbalanced
 *  structure — a mismatched close, an unclosed nested element, an unterminated tag — so a fragment
 *  the non-strict reader would tolerate is still rejected and the caller fails closed. */
function matchElementEnd(s: string, openStart: number, name: string): number | null {
  const openTag = findSelfCloseOrOpenEnd(s, openStart);
  if (openTag === null) return null;
  if (openTag.selfClosing) return openTag.tagEnd + 1; // `<name … />`
  const stack: string[] = [name];
  let i = openTag.tagEnd + 1;
  while (i < s.length && stack.length > 0) {
    const lt = s.indexOf('<', i);
    if (lt < 0) return null;
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt + 4);
      if (e < 0) return null;
      i = e + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9);
      if (e < 0) return null;
      i = e + 3;
      continue;
    }
    if (s.startsWith('<?', lt)) {
      const e = s.indexOf('?>', lt + 2);
      if (e < 0) return null;
      i = e + 2;
      continue;
    }
    if (s[lt + 1] === '/') {
      // A close tag: it MUST match the element on top of the stack, or the fragment is malformed.
      const closeName = readTagName(s, lt + 2);
      if (closeName === null) return null;
      const gt = s.indexOf('>', lt);
      if (gt < 0 || stack.pop() !== closeName) return null;
      i = gt + 1;
      if (stack.length === 0) return i; // the outer element just closed, fully balanced
      continue;
    }
    // An open tag: read its name, consume it, and push unless self-closing.
    const openName = readTagName(s, lt + 1);
    if (openName === null) return null;
    const tag = findSelfCloseOrOpenEnd(s, lt);
    if (tag === null) return null;
    if (!tag.selfClosing) stack.push(openName);
    i = tag.tagEnd + 1;
  }
  return null; // unbalanced / unterminated
}

/** Read an XML tag name at `at` (just past '<' or '</'): up to the first whitespace, '/', or '>'. */
function readTagName(s: string, at: number): string | null {
  let j = at;
  while (j < s.length && !/[\s/>]/.test(s[j])) j += 1;
  return j > at ? s.slice(at, j) : null;
}

/** Scan the `<w:pPr …>` opening tag starting at `at` (index of '<'), returning where the tag ends
 *  and whether it self-closes. Handles '>' inside attribute values (single/double quoted). */
function findSelfCloseOrOpenEnd(s: string, at: number): { tagEnd: number; selfClosing: boolean } | null {
  let i = at + 1;
  let quote: string | null = null;
  for (; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '>') {
      return { tagEnd: i, selfClosing: s[i - 1] === '/' };
    }
  }
  return null; // unterminated tag
}

/** Serialize a paragraph's inner content with its capsule reinserted at the leading position: the
 *  `w:pPr` (if any) comes first, then the runs — exactly the OOXML child order for `w:p`. */
export function paragraphInnerWithCapsule(capsule: ParagraphPropertiesCapsule | undefined, runsXml: string): string {
  return `${capsule ?? ''}${runsXml}`;
}
