// The `w:rFonts` theme-token table, shared by every lane that resolves one.
//
// ECMA-376 §17.18.96 (ST_Theme) names eight tokens; each is a (major|minor) × (ascii|
// hAnsi|eastAsia|bidi) pair pointing into the theme part's font scheme. The layout lane
// (`layout/run-style.ts`) and the binding lane (`binding/document-run-defaults.ts`,
// `binding/document-catalog.ts`) each resolve these tokens, and until this module they
// each kept a private copy of the mapping — copies that drifted the moment one lane
// learned the `a:ea` faces. Lives beside `theme-color-resolution.ts` for the same reason
// that table does: theme resolution is package material both lanes may read.

/**
 * The faces a theme's font scheme offers, per script slot.
 *
 * Structurally satisfied by both lanes' theme-font shapes (`DocumentThemeFonts`,
 * layout's `ThemeFonts`). The East Asian faces are optional so callers that have not
 * harvested them yet still type-check; an absent face resolves to null, which every
 * caller already treats as "fall back to the explicit attribute".
 */
export interface ThemeSchemeFaces {
  /** `a:majorFont` latin typeface — headings. */
  readonly major: string | null;
  /** `a:minorFont` latin typeface — body text. */
  readonly minor: string | null;
  /** `a:majorFont` east asian typeface (`a:ea`). */
  readonly majorEastAsia?: string | null;
  /** `a:minorFont` east asian typeface (`a:ea`). */
  readonly minorEastAsia?: string | null;
}

// A Map, not an object literal: the token is file content, and `__proto__` must answer
// undefined — the same rule `theme-color-resolution.ts` applies to its tables.
const TOKEN_FACE: ReadonlyMap<string, (faces: ThemeSchemeFaces) => string | null> = new Map([
  ['minorAscii', (faces: ThemeSchemeFaces) => faces.minor],
  ['minorHAnsi', (faces: ThemeSchemeFaces) => faces.minor],
  ['majorAscii', (faces: ThemeSchemeFaces) => faces.major],
  ['majorHAnsi', (faces: ThemeSchemeFaces) => faces.major],
  // The East Asian tokens are legal on the LATIN theme attributes too: Word's "use East
  // Asian fonts also on Latin text" writes `w:asciiTheme="minorEastAsia"`, and both
  // scripts then paint in the East Asian face. The token decides the face; which
  // attribute carried it does not.
  ['minorEastAsia', (faces: ThemeSchemeFaces) => faces.minorEastAsia ?? null],
  ['majorEastAsia', (faces: ThemeSchemeFaces) => faces.majorEastAsia ?? null],
  // `minorBidi`/`majorBidi` name the `a:cs` face no lane harvests yet; an honest null —
  // which falls back to the explicit attribute beside the token — beats the wrong font.
]);

/** A `w:rFonts` theme token resolved to its theme face, or null when it names none we hold. */
export function themeFontFamilyOf(
  token: string | undefined,
  faces: ThemeSchemeFaces
): string | null {
  if (token === undefined) return null;
  return TOKEN_FACE.get(token)?.(faces) ?? null;
}
