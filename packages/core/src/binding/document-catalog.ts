// Document-derived catalogs: the fonts a document uses and the styles it defines.
//
// Both derivations read the CANONICAL TREES — the current main part, the immutable
// styles part, and the resolved header/footer parts — never the DOM or the layout.
// They exist for chrome (font picker, style picker), so every string that leaves this
// module is validated here at the derivation boundary: a font name or style name is
// authored file content, and downstream sinks (CSS font-family, dropdown labels) must
// only ever receive names this module has already bounded.

import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';

/**
 * The same shape `semantic-paint.ts` enforces at the CSS sink (its `FONT_NAME`):
 * Unicode letters/digits/marks plus the join punctuation real family names use,
 * bounded to 64 characters. Control characters, quotes, backslashes, semicolons and
 * the empty string all fail. Kept in sync by value rather than import because the
 * paint module is a different lane (output) and deliberately re-validates at its own
 * sink either way.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

/** `w:rFonts` attributes that name a font family (theme* attributes name theme SLOTS). */
const RFONTS_FAMILY_ATTRS = ['ascii', 'hAnsi', 'cs', 'eastAsia'] as const;

/** Identifier-ish strings from a file (style ids, style names): bounded, no controls. */
const STYLE_STRING_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/**
 * Every valid family name any `w:rFonts` in `roots` mentions, deduplicated
 * case-insensitively (first-seen casing wins, so `Arial` and `arial` collapse to one
 * entry spelled the way the document first spelled it) and sorted by code point for a
 * deterministic picker order. Invalid names — over 64 characters, control characters,
 * CSS-breaking punctuation — are dropped, never repaired.
 */
export function collectDocumentFonts(roots: readonly OoxmlElement[]): readonly string[] {
  const byFold = new Map<string, string>();
  // Iterative walk: the parse already bounds tree depth, but this derivation must not
  // be the one place a deep generic subtree can overflow the call stack. Children are
  // pushed in reverse so the stack pops them in DOCUMENT order — "first-seen casing"
  // has to mean the first occurrence a reader would see, not the last.
  const stack: OoxmlNode[] = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.localName === 'rFonts') {
      for (const attr of RFONTS_FAMILY_ATTRS) {
        const family = attributeValue(node, attr);
        if (family === undefined || !FONT_NAME.test(family)) continue;
        const fold = family.toLowerCase();
        if (!byFold.has(fold)) byFold.set(fold, family);
      }
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  const fonts = [...byFold.values()];
  fonts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return fonts;
}

/** One `w:style` definition, projected for a style picker. */
export interface DocumentStyleEntry {
  readonly styleId: string;
  readonly name: string;
  readonly type: string;
}

const STYLE_TYPES = new Set(['paragraph', 'character', 'table', 'numbering']);

function boundedString(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0 || raw.length > STYLE_STRING_MAX) return null;
  if (CONTROL_CHARS.test(raw)) return null;
  return raw;
}

/**
 * The style definitions of a `/word/styles.xml` tree: every `w:style` child of the
 * root with an accepted `w:type`, a valid `w:styleId`, and a display name from the
 * `w:name` child's `w:val` (falling back to the styleId when the name is absent or
 * fails validation). Definitions with a missing or invalid styleId are dropped: an
 * unaddressable style cannot be applied, so listing it would be a dead control.
 */
export function collectDocumentStyles(
  stylesRoot: OoxmlElement | null
): readonly DocumentStyleEntry[] {
  if (!stylesRoot) return [];
  const entries: DocumentStyleEntry[] = [];
  for (const child of stylesRoot.children) {
    if (!isElement(child) || child.localName !== 'style') continue;
    const type = attributeValue(child, 'type');
    if (type === undefined || !STYLE_TYPES.has(type)) continue;
    const styleId = boundedString(attributeValue(child, 'styleId'));
    if (styleId === null) continue;
    const nameElement = child.children.find(
      (grandchild): grandchild is OoxmlElement =>
        isElement(grandchild) && grandchild.localName === 'name'
    );
    const name = boundedString(nameElement ? attributeValue(nameElement, 'val') : undefined);
    entries.push({ styleId, name: name ?? styleId, type });
  }
  return entries;
}
