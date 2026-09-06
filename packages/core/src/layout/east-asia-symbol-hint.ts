import type { OoxmlProperty } from '@docx-editor.dev/core/store';

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

/**
 * MS-OI29500 2.1.88: Word ignores `hint="eastAsia"` when the East Asian face is Times New
 * Roman AND the ascii and hAnsi faces are the same.
 *
 * `eastAsiaFace` is the run's RESOLVED East Asian face, so a theme slot that resolves to
 * Times New Roman counts. The Latin faces are read from the same cascaded properties as
 * {@link hasEastAsiaSymbolHint}, last specified value per attribute winning, with a theme
 * attribute standing in for the explicit name beside it (§17.3.2.26).
 */
export function hasTimesNewRomanEastAsiaException(
  properties: readonly OoxmlProperty[],
  eastAsiaFace: string | null
): boolean {
  if (eastAsiaFace?.toLowerCase() !== 'times new roman') return false;
  let ascii: string | undefined;
  let hAnsi: string | undefined;
  for (const property of properties) {
    if (property.localName !== 'rFonts') continue;
    const attributes = property.attributes;
    const nextAscii = attributes?.asciiTheme ?? attributes?.ascii;
    const nextHAnsi = attributes?.hAnsiTheme ?? attributes?.hAnsi;
    if (nextAscii !== undefined) ascii = nextAscii;
    if (nextHAnsi !== undefined) hAnsi = nextHAnsi;
  }
  return ascii === hAnsi;
}

/**
 * MS-OI29500 2.1.88: the code points that resolve through the East Asian face
 * unconditionally under `hint="eastAsia"`.
 *
 * Latin-1 keeps only the symbol exceptions; ASCII and the language/charset-dependent
 * accented letters are deliberately excluded, and so are Greek and Cyrillic. The CJK
 * radicals at U+2E80-U+2EFF are in the same table but already classify as strong East
 * Asian text without a hint, so they are not repeated here.
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
    // Spacing modifier letters and combining diacritical marks.
    (codePoint >= 0x2b0 && codePoint <= 0x36f) ||
    // General punctuation through Dingbats: quotes, dashes, arrows, enclosed alphanumerics.
    (codePoint >= 0x2000 && codePoint <= 0x27bf) ||
    // Private use area.
    (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
    // Alphabetic presentation forms up to, not including, the Hebrew ligatures.
    (codePoint >= 0xfb00 && codePoint <= 0xfb1c)
  );
}
