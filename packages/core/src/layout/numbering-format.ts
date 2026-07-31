// Number formatters and `w:lvlText` placeholder expansion for OOXML lists.
//
// Pure, DOM-free, and strictly capped: hostile `lvlText` / counter values never allocate
// unbounded strings or run catastrophic regex.

/** Soft ceiling on an expanded marker string (codepoints). */
export const MAX_MARKER_TEXT_LENGTH = 64;

/** Soft ceiling on authored `w:lvlText` before expansion. */
export const MAX_LVL_TEXT_LENGTH = 64;

const ROMAN_TABLE: readonly { readonly value: number; readonly glyph: string }[] = [
  { value: 1000, glyph: 'M' },
  { value: 900, glyph: 'CM' },
  { value: 500, glyph: 'D' },
  { value: 400, glyph: 'CD' },
  { value: 100, glyph: 'C' },
  { value: 90, glyph: 'XC' },
  { value: 50, glyph: 'L' },
  { value: 40, glyph: 'XL' },
  { value: 10, glyph: 'X' },
  { value: 9, glyph: 'IX' },
  { value: 5, glyph: 'V' },
  { value: 4, glyph: 'IV' },
  { value: 1, glyph: 'I' },
];

/** Clamp a list counter into a safe positive integer Word can format. */
export function clampListValue(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  // 3999 is the conventional roman ceiling; letters wrap past 26 via multi-letter form.
  if (n > 9999) return 9999;
  return n;
}

export function formatDecimal(value: number): string {
  return String(clampListValue(value));
}

export function formatDecimalZero(value: number): string {
  const n = clampListValue(value);
  return n < 10 ? `0${n}` : String(n);
}

export function formatUpperRoman(value: number): string {
  let n = clampListValue(value);
  if (n > 3999) n = 3999;
  let out = '';
  for (const { value: unit, glyph } of ROMAN_TABLE) {
    while (n >= unit) {
      out += glyph;
      n -= unit;
      if (out.length >= MAX_MARKER_TEXT_LENGTH) return out.slice(0, MAX_MARKER_TEXT_LENGTH);
    }
  }
  return out || 'I';
}

export function formatLowerRoman(value: number): string {
  return formatUpperRoman(value).toLowerCase();
}

/**
 * Excel-style letter sequence: 1→A … 26→Z, 27→AA.
 * Caps length so a hostile counter cannot grow without bound.
 */
export function formatUpperLetter(value: number): string {
  let n = clampListValue(value);
  let out = '';
  while (n > 0 && out.length < 8) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out || 'A';
}

export function formatLowerLetter(value: number): string {
  return formatUpperLetter(value).toLowerCase();
}

/**
 * Format one counter for a `w:numFmt` value.
 *
 * Unknown formats fall back to decimal so a marker still appears rather than vanishing.
 * `bullet` is not formatted here — callers use the literal `lvlText`.
 */
export function formatNumFmt(numFmt: string, value: number): string {
  switch (numFmt) {
    case 'decimal':
      return formatDecimal(value);
    case 'decimalZero':
      return formatDecimalZero(value);
    case 'upperRoman':
      return formatUpperRoman(value);
    case 'lowerRoman':
      return formatLowerRoman(value);
    case 'upperLetter':
      return formatUpperLetter(value);
    case 'lowerLetter':
      return formatLowerLetter(value);
    case 'bullet':
      return '';
    default:
      return formatDecimal(value);
  }
}

/**
 * Expand `w:lvlText` placeholders `%1`…`%9` using per-level counters and formats.
 *
 * `formats[i]` / `counters[i]` correspond to ilvl `i`. Missing slots use decimal / 1.
 * Literal percent signs that are not `%1`…`%9` are kept. Output is hard-capped.
 */
export function expandLvlText(
  lvlText: string,
  counters: readonly number[],
  formats: readonly string[]
): string {
  const source =
    lvlText.length > MAX_LVL_TEXT_LENGTH ? lvlText.slice(0, MAX_LVL_TEXT_LENGTH) : lvlText;
  let out = '';
  for (let index = 0; index < source.length; index += 1) {
    if (out.length >= MAX_MARKER_TEXT_LENGTH) break;
    const ch = source[index]!;
    if (ch === '%' && index + 1 < source.length) {
      const digit = source[index + 1]!;
      if (digit >= '1' && digit <= '9') {
        const level = Number(digit) - 1;
        const fmt = formats[level] ?? 'decimal';
        const value = counters[level] ?? 1;
        const piece =
          fmt === 'bullet' ? '' : formatNumFmt(fmt, value);
        for (const glyph of piece) {
          if (out.length >= MAX_MARKER_TEXT_LENGTH) break;
          out += glyph;
        }
        index += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}
