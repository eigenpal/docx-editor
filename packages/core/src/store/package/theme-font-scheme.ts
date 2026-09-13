// The `w:rFonts` theme-token table, shared by every lane that resolves one.
//
// ECMA-376 §17.18.96 (ST_Theme) names eight tokens; each is a (major|minor) × (ascii|
// hAnsi|eastAsia|bidi) pair pointing into the theme part's font scheme. The layout lane
// (`layout/run-style.ts`) and the binding lane (`binding/document-run-defaults.ts`,
// `binding/document-catalog.ts`) each resolve these tokens, and until this module they
// each kept a private copy of the mapping — copies that drifted the moment one lane
// learned the `a:ea` faces. Lives beside `theme-color-resolution.ts` for the same reason
// that table does: theme resolution is package material both lanes may read.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

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
  /** Language-specific theme faces, keyed by ISO 15924 script. */
  readonly majorSupplemental?: Readonly<Record<string, string>>;
  readonly minorSupplemental?: Readonly<Record<string, string>>;
}

/** The theme's font slots, fully resolved, for resolving `w:rFonts` theme attributes. */
export interface DocumentThemeFonts extends ThemeSchemeFaces {
  /** `a:majorFont` latin typeface — headings. */
  readonly major: string | null;
  /** `a:minorFont` latin typeface — body text. */
  readonly minor: string | null;
  /** `a:majorFont` east asian typeface (`a:ea`) — headings. */
  readonly majorEastAsia: string | null;
  /** `a:minorFont` east asian typeface (`a:ea`) — body text. */
  readonly minorEastAsia: string | null;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function child(parent: OoxmlElement, localName: string): OoxmlElement | null {
  for (const candidate of parent.children) {
    if (isElement(candidate) && candidate.localName === localName) return candidate;
  }
  return null;
}

function firstDescendant(root: OoxmlElement, localName: string): OoxmlElement | null {
  const stack: OoxmlNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!isElement(current)) continue;
    if (current.localName === localName) return current;
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      stack.push(current.children[index]!);
    }
  }
  return null;
}

const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

function schemeTypeface(
  scheme: OoxmlElement,
  slot: 'majorFont' | 'minorFont',
  face: 'latin' | 'ea'
): string | null {
  const font = child(scheme, slot);
  const element = font ? child(font, face) : null;
  const raw = element?.attributes.find((attribute) => attribute.localName === 'typeface')?.value;
  return raw !== undefined && FONT_NAME.test(raw) ? raw : null;
}

// Canonical trees are immutable. Keep script maps stable when a body edit changes
// the package identity without changing its theme part.
const schemeFacesMemo = new WeakMap<OoxmlElement, DocumentThemeFonts>();

/** Collect every font face consumed by live and headless layout from one canonical theme tree. */
function collectRawThemeSchemeFaces(themeRoot: OoxmlElement | null): DocumentThemeFonts {
  const cached = themeRoot ? schemeFacesMemo.get(themeRoot) : undefined;
  if (cached) return cached;
  const scheme = themeRoot ? firstDescendant(themeRoot, 'fontScheme') : null;
  if (!scheme) {
    return EMPTY_THEME_FACES;
  }
  const faces = Object.freeze({
    major: schemeTypeface(scheme, 'majorFont', 'latin'),
    minor: schemeTypeface(scheme, 'minorFont', 'latin'),
    majorEastAsia: schemeTypeface(scheme, 'majorFont', 'ea'),
    minorEastAsia: schemeTypeface(scheme, 'minorFont', 'ea'),
    ...supplementalFaces(scheme),
  });
  if (themeRoot) schemeFacesMemo.set(themeRoot, faces);
  return faces;
}

// Settings and theme roots are immutable. Body edits reuse this resolved answer.
const languageFacesMemo = new WeakMap<
  OoxmlElement,
  WeakMap<DocumentThemeFonts, DocumentThemeFonts>
>();
const EMPTY_THEME_FACES: DocumentThemeFonts = Object.freeze({
  major: null,
  minor: null,
  majorEastAsia: null,
  minorEastAsia: null,
});

/** Resolve document theme languages before run-language fallback is considered. */
export function collectThemeSchemeFaces(
  themeRoot: OoxmlElement | null,
  settingsRoot: OoxmlElement | null = null
): DocumentThemeFonts {
  const faces = themeRoot ? collectRawThemeSchemeFaces(themeRoot) : EMPTY_THEME_FACES;
  const language =
    settingsRoot &&
    child(settingsRoot, 'themeFontLang')?.attributes.find(
      (attribute) => attribute.localName === 'eastAsia'
    )?.value;
  if (language == null || !settingsRoot) return faces;
  let byTheme = languageFacesMemo.get(settingsRoot);
  if (!byTheme) languageFacesMemo.set(settingsRoot, (byTheme = new WeakMap()));
  const cached = byTheme.get(faces);
  if (cached) return cached;
  const script = eastAsianScript(language);
  // themeFontLang selects the supplemental face for the entire document. Do not
  // let a run's proofing language select a different supplemental face afterward.
  const resolved = Object.freeze({
    major: faces.major,
    minor: faces.minor,
    majorEastAsia: (script && faces.majorSupplemental?.[script]) || faces.majorEastAsia,
    minorEastAsia: (script && faces.minorSupplemental?.[script]) || faces.minorEastAsia,
  });
  byTheme.set(faces, resolved);
  return resolved;
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
  faces: ThemeSchemeFaces,
  eastAsiaLanguage?: string
): string | null {
  if (token === undefined) return null;
  const face = TOKEN_FACE.get(token)?.(faces) ?? null;
  if (face !== null) return face;
  const script = eastAsianScript(eastAsiaLanguage);
  if (!script) return null;
  const supplemental =
    token === 'majorEastAsia'
      ? faces.majorSupplemental
      : token === 'minorEastAsia'
        ? faces.minorSupplemental
        : undefined;
  return supplemental?.[script] ?? null;
}

/** Only CJK scripts participate in the East Asian slot. Explicit script beats region. */
export function eastAsianScript(language: string | undefined): string | null {
  if (!language || language.length > 85) return null;
  const parts = language.toLowerCase().split('-');
  if (parts[0] === 'ja') return 'Jpan';
  if (parts[0] === 'ko') return 'Hang';
  if (parts[0] !== 'zh') return null;
  if (parts.includes('hant')) return 'Hant';
  if (parts.includes('hans')) return 'Hans';
  return parts.some((part) => ['tw', 'hk', 'mo'].includes(part)) ? 'Hant' : 'Hans';
}

const EAST_ASIAN_DEFAULTS = new Map([
  ['Hans', 'SimSun'],
  ['Hant', 'PMingLiU'],
  ['Jpan', 'MS Mincho'],
  ['Hang', 'Batang'],
]);

/** Last-resort named CJK face; an unavailable face takes the CJK-aware measurer fallback. */
export function eastAsianDefaultFamily(language: string | undefined): string | null {
  return EAST_ASIAN_DEFAULTS.get(eastAsianScript(language) ?? '') ?? null;
}

function supplementalFaces(scheme: OoxmlElement): Partial<ThemeSchemeFaces> {
  const result: {
    majorSupplemental?: Record<string, string>;
    minorSupplemental?: Record<string, string>;
  } = {};
  for (const [slot, key] of [
    ['majorFont', 'majorSupplemental'],
    ['minorFont', 'minorSupplemental'],
  ] as const) {
    const faces: Record<string, string> = Object.create(null);
    for (const node of child(scheme, slot)?.children ?? []) {
      if (!isElement(node) || node.localName !== 'font') continue;
      const script = node.attributes.find((a) => a.localName === 'script')?.value;
      const face = node.attributes.find((a) => a.localName === 'typeface')?.value;
      if (script && EAST_ASIAN_DEFAULTS.has(script) && face && FONT_NAME.test(face))
        faces[script] = face;
    }
    if (Object.keys(faces).length) result[key] = Object.freeze(faces);
  }
  return result;
}
