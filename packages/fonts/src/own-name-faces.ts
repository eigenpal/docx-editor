// The packaged faces under their OWN family names.
//
// A document, or the engine's fallback rules, can name a packaged face directly: `Liberation
// Serif` as the stand-in for a missing serif family, `Noto Sans Symbols 2` for a symbol that
// the run's face lacks. The plans in `family-plans.ts` are keyed by the family a face
// substitutes for, so they do not answer for these names. This table does.
//
// The symbol, mathematics, Arabic, and emoji faces substitute for no family: they are the
// glyph fallback faces of the engine, and this is the only table that names them.

import { FACES, FAMILY_PLANS, planFaceFile } from './family-plans.ts';
import type { DefaultFontFamily } from './family-plans.ts';

/** One packaged face file, with the weight and style it holds. */
export interface OwnNameFace {
  readonly file: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/** One family this package serves under its own name. */
export interface OwnNameFamily {
  /** The family name, in its canonical spelling. */
  readonly family: string;
  readonly faces: readonly OwnNameFace[];
  /** The family this face substitutes for, when it is a metric-compatible substitute. */
  readonly substituteFor?: DefaultFontFamily;
}

/**
 * The glyph fallback faces: one regular face each. The engine draws a character that the run's
 * own face lacks in the first of its fallback families that covers it.
 */
export const GLYPH_FALLBACK_FACE_FAMILIES: readonly string[] = Object.freeze([
  'Noto Sans Symbols 2',
  'Noto Sans Math',
  'Noto Sans Arabic',
  'Twemoji Mozilla',
  'Noto Emoji',
]);

const FALLBACK_FACE_FILES: Readonly<Record<string, string>> = {
  'Noto Sans Symbols 2': 'NotoSansSymbols2-Regular.ttf',
  'Noto Sans Math': 'NotoSansMath-Regular.ttf',
  'Noto Sans Arabic': 'NotoSansArabic-Regular.ttf',
  'Twemoji Mozilla': 'TwemojiMozilla.ttf',
  'Noto Emoji': 'NotoEmoji-Regular.ttf',
};

const substitutes: OwnNameFamily[] = [...FAMILY_PLANS].map(([family, plan]) => ({
  family: plan.substitute,
  substituteFor: family,
  faces: FACES.filter((face) => !(plan.uprightOnly && face.style === 'italic')).map((face) => ({
    file: planFaceFile(plan, face.suffix),
    weight: face.weight,
    style: face.style,
  })),
}));

const fallbacks: OwnNameFamily[] = GLYPH_FALLBACK_FACE_FAMILIES.map((family) => ({
  family,
  faces: [{ file: FALLBACK_FACE_FILES[family]!, weight: 400, style: 'normal' as const }],
}));

/** Every family served under its own name, by case-folded name. A `Map`: the key is file-derived. */
export const OWN_NAME_FAMILIES: ReadonlyMap<string, OwnNameFamily> = new Map(
  [...substitutes, ...fallbacks].map((entry) => [entry.family.toLowerCase(), entry] as const)
);

/**
 * The faces of `entry` to load for the faces a request names: the exact face when the family
 * has it, or its nearest face (same style first, then the regular face), which the renderer
 * emboldens or slants. With no faces named, every face.
 */
export function ownNameFacesFor(
  entry: OwnNameFamily,
  wanted: readonly { readonly weight: number; readonly style: 'normal' | 'italic' }[] | undefined
): readonly OwnNameFace[] {
  if (!wanted) return entry.faces;
  const picked = new Set<OwnNameFace>();
  for (const want of wanted) {
    const weight = want.weight >= 600 ? 700 : 400;
    const face =
      entry.faces.find((one) => one.weight === weight && one.style === want.style) ??
      entry.faces.find((one) => one.weight === weight && one.style === 'normal') ??
      entry.faces.find((one) => one.style === want.style) ??
      entry.faces[0];
    if (face) picked.add(face);
  }
  return entry.faces.filter((face) => picked.has(face));
}
