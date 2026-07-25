// Legacy React compatibility layer (GOAL-legacy-react-port.md).
//
// Adapter controls consume compatibility types and helpers through this boundary.
// paths (`@docx-editor.dev/core/types/document`, `/utils/fontOptions`, …), which do not
// exist in the greenfield package. Rather than rewrite the controls — the whole point of
// the port is that they are copied verbatim — this module supplies exactly the symbols
// they name, so only their IMPORT PATHS change.
// Shared adapter presentation and compatibility behavior.
// need engine data are honest stubs: they return the empty answer and say what deriving
// them requires. A stub must never guess.
//
// This module is temporary. Each symbol moves to the engine as the corresponding
// capability lands; nothing here should acquire behavior of its own.

export type NumberFormat =
  | 'decimal'
  | 'upperRoman'
  | 'lowerRoman'
  | 'upperLetter'
  | 'lowerLetter'
  | 'ordinal'
  | 'cardinalText'
  | 'ordinalText'
  | 'hex'
  | 'chicago'
  | 'ideographDigital'
  | 'japaneseCounting'
  | 'aiueo'
  | 'iroha'
  | 'decimalFullWidth'
  | 'decimalHalfWidth'
  | 'japaneseLegal'
  | 'japaneseDigitalTenThousand'
  | 'decimalEnclosedCircle'
  | 'decimalFullWidth2'
  | 'aiueoFullWidth'
  | 'irohaFullWidth'
  | 'decimalZero'
  // Synthetic in-memory formats for Word's `w:numFmt w:val="custom"` with an
  // XSLT-style zero-padded format string ("001, 002, ...", "0001, ...",
  // "00001, ..."). Not OOXML enum values — never serialized (numbering.xml is
  // preserved as-is on save); they exist so the render pipeline can carry the
  // pad width through the existing NumberFormat plumbing.
  | 'decimalZero3'
  | 'decimalZero4'
  | 'decimalZero5'
  | 'bullet'
  | 'ganada'
  | 'chosung'
  | 'decimalEnclosedFullstop'
  | 'decimalEnclosedParen'
  | 'decimalEnclosedCircleChinese'
  | 'ideographEnclosedCircle'
  | 'ideographTraditional'
  | 'ideographZodiac'
  | 'ideographZodiacTraditional'
  | 'taiwaneseCounting'
  | 'ideographLegalTraditional'
  | 'taiwaneseCountingThousand'
  | 'taiwaneseDigital'
  | 'chineseCounting'
  | 'chineseLegalSimplified'
  | 'chineseCountingThousand'
  | 'koreanDigital'
  | 'koreanCounting'
  | 'koreanLegal'
  | 'koreanDigital2'
  | 'vietnameseCounting'
  | 'russianLower'
  | 'russianUpper'
  | 'none'
  | 'numberInDash'
  | 'hebrew1'
  | 'hebrew2'
  | 'arabicAlpha'
  | 'arabicAbjad'
  | 'hindiVowels'
  | 'hindiConsonants'
  | 'hindiNumbers'
  | 'hindiCounting'
  | 'thaiLetters'
  | 'thaiNumbers'
  | 'thaiCounting';

export type ParagraphAlignment =
  | 'left'
  | 'center'
  | 'right'
  | 'both'
  | 'distribute'
  | 'mediumKashida'
  | 'highKashida'
  | 'lowKashida'
  | 'thaiDistribute';

export interface FontOption {
  name: string;
  fontFamily: string;
  category?: 'sans-serif' | 'serif' | 'monospace' | 'other';
}
/** Compatibility contract for the shared adapter surface. */
export type StyleType = 'paragraph' | 'character' | 'numbering' | 'table';

/** Minimal shapes the ported controls read. Widened as real engine types land. */
export interface Style {
  styleId: string;
  name?: string;
  type?: StyleType;
  basedOn?: string;
  [key: string]: unknown;
}
export interface Theme {
  [key: string]: unknown;
}
export interface ThemeColorScheme {
  [key: string]: unknown;
}
/** Compatibility contract for the shared adapter surface. */
export type ThemeColorSlot = string;
export interface ThemeMatrixCell {
  /** Resolved hex color (6 chars, no #) */
  hex: string;
  /** Theme color slot */
  themeSlot: ThemeColorSlot;
  /** Tint hex modifier if applicable (e.g., "CC") */
  tint?: string;
  /** Shade hex modifier if applicable (e.g., "BF") */
  shade?: string;
  /** Human-readable label (e.g., "Accent 1, Lighter 60%") */
  label: string;
}
/** The legacy core allows a bare hex string or a themed reference. */
export type ColorValue = string | { rgb: string };

/** Compatibility contract for the shared adapter surface. */
export type ListType = 'none' | 'bullet' | 'ordered';
export interface ListState {
  type: ListType;
  level: number;
  isInList: boolean;
  numId?: number;
}

/**
 * STUB. The legacy helper filtered a font list against names the document cannot use.
 * The engine exposes no font inventory yet (`Editor` has no font query), so this returns
 * the input unchanged rather than silently dropping fonts a user asked for.
 */
export function excludeFontsByName<T extends { name: string }>(
  fonts: readonly T[],
  _exclude?: readonly string[],
): T[] {
  return [...fonts];
}

// --- Helpers the ported controls call -------------------------------------------------
// Shared adapter presentation and compatibility behavior.
// not have yet is a stub returning the empty answer, per the port goal.

/** Copied verbatim from the legacy core. */
export function halfPointsToPoints(halfPoints: number): number {
  return halfPoints / 2;
}

/** STUB — the engine exposes no theme colour scheme yet, so the picker shows its
 *  standard palette and no theme row, rather than a fabricated one. */
export function generateThemeTintShadeMatrix(_scheme?: ThemeColorScheme | null): ThemeMatrixCell[][] {
  return [];
}

/** STUB — no style preview data on the engine yet; the picker falls back to plain text. */
export function getStylePreviewProps(_style?: Style | null): Record<string, unknown> {
  return {};
}

// List state. The engine exposes no list state, so every predicate answers "not a list"
// and the constructors produce inert values. The list buttons therefore render inactive
// instead of claiming a list the document may not have.
export const createDefaultListState = (): ListState => ({ type: 'none', level: 0, isInList: false });
export const createBulletListState = (): ListState => ({ type: 'bullet', level: 0, isInList: true });
export const createNumberedListState = (): ListState => ({ type: 'ordered', level: 0, isInList: true });
export const isAnyListState = (s?: ListState | null): boolean => !!s?.isInList;
export const isBulletListState = (s?: ListState | null): boolean => s?.type === 'bullet';
export const isNumberedListState = (s?: ListState | null): boolean => s?.type === 'ordered';

/** STUB — no colour resolution against the document theme yet; a bare hex passes
 *  through and a themed reference yields its rgb, never a guessed theme colour. */
export function resolveColor(value?: ColorValue | null): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.rgb;
}

/** Re-exported so ported controls can name it where legacy imported it from i18n. */
export type TranslationKey = string;
export const getNextIndentLevel = (level?: number): number => Math.min((level ?? 0) + 1, 8);
export const getPreviousIndentLevel = (level?: number): number => Math.max((level ?? 0) - 1, 0);

/** Compatibility contract for the shared adapter surface. */
export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

/** STUB — the engine exposes no highlight palette resolution; the raw value passes
 *  through so a document colour is never replaced by a guessed one. */
export function resolveHighlightColor(value?: string | null): string | undefined {
  return value ?? undefined;
}

/** STUB — alias of `resolveColor` under the name the legacy pickers import. */
export function resolveColorToHex(value?: ColorValue | null): string | undefined {
  return resolveColor(value);
}

/** STUB — no document style inventory on the engine yet, so the style picker shows
 *  whatever the caller passes and nothing is synthesized. */
export function resolveParagraphStyleOptions(styles?: readonly Style[] | null): Style[] {
  return styles ? [...styles] : [];
}

/** Copied shape from the legacy core: cycles a list type without engine state. */
export function toggleListType(state: ListState, type: ListType): ListState {
  return state.type === type
    ? { ...state, type: 'none', isInList: false }
    : { ...state, type, isInList: true };
}
