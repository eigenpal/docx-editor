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
 * MS-OI29500 2.1.88: the unconditional Latin-1 symbol exceptions for hint=eastAsia.
 * ASCII and language/charset-dependent accented letters are deliberately excluded.
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
    codePoint === 0xf7
  );
}
