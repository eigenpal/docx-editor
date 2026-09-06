import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { themeFontFamilyOf } from '../store/package/theme-font-scheme.ts';
import type { ThemeFonts } from './run-style.ts';

/** Last specified hint wins across the already-cascaded run properties. */
export function hasEastAsiaSymbolHint(properties: readonly OoxmlProperty[]): boolean {
  let hint: string | undefined;
  let cs = false;
  let rtl = false;
  for (const property of properties) {
    if (property.localName === 'rFonts' && property.attributes?.hint !== undefined) {
      hint = property.attributes.hint;
    } else if (property.localName === 'cs' || property.localName === 'rtl') {
      const enabled = !['0', 'false', 'off'].includes(property.attributes?.val ?? '1');
      if (property.localName === 'cs') cs = enabled;
      else rtl = enabled;
    }
  }
  return hint === 'eastAsia' && !cs && !rtl;
}

/** One Latin face slot as authored: a theme token or an explicit name, last specified wins. */
interface LatinFace {
  readonly value: string;
  readonly theme: boolean;
}

/** The resolved family for comparison, or null when a theme token cannot be resolved. */
function comparableFace(face: LatinFace, themeFonts: ThemeFonts | undefined): string | null {
  if (!face.theme) return face.value.toLowerCase();
  const resolved = themeFonts ? themeFontFamilyOf(face.value, themeFonts) : null;
  return resolved?.toLowerCase() ?? null;
}

/** `minorAscii` and `minorHAnsi` (and the major pair) name one theme face by two tokens. */
function sameThemeToken(a: string, b: string): boolean {
  const canonical = (token: string) => token.replace(/Ascii$/, 'HAnsi').toLowerCase();
  return canonical(a) === canonical(b);
}

/**
 * MS-OI29500 2.1.88: Word ignores `hint="eastAsia"` when the East Asian face is Times New
 * Roman AND the ascii and hAnsi faces are the same.
 *
 * `eastAsiaFace` is the run's RESOLVED East Asian face, so a theme slot that resolves to
 * Times New Roman counts. The Latin faces are read from the same cascaded properties as
 * {@link hasEastAsiaSymbolHint}, last specified value per attribute winning (§17.3.2.26),
 * and compared as resolved faces through `themeFonts`, the way Word compares them. When a
 * theme token cannot be resolved against an explicit name, or a face is left unspecified,
 * the comparison falls back to the exception (hint ignored), which is the conservative
 * pre-widening behavior.
 */
export function hasTimesNewRomanEastAsiaException(
  properties: readonly OoxmlProperty[],
  eastAsiaFace: string | null,
  themeFonts?: ThemeFonts
): boolean {
  if (eastAsiaFace?.toLowerCase() !== 'times new roman') return false;
  let ascii: LatinFace | undefined;
  let hAnsi: LatinFace | undefined;
  for (const property of properties) {
    if (property.localName !== 'rFonts') continue;
    const attributes = property.attributes;
    if (attributes?.asciiTheme !== undefined) ascii = { value: attributes.asciiTheme, theme: true };
    else if (attributes?.ascii !== undefined) ascii = { value: attributes.ascii, theme: false };
    if (attributes?.hAnsiTheme !== undefined) hAnsi = { value: attributes.hAnsiTheme, theme: true };
    else if (attributes?.hAnsi !== undefined) hAnsi = { value: attributes.hAnsi, theme: false };
  }
  if (ascii === undefined || hAnsi === undefined) return true;
  if (ascii.theme && hAnsi.theme && sameThemeToken(ascii.value, hAnsi.value)) return true;
  const asciiFace = comparableFace(ascii, themeFonts);
  const hAnsiFace = comparableFace(hAnsi, themeFonts);
  // A token nothing resolves cannot be compared with anything; keep the exception.
  if (asciiFace === null || hAnsiFace === null) return true;
  return asciiFace === hAnsiFace;
}

/**
 * MS-OI29500 2.1.88: the code points that resolve through the East Asian face
 * unconditionally under `hint="eastAsia"`.
 *
 * Latin-1 keeps only the symbol exceptions; ASCII and the language/charset-dependent
 * accented letters are deliberately excluded, and so are Greek and Cyrillic. The CJK
 * radicals at U+2E80-U+2EFF are in the same table but already classify as strong East
 * Asian text without a hint, so they are not repeated here.
 *
 * Two parts of the table are left out on purpose. Combining marks and format characters
 * (U+0300-U+036F, U+200B-U+200F, U+2028-U+202F, U+2060-U+206F, U+20D0-U+20FF) must stay in
 * the font of the base character they attach to: slicing them into their own span splits a
 * grapheme cluster across two faces. The Private Use Area (U+E000-U+F8FF) is where symbol
 * fonts (Wingdings, Symbol) keep their glyphs, and those runs are already routed by
 * `symbol-run.ts`; sending them to the East Asian face paints notdef boxes.
 */
export function isEastAsiaHintSymbol(codePoint: number): boolean {
  return (
    codePoint === 0xa1 ||
    codePoint === 0xa4 ||
    (codePoint >= 0xa7 && codePoint <= 0xa8) ||
    codePoint === 0xaa ||
    codePoint === 0xad ||
    codePoint === 0xaf ||
    (codePoint >= 0xb0 && codePoint <= 0xb4) ||
    (codePoint >= 0xb6 && codePoint <= 0xba) ||
    (codePoint >= 0xbc && codePoint <= 0xbf) ||
    codePoint === 0xd7 ||
    codePoint === 0xf7 ||
    // Spacing modifier letters (not the combining marks that follow them).
    (codePoint >= 0x2b0 && codePoint <= 0x2ff) ||
    // General punctuation through Dingbats, minus format characters and combining marks:
    // quotes, dashes, arrows, enclosed alphanumerics, box drawing, geometric shapes.
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    (codePoint >= 0x2010 && codePoint <= 0x2027) ||
    (codePoint >= 0x2030 && codePoint <= 0x205f) ||
    (codePoint >= 0x2070 && codePoint <= 0x20cf) ||
    (codePoint >= 0x2100 && codePoint <= 0x27bf) ||
    // Alphabetic presentation forms up to, not including, the Hebrew ligatures.
    (codePoint >= 0xfb00 && codePoint <= 0xfb1c)
  );
}
