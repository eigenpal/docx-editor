// Whether the document defaults name an East Asian font, decided by the face that draws it.
//
// Punctuation compression, hanging punctuation, kana compression, and the legacy space rule
// need the East Asian font of the document defaults to be a Chinese, Japanese, or Korean face.
// When a face draws as that family, the face decides: it is one when it lists the CJK code
// pages, whatever its name and whatever the font table says (a Latin face with an East Asian
// `w:charset` is not one; a CJK face on no name list is). When no face draws as the family,
// the name lists and the font table's `w:charset` decide, as the style cascade already did.
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from './run-style.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** Derived tables per source table and answer, so a stable answer keeps one identity. */
const measuredTables = new WeakMap<StyleCascadeTable, Map<boolean, StyleCascadeTable>>();
/** One query style per face name, so the measurer's per-style font cache serves it. */
const faceStyles = new Map<string, ResolvedRunStyle>();
const MAX_FACE_STYLES = 64;

function faceStyle(face: string): ResolvedRunStyle {
  let style = faceStyles.get(face);
  if (!style) {
    if (faceStyles.size >= MAX_FACE_STYLES) faceStyles.clear();
    style = Object.freeze({ ...DEFAULT_RUN_STYLE, fontFamily: face });
    faceStyles.set(face, style);
  }
  return style;
}

/**
 * The style cascade with `typography.sourceEastAsianFont` decided by the face `measurer`
 * resolves for the defaults' East Asian font. The table itself when the measurer cannot tell
 * or agrees with the cascade's own answer; otherwise a table with its own cache token, the same
 * object for as long as the answer holds.
 */
export function withMeasuredEastAsianDefaults(
  table: StyleCascadeTable | undefined,
  measurer: TextMeasurer | undefined
): StyleCascadeTable | undefined {
  const typography = table?.typography;
  const face = typography?.eastAsianDefaultFace;
  if (!table || !typography || face === undefined || !measurer?.eastAsianFace) return table;
  const measured = measurer.eastAsianFace(faceStyle(face));
  if (measured === undefined || measured === (typography.sourceEastAsianFont === true))
    return table;
  let byAnswer = measuredTables.get(table);
  if (!byAnswer) measuredTables.set(table, (byAnswer = new Map()));
  let derived = byAnswer.get(measured);
  if (!derived) {
    derived = Object.freeze({
      ...table,
      cacheToken: `${table.cacheToken}|eastAsianFace:${measured ? 1 : 0}`,
      typography: Object.freeze({ ...typography, sourceEastAsianFont: measured }),
    });
    byAnswer.set(measured, derived);
  }
  return derived;
}
