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

/** OOXML toggle values that mean "off". Anything else present means "on". */
const OFF_VALUES = new Set(['0', 'false', 'off']);

/**
 * Whether a bare or explicitly-enabled toggle element (`w:b`, `w:i`) is present
 * in a capsule. Returns false for an absent toggle, an explicit-off value, and
 * for a complex-script sibling such as `w:bCs`, which must never satisfy `w:b`.
 */
export function capsuleToggle(capsule: string | undefined, tag: 'w:b' | 'w:i'): boolean {
  if (!capsule) return false;
  const open = `<${tag}`;
  let from = 0;
  for (;;) {
    const at = capsule.indexOf(open, from);
    if (at === -1) return false;
    const nextChar = capsule[at + open.length];
    // The element name must end here — otherwise this is `w:bCs`, `w:iCs`, or
    // another longer name that merely shares the prefix.
    if (nextChar === undefined) return false;
    if (nextChar === '>' || nextChar === '/' || nextChar === ' ') {
      const close = capsule.indexOf('>', at);
      if (close === -1) return false;
      const element = capsule.slice(at, close);
      const val = readVal(element);
      return val === null ? true : !OFF_VALUES.has(val);
    }
    from = at + open.length;
  }
}

/** The `w:val` attribute of one element, or null when it carries none. */
function readVal(element: string): string | null {
  const at = element.indexOf('w:val=');
  if (at === -1) return null;
  const quote = element[at + 6];
  if (quote !== '"' && quote !== "'") return null;
  const end = element.indexOf(quote, at + 7);
  if (end === -1) return null;
  return element.slice(at + 7, end).toLowerCase();
}
