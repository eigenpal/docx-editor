// Which face draws text when the face a document names is missing, or lacks a glyph.
//
// One set of rules for every renderer. The editor and each exporter read these tables, so a
// missing family, a missing glyph, and a missing symbol font select the same face and the same
// line box everywhere. Only the bytes come from different places: a browser host fetches them,
// a server reads them from disk. Nothing here fetches or reads a font.
//
// A run names its fonts in `w:rFonts` (`CT_Fonts`, ECMA-376 Part 1, 17.3.2.26). When an
// application cannot locate a named font, it finds an alternative: font substitution (17.8.2).
// The standard leaves the algorithm to the application, so every renderer here must use the
// same one, or one document wraps at different places in each.

import { LOCALIZED_EAST_ASIAN_FAMILIES } from '../store/package/default-font-faces.ts';
import type { FontRequest } from './font-resource.ts';

/**
 * Localized names that documents saved in a Chinese, Japanese, or Korean locale write for
 * common East Asian families, each mapped to the family's English name.
 */
export const LOCALIZED_FONT_FAMILIES = LOCALIZED_EAST_ASIAN_FAMILIES;

/** A line box as em ratios of the font size, as a substitution's `lineMetrics` carries it. */
export interface FallbackLineBox {
  readonly heightEm: number;
  readonly baselineEm: number;
}

/** The face that covers Chinese, Japanese, and Korean text when no other face does. */
export const CJK_FALLBACK_FAMILY = 'Noto Sans CJK JP';

/** The face that stands in for a missing symbol family. */
export const SYMBOL_STAND_IN_FAMILY = 'Noto Sans Symbols 2';

/** The metric-compatible Latin faces, by class. */
const SERIF_STAND_IN_FAMILY = 'Liberation Serif';
const SANS_STAND_IN_FAMILY = 'Liberation Sans';
const MONO_STAND_IN_FAMILY = 'Liberation Mono';

/**
 * The families whose faces draw a character that the run's own face lacks, in the order the
 * shaper tries them, small faces first.
 *
 * A host need not supply all of them: a family with no bytes is skipped. `Segoe UI Symbol`
 * heads the list as the symbol face that documents expect; where it is missing, its
 * stand-in draws the glyph and keeps its line box ({@link standInLineBox}).
 */
export const GLYPH_FALLBACK_FAMILIES: readonly string[] = Object.freeze([
  'Segoe UI Symbol',
  SYMBOL_STAND_IN_FAMILY,
  'Noto Sans Math',
  'Noto Sans Arabic',
  // Hebrew, and Latin, Greek or Cyrillic letters the faces above lack. A host without Times
  // New Roman resolves its metric-compatible substitute, whose Latin letters share its widths
  // but whose Hebrew runs about 12% wider, so Hebrew in that face can wrap earlier.
  'Times New Roman',
  // Installed East Asian faces first; the portable CJK face is the fallback.
  'SimSun',
  'Batang',
  CJK_FALLBACK_FAMILY,
  // Color first: a COLR face paints its layers. The monochrome face stays behind it for the
  // few symbols the color set leaves out.
  'Twemoji Mozilla',
  'Noto Emoji',
]);

const SYMBOL_GLYPH_FALLBACKS = GLYPH_FALLBACK_FAMILIES.slice(0, 2);
const TEXT_GLYPH_FALLBACKS = GLYPH_FALLBACK_FAMILIES.slice(0, 5);
const EAST_ASIAN_GLYPH_FALLBACKS = GLYPH_FALLBACK_FAMILIES.slice(0, 8);
const EMOJI_GLYPH_FALLBACKS = [...TEXT_GLYPH_FALLBACKS, ...GLYPH_FALLBACK_FAMILIES.slice(8)];

/**
 * The step of {@link GLYPH_FALLBACK_FAMILIES} that emoji presentation loads: the faces before
 * the East Asian ones, then the emoji faces. A host that holds it holds a start of the chain
 * for every character that step carries.
 */
export const EMOJI_GLYPH_FALLBACK_FAMILIES: readonly string[] =
  Object.freeze(EMOJI_GLYPH_FALLBACKS);

/**
 * {@link GLYPH_FALLBACK_FAMILIES} in the steps a host loads them on demand, by the kind of
 * character that is uncovered. Each step holds every earlier face of the list that can carry
 * that kind, so a character takes the same face as with the whole list. The East Asian faces
 * are large: only East Asian text, or a character that nothing else covers, asks for them.
 */
const GLYPH_FALLBACK_STEPS: readonly (readonly [RegExp, readonly (readonly string[])[]])[] = [
  [
    /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Bopomofo}|[\u3000-\u303F\uFF00-\uFFEF]/u,
    [EAST_ASIAN_GLYPH_FALLBACKS, GLYPH_FALLBACK_FAMILIES],
  ],
  // Emoji presentation takes a color face first, whatever the faces before it cover.
  [/\p{Emoji_Presentation}|\uFE0F/u, [EMOJI_GLYPH_FALLBACKS, GLYPH_FALLBACK_FAMILIES]],
  // Letters, marks, digits, and mathematics: the symbol faces do not carry them.
  [
    /[\p{L}\p{M}\p{N}\p{Sm}]/u,
    [TEXT_GLYPH_FALLBACKS, EMOJI_GLYPH_FALLBACKS, GLYPH_FALLBACK_FAMILIES],
  ],
  [
    /[^]/u,
    [SYMBOL_GLYPH_FALLBACKS, TEXT_GLYPH_FALLBACKS, EMOJI_GLYPH_FALLBACKS, GLYPH_FALLBACK_FAMILIES],
  ],
];

/**
 * The glyph fallback families to hold for `characters` that no held face covers: the first
 * step for each character that `asked` does not name in full. A step that was asked for and
 * still leaves the character uncovered gives way to the next. Empty when every family was
 * asked for.
 */
export function glyphFallbackFamiliesFor(
  characters: string,
  asked: (family: string) => boolean
): readonly string[] {
  const wanted = new Set<string>();
  for (const character of new Set(characters)) {
    const steps = GLYPH_FALLBACK_STEPS.find(([kind]) => kind.test(character))?.[1] ?? [];
    const next = steps.find((families) => !families.every(asked));
    for (const family of next ?? []) wanted.add(family);
  }
  return GLYPH_FALLBACK_FAMILIES.filter((family) => wanted.has(family));
}

/** {@link GLYPH_FALLBACK_FAMILIES} as regular upright face requests. */
export const GLYPH_FALLBACK_FACES: readonly FontRequest[] = Object.freeze(
  GLYPH_FALLBACK_FAMILIES.map((family) =>
    Object.freeze({ family, weight: 400, style: 'normal' as const })
  )
);

/** East Asian families that the CJK fallback face stands in for. */
export const CJK_SUBSTITUTED_FAMILIES: readonly string[] = Object.freeze([
  'MS Gothic',
  'MS PGothic',
  'MS UI Gothic',
  'MS Mincho',
  'MS PMincho',
  'Meiryo',
  'Yu Gothic',
  'Yu Mincho',
  'SimSun',
  'NSimSun',
  'SimHei',
  'FangSong',
  'KaiTi',
  'DengXian',
  'Microsoft YaHei',
  'Microsoft JhengHei',
  'MingLiU',
  'PMingLiU',
  'Batang',
  'Gulim',
  'Dotum',
  'Malgun Gothic',
]);

/**
 * Families whose text a fallback face can carry when the family itself is absent.
 *
 * Helvetica is the one metric match here (Arial was drawn to its widths, and Liberation Sans
 * to Arial's). The others are coverage, not metrics.
 * A `Map`, not an object: the key is file-derived.
 */
const NAMED_SUBSTITUTES: ReadonlyMap<string, string> = new Map([
  ['Cambria Math', 'Noto Sans Math'],
  ['Georgia', SERIF_STAND_IN_FAMILY],
  ['Verdana', SANS_STAND_IN_FAMILY],
  ['Helvetica', SANS_STAND_IN_FAMILY],
  ...CJK_SUBSTITUTED_FAMILIES.map((family) => [family, CJK_FALLBACK_FAMILY] as const),
]);

/**
 * The metric-compatible substitute of each common family. A font package substitutes these
 * when the document names them exactly. Named through a style word or a localized name, they
 * resolve here instead.
 */
const METRIC_SUBSTITUTES: ReadonlyMap<string, string> = new Map([
  ['Calibri', 'Carlito'],
  ['Cambria', 'Caladea'],
  ['Times New Roman', SERIF_STAND_IN_FAMILY],
  ['Arial', SANS_STAND_IN_FAMILY],
  ['Courier New', MONO_STAND_IN_FAMILY],
  ['Century Gothic', 'TeX Gyre Adventor'],
  ['Segoe UI', 'Selawik'],
]);

/**
 * The fallback faces a host can carry under their own names: the targets of every rule in
 * this file. A byte reader for these families makes each rule here effective.
 */
export const FALLBACK_FACE_FAMILIES: readonly string[] = Object.freeze([
  SYMBOL_STAND_IN_FAMILY,
  'Noto Sans Math',
  'Noto Sans Arabic',
  'Twemoji Mozilla',
  'Noto Emoji',
  SANS_STAND_IN_FAMILY,
  SERIF_STAND_IN_FAMILY,
  MONO_STAND_IN_FAMILY,
  'Carlito',
  'Caladea',
]);

/**
 * The family a document names, read as a font name table reads it.
 *
 * A converter that writes face names for family names produces `Times New Roman Bold`, and a
 * document saved in a Chinese locale writes `宋体` for SimSun. Both name a face the rules know;
 * neither is a key in their tables. The style words fold into the request's weight and style,
 * and a localized name resolves to the English one. The face is still registered under the
 * name the document wrote, which is the name layout asks for.
 */
export function canonicalFontFamily(family: string): {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
} {
  // No regular expression: the name is file-derived and unbounded, and a lazy prefix against
  // a greedy run of spaces is quadratic in the spaces. A real face name is short; anything
  // much longer than the 31-character family limit of a font name table is left as it is.
  let base = family;
  let bold = false;
  let italic = false;
  if (family.length <= 128) {
    const lower = family.toLowerCase();
    for (const [suffix, flags] of [
      [' bold italic', [true, true]],
      [' bolditalic', [true, true]],
      [' bold', [true, false]],
      [' italic', [false, true]],
    ] as const) {
      if (!lower.endsWith(suffix) || lower.length === suffix.length) continue;
      base = family.slice(0, family.length - suffix.length).trimEnd();
      [bold, italic] = flags;
      break;
    }
  }
  return { family: LOCALIZED_EAST_ASIAN_FAMILIES.get(base) ?? base, bold, italic };
}

/**
 * The fallback family that carries the text of `family` by name, or undefined: a named
 * substitute for the name as written or in its canonical form, or the metric-compatible
 * substitute of a family that the document names through a style word or a localized name.
 */
export function namedSubstituteFamily(family: string): string | undefined {
  const canonical = canonicalFontFamily(family).family;
  const named = NAMED_SUBSTITUTES.get(canonical);
  if (named) return named;
  return canonical !== family ? METRIC_SUBSTITUTES.get(canonical) : undefined;
}

/**
 * Whether the named substitute of `family` has the widths of the family: its metric-compatible
 * substitute, or the one named substitute that is a metric match (Helvetica). Text in such a
 * substitute wraps where the family's own face wraps, so a host need not report it.
 */
export function hasMetricCompatibleSubstitute(family: string): boolean {
  const canonical = canonicalFontFamily(family).family;
  return canonical === 'Helvetica' || METRIC_SUBSTITUTES.has(canonical);
}

/**
 * The fallback face that stands in for a family nothing else resolved.
 *
 * A document that names a font the machine lacks still renders: in a face of the same class.
 * The class is read from the name, which is all a resolver sees: monospaced names to the
 * monospaced face, symbol names to the symbol face, serif names to the serif face, everything
 * else to the sans-serif face. The metrics are not the missing font's.
 *
 * A symbol name must not get a text face: `Segoe UI Symbol` heads the glyph fallback list, and
 * a sans-serif stand-in there would draw every Hebrew letter an Arabic face lacks, before the
 * Times New Roman entry was reached.
 */
export function genericStandInFamily(family: string): string {
  const name = canonicalFontFamily(family).family;
  if (/mono|courier|consol|menlo|typewriter|\bcode\b|fixed/i.test(name))
    return MONO_STAND_IN_FAMILY;
  if (/symbol/i.test(name)) return SYMBOL_STAND_IN_FAMILY;
  if (/sans/i.test(name)) return SANS_STAND_IN_FAMILY;
  if (
    /serif|roman|garamond|georgia|times|book|baskerville|cambria|minion|palatino|century|didot|caslon|constantia|sagona|lora|merriweather|playfair|charter|bodoni|perpetua|rockwell|goudy|bembo|sabon|antiqua/i.test(
      name
    )
  )
    return SERIF_STAND_IN_FAMILY;
  return SANS_STAND_IN_FAMILY;
}

/**
 * The line box of a missing family whose stand-in has another one, as em ratios of the font
 * size. Symbols that the text faces lack draw in Segoe UI Symbol, at the head of the glyph
 * fallback list: its line is 1.33 em, where the symbol stand-in is 1.7 em. A missing ballot
 * box would otherwise make its line a third taller.
 * A `Map`, not an object: the key is file-derived.
 */
const STAND_IN_LINE_BOXES: ReadonlyMap<string, FallbackLineBox> = new Map([
  // hhea ascender 2210 and descender 514 of a 2048-unit em, no line gap.
  ['Segoe UI Symbol', { heightEm: 2724 / 2048, baselineEm: 2210 / 2048 }],
  // hhea ascender 1765 and descender 539, no line gap: the box the measurers record for the
  // family in `authored-line-boxes.ts`, so every renderer breaks lines alike.
  ['Garamond', { heightEm: 2304 / 2048, baselineEm: 1765 / 2048 }],
]);

/**
 * The line box of any other missing symbol family that the symbol stand-in draws: the box of
 * the Symbol face, hhea ascender 2059 and descender 450 of a 2048-unit em, no line gap. The
 * missing face's own metrics are unknown, and the stand-in's 1.7 em line would make every
 * line with one `w:sym` character from such a family (`CT_Sym`, ECMA-376 Part 1, 17.3.3.30) a
 * third taller.
 */
const SYMBOL_STAND_IN_LINE_BOX: FallbackLineBox = Object.freeze({
  heightEm: 2509 / 2048,
  baselineEm: 2059 / 2048,
});

/**
 * The line box that a stand-in keeps for the missing family `canonical` (see
 * {@link canonicalFontFamily}) drawn in `target`, or undefined when the box of the face that
 * draws it applies.
 */
export function standInLineBox(canonical: string, target: string): FallbackLineBox | undefined {
  return (
    STAND_IN_LINE_BOXES.get(canonical) ??
    (target === SYMBOL_STAND_IN_FAMILY ? SYMBOL_STAND_IN_LINE_BOX : undefined)
  );
}

/**
 * The families the generic stand-in must not touch: the ones the other rules answer for by
 * name, and the legacy symbol-encoded faces. A run in a symbol-encoded face draws private-use
 * code points that only those faces carry; a text face standing in has no glyph for them,
 * where the glyph fallback path maps them to their Unicode twins in a symbol face.
 */
const RULED_FAMILIES: ReadonlySet<string> = new Set([
  ...FALLBACK_FACE_FAMILIES,
  CJK_FALLBACK_FAMILY,
  ...NAMED_SUBSTITUTES.keys(),
  ...METRIC_SUBSTITUTES.keys(),
  ...METRIC_SUBSTITUTES.values(),
  'Symbol',
  'Wingdings',
  'Wingdings 2',
  'Wingdings 3',
  'Webdings',
  'MT Extra',
]);

/** The CJK fallback face and the families planned onto it. A document can name either. */
const CJK_RULED_FAMILIES: ReadonlySet<string> = new Set([
  CJK_FALLBACK_FAMILY,
  ...CJK_SUBSTITUTED_FAMILIES,
]);

/** Whether another rule answers for the canonical family, so the generic stand-in must not. */
export function isRuledFontFamily(canonical: string): boolean {
  return RULED_FAMILIES.has(canonical);
}

/** Whether the canonical family is the CJK fallback face or a family planned onto it. */
export function isCjkRuledFontFamily(canonical: string): boolean {
  return CJK_RULED_FAMILIES.has(canonical);
}

/**
 * Whether `family` resolved through the generic stand-in rather than a metric-compatible
 * plan: a substitution whose family no rule answers for, or a CJK family in its stand-in
 * rather than the CJK face. A renderer reports these, since the page carries the text in
 * another font's metrics.
 */
export function isGenericStandIn(family: string, sourceFamily: string): boolean {
  if (family === sourceFamily) return false;
  const canonical = canonicalFontFamily(family).family;
  if (isCjkRuledFontFamily(canonical)) return sourceFamily === genericStandInFamily(family);
  return !isRuledFontFamily(canonical);
}
