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
export function extractParagraphPropertiesCapsule(
  paragraphSlice: string
): ParagraphPropertiesCapsule | null {
  const s = paragraphSlice;
  // Locate the end of the `<w:p …>` opening tag, QUOTE-AWARE (a '>' inside an attribute value must
  // not end the tag). A self-closing `<w:p/>` carries no properties.
  const open = s.indexOf('<w:p');
  if (open < 0 || !startsWithTag(s, open, 'w:p')) return null;
  const openTag = findSelfCloseOrOpenEnd(s, open);
  if (openTag === null) return null;
  if (openTag.selfClosing) return null; // `<w:p …/>` — empty paragraph, no properties
  let i = openTag.tagEnd + 1;
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

/** The verbatim leading `<w:rPr>…</w:rPr>` bytes of a run. This ownership-scoped
 *  capsule retains exact lexical forms and properties outside the semantic model. */
export type RunPropertiesCapsule = string;

/** Extract the leading `<w:rPr>` capsule of a single `<w:r …>…</w:r>` run slice, byte-exact — the
 *  verbatim run properties, or null when the run has none / they cannot be cleanly isolated. Same
 *  balanced-match + quote/comment-aware discipline as the paragraph-properties capsule. */
export function extractRunPropertiesCapsule(runSlice: string): RunPropertiesCapsule | null {
  const s = runSlice;
  const open = s.indexOf('<w:r');
  if (open < 0 || !startsWithTag(s, open, 'w:r')) return null;
  const openTag = findSelfCloseOrOpenEnd(s, open);
  if (openTag === null || openTag.selfClosing) return null; // `<w:r/>` has no properties
  let i = openTag.tagEnd + 1;
  while (i < s.length && /\s/.test(s[i])) i += 1;
  if (s.startsWith('<!--', i) || s.startsWith('<?', i)) return null; // comment/PI before props -> fail closed
  if (!startsWithTag(s, i, 'w:rPr')) return null; // no leading run properties
  const end = matchElementEnd(s, i, 'w:rPr');
  if (end === null) return null;
  const capsule = s.slice(i, end);
  const parsed = readXml(capsule);
  if (!parsed.ok) return null;
  const els = parsed.nodes.filter((n) => n.type === 'element');
  if (els.length !== 1 || els[0].name !== 'w:rPr') return null;
  return capsule;
}

/** The per-run `w:rPr` capsules of a paragraph's source slice, aligned to its DIRECT run children in
 *  document order (each entry is that run's verbatim leading `<w:rPr>` bytes, or null when the run
 *  has none). Returns null when the paragraph is not a clean sequence of direct runs (a leading
 *  `w:pPr` is fine and skipped), so the caller can leave the runs uncapsuled. The result length
 *  equals the number of direct runs, matching the parsed `ParagraphRecord.runs` for a fully-captured
 *  paragraph. */
export function extractParagraphRunRPrCapsules(
  paragraphSlice: string
): (RunPropertiesCapsule | null)[] | null {
  const s = paragraphSlice;
  const open = s.indexOf('<w:p');
  if (open < 0 || !startsWithTag(s, open, 'w:p')) return null;
  const openTag = findSelfCloseOrOpenEnd(s, open);
  if (openTag === null) return null;
  if (openTag.selfClosing) return []; // empty paragraph -> no runs
  const close = s.lastIndexOf('</w:p>');
  if (close < openTag.tagEnd + 1) return null;
  const runSlices = splitDirectRunSlices(s.slice(openTag.tagEnd + 1, close));
  if (runSlices === null) return null;
  return runSlices.map((rs) => extractRunPropertiesCapsule(rs));
}

/** Whether `s` is EXACTLY one well-formed `<w:rPr>…</w:rPr>` (or `<w:rPr/>`) element and nothing
 *  else — the validity contract for a run-properties capsule. This is the SECURITY gate for a
 *  capsule that arrives from untrusted input (a pasted `data-raw-rpr` span): a value that is not a
 *  lone balanced w:rPr is rejected, so no attacker-selected/unescaped OOXML can be re-emitted on save
 *  (CLAUDE.md untrusted-input / XML-injection boundary). Balanced-matched + well-formedness checked. */
/** Strictly validate the attribute syntax of EVERY tag in a capsule string: each attribute is
 *  `name="value"` / `name='value'` with a quoted value and a UNIQUE name. The neutral reader
 *  (readXml) is lenient — it accepts a bare attribute (`<w:rPr x/>`), an unquoted value
 *  (`foo=bar`), or a duplicate name — which, re-emitted VERBATIM, would produce invalid XML. This
 *  scan (comment/CDATA/PI/quote aware) rejects those before a forged capsule is interpolated. */
const VALID_ENTITY = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;
/** An attribute value is XML-legal only if it contains no raw `<` and every `&` opens a valid entity
 *  reference — otherwise the verbatim re-emit is malformed XML. */
function attrValueOk(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '<') return false;
    if (v[i] === '&' && !VALID_ENTITY.test(v.slice(i))) return false;
  }
  return true;
}
export function hasStrictAttributes(s: string): boolean {
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '<') {
      i++;
      continue;
    } // text between tags
    // A preservation capsule from a real w:rPr/w:pPr never carries a comment, CDATA, or a processing
    // instruction; re-emitting one mid-document is at best suspicious and (for an xml declaration)
    // invalid — reject them outright rather than skip.
    if (s.startsWith('<!--', i) || s.startsWith('<![CDATA[', i) || s.startsWith('<?', i))
      return false;
    if (s.startsWith('</', i)) {
      const e = s.indexOf('>', i);
      if (e < 0) return false;
      i = e + 1;
      continue;
    } // end tag
    i++; // past '<'
    const nameStart = i;
    while (i < s.length && /[\w:.-]/.test(s[i]!)) i++;
    if (i === nameStart) return false; // no element name
    const seen = new Set<string>();
    for (;;) {
      while (i < s.length && /\s/.test(s[i]!)) i++;
      if (i >= s.length) return false;
      if (s[i] === '>') {
        i++;
        break;
      }
      if (s[i] === '/' && s[i + 1] === '>') {
        i += 2;
        break;
      }
      const anStart = i;
      while (i < s.length && /[\w:.-]/.test(s[i]!)) i++;
      if (i === anStart) return false; // a bare token that is not a name = malformed attribute
      const name = s.slice(anStart, i);
      if (seen.has(name)) return false; // duplicate attribute
      seen.add(name);
      while (i < s.length && /\s/.test(s[i]!)) i++;
      if (s[i] !== '=') return false; // attribute must have a value
      i++;
      while (i < s.length && /\s/.test(s[i]!)) i++;
      const q = s[i];
      if (q !== '"' && q !== "'") return false; // value must be quoted
      const vEnd = s.indexOf(q, i + 1);
      if (vEnd < 0) return false;
      if (!attrValueOk(s.slice(i + 1, vEnd))) return false; // no raw '<' / bad '&' in the value
      i = vEnd + 1;
    }
  }
  return true;
}

export function isRunPropertiesCapsule(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith('<w:rPr') || !startsWithTag(t, 0, 'w:rPr')) return false;
  const end = matchElementEnd(t, 0, 'w:rPr');
  if (end === null || end !== t.length) return false; // trailing content -> not a lone element
  if (!hasStrictAttributes(t)) return false; // reject lenient-but-invalid attribute syntax
  const parsed = readXml(t);
  if (!parsed.ok) return false;
  // Exactly ONE top-level node, the w:rPr element — a stray text node (e.g. trailing `</w:rPr> x`)
  // or a second element means it is not a lone capsule.
  if (
    parsed.nodes.some((n) => n.type !== 'element' && !(n.type === 'text' && n.value.trim() === ''))
  )
    return false;
  const els = parsed.nodes.filter((n) => n.type === 'element');
  return els.length === 1 && els[0].name === 'w:rPr';
}

/** Same lone-balanced-element check as isRunPropertiesCapsule, for a paragraph's leading `<w:pPr>`.
 *  Rejects trailing content (`<w:pPr/><w:r>…` injection) or a non-w:pPr root. */
export function isParagraphPropertiesCapsule(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return true; // an empty capsule is a no-op splice
  if (!t.startsWith('<w:pPr') || !startsWithTag(t, 0, 'w:pPr')) return false;
  const end = matchElementEnd(t, 0, 'w:pPr');
  if (end === null || end !== t.length) return false;
  if (!hasStrictAttributes(t)) return false;
  const parsed = readXml(t);
  if (!parsed.ok) return false;
  if (
    parsed.nodes.some((n) => n.type !== 'element' && !(n.type === 'text' && n.value.trim() === ''))
  )
    return false;
  const els = parsed.nodes.filter((n) => n.type === 'element');
  return els.length === 1 && els[0].name === 'w:pPr';
}

/** Validate a paragraph opening-tag ATTRIBUTES capsule (e.g. ` w:rsidR="00AB" w14:paraId="X"`): it is
 *  spliced as `<w:p{capsule}>`, so it must be exactly a well-formed attribute list that closes no tag
 *  early. Parse `<w:p{capsule}/>` and require a single childless w:p element — an embedded `>`/`<` or
 *  a stray attribute value breaks that and is rejected (XML-injection boundary). */
export function isParagraphAttrsCapsule(s: string): boolean {
  if (s.length === 0) return true;
  if (s.includes('<') || s.includes('>')) return false; // no tag breakout in an attribute list
  const wrapped = `<w:p${s}/>`;
  if (!hasStrictAttributes(wrapped)) return false; // reject bare/unquoted/duplicate attributes
  const parsed = readXml(wrapped);
  if (!parsed.ok) return false;
  const els = parsed.nodes.filter((n) => n.type === 'element');
  return els.length === 1 && els[0].name === 'w:p' && els[0].children.length === 0;
}

/** Split a paragraph's inner content into its direct top-level `<w:r>…</w:r>` (or `<w:r/>`) run
 *  slices, in document order — so each run's rPr capsule can be extracted and aligned to the parsed
 *  runs (which, for a fully-captured paragraph, are exactly these direct children in order). Returns
 *  null on any malformed run structure. A leading `w:pPr` and inter-run whitespace are skipped. */
export function splitDirectRunSlices(paragraphInner: string): string[] | null {
  const s = paragraphInner;
  const runs: string[] = [];
  let i = 0;
  while (i < s.length) {
    // skip whitespace
    if (/\s/.test(s[i])) {
      i += 1;
      continue;
    }
    if (!s.startsWith('<', i)) return null; // stray text between runs -> not cleanly splittable
    if (s.startsWith('<w:pPr', i) && startsWithTag(s, i, 'w:pPr')) {
      const end = matchElementEnd(s, i, 'w:pPr');
      if (end === null) return null;
      i = end;
      continue;
    }
    if (s.startsWith('<w:r', i) && startsWithTag(s, i, 'w:r')) {
      const end = matchElementEnd(s, i, 'w:r');
      if (end === null) return null;
      runs.push(s.slice(i, end));
      i = end;
      continue;
    }
    return null; // any other element (hyperlink, bookmark, …) -> not a plain run sequence
  }
  return runs;
}

/** Scan the `<w:pPr …>` opening tag starting at `at` (index of '<'), returning where the tag ends
 *  and whether it self-closes. Handles '>' inside attribute values (single/double quoted). */
function findSelfCloseOrOpenEnd(
  s: string,
  at: number
): { tagEnd: number; selfClosing: boolean } | null {
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
export function paragraphInnerWithCapsule(
  capsule: ParagraphPropertiesCapsule | undefined,
  runsXml: string
): string {
  return `${capsule ?? ''}${runsXml}`;
}

/** The verbatim attribute text of a paragraph's `<w:p …>` opening tag (e.g. ` w:rsidR="00AB"`) — an
 *  ownership-scoped capsule for the unmodeled paragraph attributes (revision ids the model does not
 *  represent). Includes the exact leading whitespace so it re-splices byte-identically as
 *  `<w:p{attrs}>`. Empty means no attributes. */
export type ParagraphAttributesCapsule = string;

/** Extract the exact attribute text of a paragraph's opening `<w:p …>` tag from its source slice,
 *  byte-identical. Returns the attribute string (which may be '' when there are none), or null when
 *  the opening tag cannot be cleanly located (malformed / not a w:p). A self-closing `<w:p …/>` (an
 *  empty paragraph) returns its attributes too. */
export function extractParagraphOpenAttributes(
  paragraphSlice: string
): ParagraphAttributesCapsule | null {
  const s = paragraphSlice;
  const open = s.indexOf('<w:p');
  if (open < 0 || !startsWithTag(s, open, 'w:p')) return null;
  const tag = findSelfCloseOrOpenEnd(s, open);
  if (tag === null) return null;
  // Attributes span from just after the element name to the end of the opening tag, dropping a
  // trailing '/' for a self-closing tag.
  const attrsStart = open + '<w:p'.length;
  const attrsEnd = tag.selfClosing ? tag.tagEnd - 1 : tag.tagEnd;
  if (attrsEnd < attrsStart) return null;
  return s.slice(attrsStart, attrsEnd);
}
