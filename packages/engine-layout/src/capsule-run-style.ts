// Reading modeled formatting out of a preservation capsule (M4.0 follow-up).
//
// A run parsed with preservation carries its verbatim `<w:rPr>` as `rPrCapsule`
// instead of modeled `props`. That keeps the bytes lossless on save, but layout
// only ever read `props`, so reopening a document painted every preserved run
// unstyled — bold text came back looking plain even though the file still said
// bold. This reads just the two toggles layout can render.
//
// Capsule text is file-derived and therefore attacker-controlled: the scan is a
// bounded character walk with no backtracking regex.
//
// Rewritten after an independent security review demonstrated six ways the first
// version disagreed with Word on capsules the parse boundary accepts verbatim.
// Each is handled below and each has a test:
//
//   1. A raw `>` inside an attribute value (`<w:b w:x="a>b" w:val="0"/>`) ended
//      the element early, hiding `w:val` and reporting ON for a not-bold run.
//   2. XML whitespace other than a space after the name (`<w:b\n/>`) was read as
//      part of a longer name, reporting OFF for a bold run.
//   3. A character entity in the value (`w:val="&#48;"`) was compared raw, so an
//      OFF toggle read as ON.
//   4. `<!-- <w:b/> -->` and `<![CDATA[<w:b/>]]>` counted as real elements.
//   5. Duplicates took the FIRST match; OOXML toggle properties are last-wins.
//   6. A `w:val` inside a different attribute's value was read as this element's.
//
// The repo already owns correct primitives of this shape in
// `engine-core/src/package/preservation-capsule.ts` (`startsWithTag`,
// `findSelfCloseOrOpenEnd`). They are module-private there, so the same rules are
// re-applied here. If those are ever exported, this file should call them.

/** OOXML toggle values that mean "off". Anything else present means "on". */
const OFF_VALUES = new Set(['0', 'false', 'off']);

/** XML whitespace, any of which may terminate an element name. */
function isXmlSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Decode the entity forms that can legally appear in an attribute value. An
 * undecoded `&#48;` compares unequal to `0` and flips an OFF toggle to ON.
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    const numeric =
      body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff
      ? String.fromCodePoint(numeric)
      : whole;
  });
}

/**
 * Index of the `>` closing the element that starts at `from`, scanned
 * quote-aware so a `>` inside an attribute value does not end it early.
 * Returns -1 when the element is unterminated.
 */
function elementEnd(capsule: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < capsule.length; i += 1) {
    const ch = capsule[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

/**
 * The `w:val` of one element, or null when it declares none. Parsed
 * attribute-by-attribute and quote-aware, so a `w:val` sitting inside another
 * attribute's value is not mistaken for this element's own.
 */
function readVal(element: string): string | null {
  let i = 0;
  while (i < element.length && !isXmlSpace(element[i])) i += 1; // skip the name
  while (i < element.length) {
    while (i < element.length && (isXmlSpace(element[i]) || element[i] === '/')) i += 1;
    const nameStart = i;
    while (
      i < element.length &&
      element[i] !== '=' &&
      !isXmlSpace(element[i]) &&
      element[i] !== '/'
    )
      i += 1;
    const name = element.slice(nameStart, i);
    if (name.length === 0 && i >= element.length) break;
    while (i < element.length && isXmlSpace(element[i])) i += 1;
    if (element[i] !== '=') {
      if (name.length === 0) i += 1;
      continue;
    }
    i += 1;
    while (i < element.length && isXmlSpace(element[i])) i += 1;
    const quote = element[i];
    if (quote !== '"' && quote !== "'") break;
    i += 1;
    const valueStart = i;
    while (i < element.length && element[i] !== quote) i += 1;
    const rawValue = element.slice(valueStart, i);
    i += 1;
    if (name === 'w:val') return decodeEntities(rawValue).trim().toLowerCase();
  }
  return null;
}

/**
 * Whether a toggle element (`w:b`, `w:i`) is enabled in a capsule.
 *
 * False for an absent toggle, an explicit-off `w:val`, and for a complex-script
 * sibling such as `w:bCs`, which must never satisfy `w:b`. Comment and CDATA
 * regions are skipped, and when a toggle appears more than once the LAST
 * occurrence wins, matching OOXML.
 */
export function capsuleToggle(capsule: string | undefined, tag: 'w:b' | 'w:i'): boolean {
  if (!capsule) return false;
  const open = `<${tag}`;
  let result = false;
  let found = false;
  let i = 0;

  while (i < capsule.length) {
    // Regions that look like markup but are not.
    if (capsule.startsWith('<!--', i)) {
      const close = capsule.indexOf('-->', i + 4);
      i = close === -1 ? capsule.length : close + 3;
      continue;
    }
    if (capsule.startsWith('<![CDATA[', i)) {
      const close = capsule.indexOf(']]>', i + 9);
      i = close === -1 ? capsule.length : close + 3;
      continue;
    }
    // `w:rPrChange` (ECMA-376 17.13.5.31) is a legitimate `w:rPr` child holding
    // the run's PREVIOUS properties for a tracked change. Its nested `w:rPr` is
    // history, not current formatting, and the last-wins rule would otherwise let
    // that historical value beat the live one — mis-rendering ordinary Word
    // documents with tracked changes, no crafted markup required.
    if (capsule.startsWith('<w:rPrChange', i)) {
      const close = capsule.indexOf('</w:rPrChange>', i);
      if (close === -1) {
        // Unterminated: skip the rest rather than read history as current.
        break;
      }
      i = close + '</w:rPrChange>'.length;
      continue;
    }
    // A processing instruction is legal in element content and is not an element.
    if (capsule.startsWith('<?', i)) {
      const close = capsule.indexOf('?>', i + 2);
      i = close === -1 ? capsule.length : close + 2;
      continue;
    }
    if (!capsule.startsWith(open, i)) {
      // Skip quoted attribute text in the OUTER walk too, so a toggle spelled
      // inside another element's attribute value is not mistaken for markup.
      if (capsule[i] === '"' || capsule[i] === "'") {
        const quote = capsule[i]!;
        const close = capsule.indexOf(quote, i + 1);
        i = close === -1 ? capsule.length : close + 1;
        continue;
      }
      i += 1;
      continue;
    }
    // The name must END here, or this is `w:bCs`, `w:iCs`, or another longer
    // name that merely shares the prefix.
    const after = capsule[i + open.length];
    if (after !== '>' && after !== '/' && !isXmlSpace(after)) {
      i += open.length;
      continue;
    }
    const end = elementEnd(capsule, i);
    if (end === -1) break;
    const val = readVal(capsule.slice(i + 1, end));
    result = val === null ? true : !OFF_VALUES.has(val);
    found = true;
    i = end + 1;
  }

  return found ? result : false;
}
