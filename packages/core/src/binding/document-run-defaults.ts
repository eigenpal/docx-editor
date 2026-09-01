// Effective run defaults: what a run inherits when it carries no direct `w:rFonts`/`w:sz`.
//
// The layout resolves DIRECT run formatting only, so a span whose font or size comes from
// its paragraph style, the style's `basedOn` chain, `w:docDefaults`, or the theme's font
// scheme reports `fontFamily: null` and the fallback size. This module resolves that chain
// from the canonical styles and theme trees, so a formatting read can always answer the
// effective value the way Word's font boxes do.
//
// Reads the CANONICAL trees, never the DOM or the layout. Every name that leaves this
// module is validated here (the same `FONT_NAME` bound as document-catalog): style ids,
// font names and sizes are authored file content, and the chrome that displays them must
// only receive values this module has bounded. Chain walks are cycle-safe and capped —
// a `basedOn` loop is file content too.

import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { themeFontFamilyOf } from '../store/package/theme-font-scheme.ts';
import type { DocumentThemeFonts } from './document-theme.ts';

/** What a run inherits at one point of the chain — null means "nothing authored". */
export interface StyleRunDefaults {
  readonly fontFamily: string | null;
  readonly fontSizeHalfPoints: number | null;
}

/** One run property as the layout records carry it (structurally SurfaceProperty). */
export interface RunPropertyLike {
  readonly localName: string;
  readonly attributes?: Record<string, string>;
}

const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;
const STYLE_ID_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
/** `basedOn` walk cap: Word's own UI maxes out far below this. */
const CHAIN_CAP = 16;
/** `w:sz` bounds, matching the engine's `setMarkAttr` gate. */
const SZ_MIN = 2;
const SZ_MAX = 3276;

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function childElement(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  // A plain loop: `parent.children` is a UNION of typed child-array shapes, and calling
  // `.find` with a type-guard callback across that union defeats the guard overload.
  for (const child of parent.children as readonly OoxmlNode[]) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

export function validStyleId(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0 || raw.length > STYLE_ID_MAX) return null;
  if (CONTROL_CHARS.test(raw)) return null;
  return raw;
}

/**
 * The family an `w:rFonts` element names: the theme attributes through the font scheme,
 * then `ascii ?? hAnsi` (the spelling the engine reads back).
 *
 * Theme first, matching §17.3.2.26 and `resolveRunStyle` in the layout lane: Word writes
 * both, the concrete name only so readers that cannot resolve a theme have something to
 * use. Reading it in preference would make this answer a different font from the one the
 * document is painted in, which is what the font box would then display.
 */
export function familyFromRFonts(
  rFonts: OoxmlElement,
  themeFonts: DocumentThemeFonts
): string | null {
  // The shared token table (`theme-font-scheme.ts`) resolves the East Asian tokens too:
  // `w:asciiTheme="minorEastAsia"` is Word's "use East Asian fonts on Latin text", and
  // this reader must answer the same face the layout lane paints.
  const themed =
    themeFontFamilyOf(attributeValue(rFonts, 'asciiTheme'), themeFonts) ??
    themeFontFamilyOf(attributeValue(rFonts, 'hAnsiTheme'), themeFonts);
  if (themed !== null) return themed;
  const direct = attributeValue(rFonts, 'ascii') ?? attributeValue(rFonts, 'hAnsi');
  if (direct === undefined) return null;
  return FONT_NAME.test(direct) ? direct : null;
}

/** What one `w:rPr` container contributes: validated family and size, or nulls. */
function rPrDefaults(
  rPr: OoxmlElement | undefined,
  themeFonts: DocumentThemeFonts
): StyleRunDefaults {
  if (!rPr) return { fontFamily: null, fontSizeHalfPoints: null };
  const rFonts = childElement(rPr, 'rFonts');
  const sz = childElement(rPr, 'sz');
  const rawSize = sz ? attributeValue(sz, 'val') : undefined;
  const size = rawSize !== undefined && /^\d{1,4}$/.test(rawSize) ? Number(rawSize) : null;
  return {
    fontFamily: rFonts ? familyFromRFonts(rFonts, themeFonts) : null,
    fontSizeHalfPoints: size !== null && size >= SZ_MIN && size <= SZ_MAX ? size : null,
  };
}

interface StyleEntry {
  readonly basedOn: string | null;
  readonly own: StyleRunDefaults;
}

/**
 * A resolver for the inherited run defaults of a style: the style's own `w:rPr`, its
 * `basedOn` chain, then `w:docDefaults/w:rPrDefault` — first authored value wins, the
 * same precedence Word applies. `styleId: null` answers the document defaults alone.
 *
 * Parsing happens once; per-style resolution is memoized. Both trees are immutable
 * in-session, so the resolver's lifetime is the session's.
 */
export function createRunDefaultsResolver(
  stylesRoot: OoxmlElement | null,
  themeFonts: DocumentThemeFonts
): (styleId: string | null, runProperties?: readonly RunPropertyLike[]) => StyleRunDefaults {
  const styles = new Map<string, StyleEntry>();
  let docDefaults: StyleRunDefaults = { fontFamily: null, fontSizeHalfPoints: null };

  if (stylesRoot) {
    const defaults = childElement(stylesRoot, 'docDefaults');
    const rPrDefault = defaults ? childElement(defaults, 'rPrDefault') : undefined;
    docDefaults = rPrDefaults(rPrDefault ? childElement(rPrDefault, 'rPr') : undefined, themeFonts);

    for (const child of stylesRoot.children as readonly OoxmlNode[]) {
      if (!isElement(child) || child.localName !== 'style') continue;
      const styleId = validStyleId(attributeValue(child, 'styleId'));
      if (styleId === null || styles.has(styleId)) continue;
      const basedOnElement = childElement(child, 'basedOn');
      styles.set(styleId, {
        basedOn: validStyleId(basedOnElement ? attributeValue(basedOnElement, 'val') : undefined),
        own: rPrDefaults(childElement(child, 'rPr'), themeFonts),
      });
    }
  }

  const memo = new Map<string, StyleRunDefaults>();
  const chainOf = (styleId: string | null): StyleRunDefaults => {
    const key = styleId ?? '';
    const cached = memo.get(key);
    if (cached) return cached;
    let fontFamily: string | null = null;
    let fontSizeHalfPoints: number | null = null;
    const seen = new Set<string>();
    let at = styleId;
    for (let depth = 0; at !== null && depth < CHAIN_CAP && !seen.has(at); depth += 1) {
      seen.add(at);
      const entry = styles.get(at);
      if (!entry) break;
      fontFamily ??= entry.own.fontFamily;
      fontSizeHalfPoints ??= entry.own.fontSizeHalfPoints;
      at = entry.basedOn;
    }
    const resolved: StyleRunDefaults = {
      fontFamily: fontFamily ?? docDefaults.fontFamily,
      fontSizeHalfPoints: fontSizeHalfPoints ?? docDefaults.fontSizeHalfPoints,
    };
    memo.set(key, resolved);
    return resolved;
  };

  return (styleId, runProperties) => {
    const chain = chainOf(styleId);
    // A run-level `w:rFonts` naming a THEME slot outranks the whole style chain, the same
    // precedence `familyFromRFonts` applies within one element.
    const rFonts = runProperties?.find((property) => property.localName === 'rFonts');
    const runTheme = rFonts
      ? (themeFontFamilyOf(rFonts.attributes?.asciiTheme, themeFonts) ??
        themeFontFamilyOf(rFonts.attributes?.hAnsiTheme, themeFonts))
      : null;
    return runTheme === null ? chain : { ...chain, fontFamily: runTheme };
  };
}
