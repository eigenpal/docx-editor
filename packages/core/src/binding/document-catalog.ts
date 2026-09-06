// Document-derived catalogs: the fonts a document uses and the styles it defines.
//
// Both derivations read the CANONICAL TREES — the current main part, the immutable
// styles part, and the resolved header/footer parts — never the DOM or the layout.
// They exist for chrome (font picker, style picker), so every string that leaves this
// module is validated here at the derivation boundary: a font name or style name is
// authored file content, and downstream sinks (CSS font-family, dropdown labels) must
// only ever receive names this module has already bounded.

import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { themeFontFamilyOf, type ThemeSchemeFaces } from '../store/package/theme-font-scheme.ts';
import { symbolFontFamily } from '../store/package/run-defaults.ts';

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

/** `w:rFonts` attributes that reference a theme font slot rather than naming a family. */
const RFONTS_THEME_ATTRS = ['asciiTheme', 'hAnsiTheme', 'cstheme', 'eastAsiaTheme'] as const;

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
export function collectDocumentFonts(
  roots: readonly OoxmlElement[],
  themeFonts?: ThemeSchemeFaces
): readonly string[] {
  const byFold = new Map<string, string>();
  // Composed from per-subtree memos: every keystroke publishes a new root whose children
  // are all shared but one, and re-walking the whole document per commit made the font
  // picker's derivation a per-keystroke cost on long documents. The memo is keyed on the
  // immutable subtree node plus the theme pair, because the theme decides what a theme
  // slot reference contributes.
  for (const root of roots) {
    // The root ELEMENT itself is walked directly (a root is never an `rFonts`); its
    // children carry the memo.
    for (const child of root.children) {
      if (!isElement(child)) continue;
      for (const [fold, family] of subtreeFontsOf(child, themeFonts)) {
        if (!byFold.has(fold)) byFold.set(fold, family);
      }
    }
  }
  const fonts = [...byFold.values()];
  fonts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return fonts;
}

interface SubtreeFontsMemo {
  readonly major: string | null;
  readonly minor: string | null;
  readonly majorEastAsia: string | null;
  readonly minorEastAsia: string | null;
  readonly byFold: ReadonlyMap<string, string>;
}
const subtreeFontsMemos = new WeakMap<OoxmlElement, SubtreeFontsMemo>();

/**
 * Containers at least this wide compose from their children's memos instead of walking:
 * `w:body` (thousands of blocks) must not be one memo entry, or the first edit under it
 * re-walks the whole story anyway.
 */
const COMPOSE_CHILD_THRESHOLD = 16;
/** Compose recursion stops here; deeper subtrees take the iterative terminal walk. */
const MAX_COMPOSE_DEPTH = 32;

function subtreeFontsOf(
  subtree: OoxmlElement,
  themeFonts: ThemeSchemeFaces | undefined,
  depth = 0
): ReadonlyMap<string, string> {
  const major = themeFonts?.major ?? null;
  const minor = themeFonts?.minor ?? null;
  // The East Asian faces are part of the memo key for the same reason the Latin pair is:
  // the theme decides what a theme slot reference contributes, so a memo keyed on fewer
  // faces than the resolution reads would answer stale fonts after a retheme.
  const majorEastAsia = themeFonts?.majorEastAsia ?? null;
  const minorEastAsia = themeFonts?.minorEastAsia ?? null;
  const cached = subtreeFontsMemos.get(subtree);
  if (
    cached &&
    cached.major === major &&
    cached.minor === minor &&
    cached.majorEastAsia === majorEastAsia &&
    cached.minorEastAsia === minorEastAsia
  ) {
    return cached.byFold;
  }
  if (
    subtree.children.length >= COMPOSE_CHILD_THRESHOLD &&
    depth < MAX_COMPOSE_DEPTH &&
    subtree.localName !== 'rFonts'
  ) {
    const merged = new Map<string, string>();
    for (const child of subtree.children) {
      if (!isElement(child)) continue;
      for (const [fold, family] of subtreeFontsOf(child, themeFonts, depth + 1)) {
        if (!merged.has(fold)) merged.set(fold, family);
      }
    }
    subtreeFontsMemos.set(subtree, { major, minor, majorEastAsia, minorEastAsia, byFold: merged });
    return merged;
  }
  const byFold = new Map<string, string>();
  const add = (family: string | null | undefined): void => {
    if (!family || !FONT_NAME.test(family)) return;
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  };
  // Iterative walk: the parse already bounds tree depth, but this derivation must not
  // be the one place a deep generic subtree can overflow the call stack. Children are
  // pushed in reverse so the stack pops them in DOCUMENT order — "first-seen casing"
  // has to mean the first occurrence a reader would see, not the last.
  const stack: OoxmlNode[] = [subtree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.localName === 'rFonts') {
      for (const attr of RFONTS_FAMILY_ATTRS) {
        add(attributeValue(node, attr));
      }
      // A theme reference (`w:asciiTheme="minorHAnsi"`) names no family itself, but the
      // document still USES the theme's face — a template styled entirely through the
      // theme otherwise reported "no fonts" while every run rendered in one.
      if (themeFonts) {
        for (const attr of RFONTS_THEME_ATTRS) {
          add(themeFontFamilyOf(attributeValue(node, attr), themeFonts));
        }
      }
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  subtreeFontsMemos.set(subtree, { major, minor, majorEastAsia, minorEastAsia, byFold });
  return byFold;
}

/**
 * Every valid family a `w:sym/@w:font` names, deduplicated and sorted like
 * {@link collectDocumentFonts}, and validated at the same boundary for the same reason.
 *
 * Kept apart from the font catalog because the two answer different questions.
 * `collectDocumentFonts` answers what the document DECLARES — `w:rFonts` — and a `w:sym`
 * face is not a declaration; it is the face ONE glyph is drawn from. A font resolver still
 * has to hear about it: `layout/symbol-run.ts` keeps an unmapped private-use code point in
 * the authored face, which paints as a tofu box in any other, and an app that owns those
 * bytes can only supply them if it is told the document wants them.
 */
export function collectSymbolFontFamilies(roots: readonly OoxmlElement[]): readonly string[] {
  const byFold = new Map<string, string>();
  for (const root of roots) {
    // The root element is never a `w:sym`; its children carry the memo, exactly as in
    // `collectDocumentFonts`.
    for (const child of root.children) {
      if (!isElement(child)) continue;
      for (const [fold, family] of subtreeSymbolFontsOf(child)) {
        if (!byFold.has(fold)) byFold.set(fold, family);
      }
    }
  }
  const fonts = [...byFold.values()];
  fonts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return fonts;
}

/**
 * Per-subtree memo, for the reason {@link collectDocumentFonts} has one: this is a public
 * session answer, and a derivation that re-walks every story per revision becomes a
 * per-keystroke cost the moment any chrome reads it in a selector. No theme in the key —
 * `w:sym/@w:font` is a literal family name, never a theme slot.
 */
const subtreeSymbolFontsMemos = new WeakMap<OoxmlElement, ReadonlyMap<string, string>>();

/**
 * Shared by every subtree that names no symbol face, which in a real document is nearly all
 * of them: a per-block empty `Map` retained for the life of the tree is pure overhead.
 */
const NO_SYMBOL_FONTS: ReadonlyMap<string, string> = new Map();

function subtreeSymbolFontsOf(subtree: OoxmlElement, depth = 0): ReadonlyMap<string, string> {
  const cached = subtreeSymbolFontsMemos.get(subtree);
  if (cached) return cached;
  const remember = (byFold: Map<string, string>): ReadonlyMap<string, string> => {
    const answer = byFold.size === 0 ? NO_SYMBOL_FONTS : byFold;
    subtreeSymbolFontsMemos.set(subtree, answer);
    return answer;
  };
  const byFold = new Map<string, string>();
  // The compose branch never inspects the node itself, so a `w:sym` wide enough to take it
  // would lose its own face — the same self-check `subtreeFontsOf` makes for `w:rFonts`.
  // `w:sym` is a generic node, so a hand-built package can give it children.
  if (
    subtree.children.length >= COMPOSE_CHILD_THRESHOLD &&
    depth < MAX_COMPOSE_DEPTH &&
    subtree.localName !== 'sym'
  ) {
    for (const child of subtree.children) {
      if (!isElement(child)) continue;
      for (const [fold, family] of subtreeSymbolFontsOf(child, depth + 1)) {
        if (!byFold.has(fold)) byFold.set(fold, family);
      }
    }
    return remember(byFold);
  }
  // Iterative and depth-safe like its sibling, and children push in reverse for the same
  // reason: first-seen casing has to mean the first occurrence a reader would see.
  const stack: OoxmlNode[] = [subtree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.localName === 'sym' && node.namespaceUri === WML_NAMESPACE_URI) {
      // The WML namespace or none, matching how `layout/symbol-run.ts` reads it: a face
      // layout will not use is a face no resolver should be asked for.
      const authored = node.attributes.find(
        (attribute) =>
          attribute.localName === 'font' &&
          (attribute.namespaceUri === WML_NAMESPACE_URI || attribute.namespaceUri === '')
      )?.value;
      // `symbolFontFamily` applies the same bound `FONT_NAME` does here, plus Word's
      // vertical-writing `@` prefix — one rule, shared with the export lane's own walk.
      const family = symbolFontFamily(authored);
      if (family !== null && !byFold.has(family.toLowerCase())) {
        byFold.set(family.toLowerCase(), family);
      }
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  return remember(byFold);
}

/**
 * Whether any of `roots` actually puts CHARACTERS on a page.
 *
 * `collectDocumentFonts` answers what the document DECLARES, which is what a font picker
 * wants: a catalog of names. A font-substitution notice asks a different question — is
 * any text rendering in the wrong face — and a declaration alone never renders anything.
 * A freshly created document carries Word's `w:docDefaults` (Calibri) over a single empty
 * paragraph, so it declares a family while showing no glyph of it.
 *
 * Deliberately literal characters only: `w:t` (typed or demoted to generic) holding a
 * non-empty value. A drawing, a bookmark or an empty run puts no glyph on the page, so a
 * document made only of those has nothing a substitute face could get wrong. Same
 * iterative, depth-safe walk as the font catalog, and the same roots, so the two
 * derivations can never disagree about what "the document" is.
 */
export function documentRendersText(roots: readonly OoxmlElement[]): boolean {
  const stack: OoxmlNode[] = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.localName === 't' && node.namespaceUri === WML_NAMESPACE_URI) {
      for (const child of node.children) {
        if (!isElement(child) && child.value.length > 0) return true;
      }
      continue;
    }
    for (const child of node.children) stack.push(child);
  }
  return false;
}

/**
 * How a style LOOKS, for a picker to preview it in its own face — Word shows the gallery
 * that way, and a list of identical rows makes the user apply a style to find out what it
 * is. PRESENTATION ONLY: these are the few properties a one-line preview can show, not the
 * cascade layout resolves. Every value is already bounded here (the family against the same
 * shape the CSS sink enforces, the colour against six hex digits), because a picker renders
 * them into a style attribute and they come from an attacker-controlled `styles.xml`.
 */
export interface DocumentStylePreview {
  readonly fontFamily: string | null;
  /** Points, already halved from `w:sz`. Null when the style states no size. */
  readonly fontSizePt: number | null;
  readonly bold: boolean;
  readonly italic: boolean;
  /** RRGGBB, or null for inherited/automatic — theme colours are not resolved here. */
  readonly color: string | null;
}

/** One `w:style` definition, projected for a style picker. */
export interface DocumentStyleEntry {
  readonly styleId: string;
  readonly name: string;
  readonly type: string;
  readonly preview: DocumentStylePreview;
}

const STYLE_TYPES = new Set(['paragraph', 'character', 'table', 'numbering']);

/** Six hex digits — the only `w:color` value a preview will render. */
const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;

/**
 * How far a `w:basedOn` chain is walked. Deep enough for any real styles part, bounded
 * because the chain comes from the file and can be made circular (D14 resource limits).
 */
const BASED_ON_DEPTH = 16;

/**
 * Word's Styles gallery order, which is NOT the order `styles.xml` lists definitions in —
 * a round-tripped file commonly puts Heading 6 above Heading 1, and a picker showing that
 * looks broken. Everything unranked keeps its document order after the ranked ones.
 */
const STYLE_RANK: ReadonlyMap<string, number> = new Map([
  ['normal', 0],
  ['title', 1],
  ['subtitle', 2],
  ['heading 1', 11],
  ['heading 2', 12],
  ['heading 3', 13],
  ['heading 4', 14],
  ['heading 5', 15],
  ['heading 6', 16],
  ['heading 7', 17],
  ['heading 8', 18],
  ['heading 9', 19],
]);

/**
 * A node's children as a plain node list.
 *
 * `OoxmlElement` is a union whose leaf members declare `readonly []`, so reading `.children`
 * off the union loses `Array.find`'s type-guard overload — the same reason the run-defaults
 * lane widens before iterating.
 */
function childrenOf(node: OoxmlElement): readonly OoxmlNode[] {
  return node.children as readonly OoxmlNode[];
}

/** The first child element with this local name. */
function childElementNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of childrenOf(node)) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

function styleRank(entry: DocumentStyleEntry): number {
  return (
    STYLE_RANK.get(entry.name.toLowerCase()) ??
    STYLE_RANK.get(entry.styleId.toLowerCase()) ??
    Number.MAX_SAFE_INTEGER
  );
}

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
  stylesRoot: OoxmlElement | null,
  /**
   * Font family and size for a styleId, resolved through the basedOn chain, `docDefaults`
   * and the theme font scheme. Injected because THAT resolution belongs to the run-defaults
   * lane, which already owns theme slots — this module would otherwise grow a second,
   * divergent copy of it. Without one the preview simply carries no font or size.
   */
  resolveDefaults?: (styleId: string) => {
    readonly fontFamily: string | null;
    readonly fontSizeHalfPoints: number | null;
  }
): readonly DocumentStyleEntry[] {
  if (!stylesRoot) return [];
  const definitions = new Map<string, OoxmlElement>();
  for (const child of stylesRoot.children) {
    if (!isElement(child) || child.localName !== 'style') continue;
    const styleId = boundedString(attributeValue(child, 'styleId'));
    if (styleId !== null && !definitions.has(styleId)) definitions.set(styleId, child);
  }

  /** `w:b`/`w:i`/`w:color` as the style chain leaves them, nearest definition winning. */
  const previewOf = (styleId: string): DocumentStylePreview => {
    let bold = false;
    let italic = false;
    let color: string | null = null;
    let seenBold = false;
    let seenItalic = false;
    const seen = new Set<string>();
    let current: string | null = styleId;
    for (let depth = 0; depth < BASED_ON_DEPTH && current !== null; depth += 1) {
      // A `w:basedOn` cycle is authored content, not a bug — refuse to walk it twice.
      if (seen.has(current)) break;
      seen.add(current);
      const definition = definitions.get(current);
      if (!definition) break;
      const rPr = childElementNamed(definition, 'rPr');
      for (const property of rPr ? childrenOf(rPr) : []) {
        if (!isElement(property)) continue;
        const val = attributeValue(property, 'val');
        // `w:b`/`w:i` are ST_OnOff: present with no `w:val` means on.
        const on = val !== '0' && val !== 'false' && val !== 'off';
        if (property.localName === 'b' && !seenBold) {
          bold = on;
          seenBold = true;
        } else if (property.localName === 'i' && !seenItalic) {
          italic = on;
          seenItalic = true;
        } else if (property.localName === 'color' && color === null && val && HEX_COLOR.test(val)) {
          color = val;
        }
      }
      const basedOn = childElementNamed(definition, 'basedOn');
      current = basedOn ? boundedString(attributeValue(basedOn, 'val')) : null;
    }
    const defaults = resolveDefaults?.(styleId);
    const family = defaults?.fontFamily ?? null;
    return {
      // Re-validated at THIS boundary even though the resolver bounds it too: the preview
      // is rendered into a font-family declaration, and this module is the one that
      // promises every string leaving it is safe for that sink.
      fontFamily: family !== null && FONT_NAME.test(family) ? family : null,
      fontSizePt:
        defaults?.fontSizeHalfPoints != null && defaults.fontSizeHalfPoints > 0
          ? defaults.fontSizeHalfPoints / 2
          : null,
      bold,
      italic,
      color,
    };
  };

  const entries: DocumentStyleEntry[] = [];
  for (const [styleId, definition] of definitions) {
    const type = attributeValue(definition, 'type');
    if (type === undefined || !STYLE_TYPES.has(type)) continue;
    const nameElement = childElementNamed(definition, 'name');
    const name = boundedString(nameElement ? attributeValue(nameElement, 'val') : undefined);
    entries.push({ styleId, name: name ?? styleId, type, preview: previewOf(styleId) });
  }
  // Stable: equal ranks keep document order, so an unranked style never jumps around
  // between reads of the same document.
  return entries
    .map((entry, index) => ({ entry, index, rank: styleRank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.entry);
}
