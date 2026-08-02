// Legacy symbol-font encoding (U+F020–U+F0FF) → Unicode, for list markers.
//
// Word writes a Symbol/Wingdings bullet as the font's own byte PLUS 0xF000: the default
// bullet is `<w:lvlText w:val=""/>` with `<w:rFonts w:ascii="Symbol"/>`, not U+2022.
// Those codepoints are in the Private Use Area, so they mean "glyph 0xB7 of THIS font" and
// nothing at all to any other font. A (3,0) symbol-cmap Symbol/Wingdings resolves them; a
// Unicode-cmap font of the same name (macOS ships one) does not, and the reader gets a tofu
// box where every Word-authored bullet should be.
//
// The mapping is a FALLBACK, not a substitution policy: when the caller can prove the
// authored family is really available, the file's own codepoint is left alone so the
// intended typeface draws it. Pure and DOM-free — no font loading happens here.

/** PUA offset Word adds to a symbol font's byte value. */
const SYMBOL_PUA_BASE = 0xf000;

const SYMBOL_PUA_END = 0xf0ff;

/**
 * Adobe Symbol high-range glyphs used as bullets, by byte value.
 *
 * Only entries whose Unicode equivalent is the SAME glyph are listed; an approximate match
 * would trade a tofu box for a wrong character, which is not an improvement.
 */
const SYMBOL_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0xa7, '♣'], // clubsuit ♣
  [0xa8, '♦'], // diamondsuit ♦
  [0xa9, '♥'], // heartsuit ♥
  [0xaa, '♠'], // spadesuit ♠
  [0xae, '→'], // arrowright →
  [0xb0, '°'], // degree °
  [0xb4, '×'], // multiply ×
  [0xb7, '•'], // bulletmath • — Word's default level-0 bullet
  [0xde, '⇒'], // arrowdblright ⇒
]);

/** Wingdings glyphs Word uses for bullets, by byte value. */
const WINGDINGS_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0x6c, '●'], // 'l' — black circle ●
  [0x6e, '■'], // 'n' — black square ■
  [0x6f, '□'], // 'o' — white square □
  [0xa7, '▪'], // small black square ▪ — Word's default level-2 bullet
  [0xd8, '➢'], // three-D arrowhead ➢
  [0xfc, '✔'], // heavy check mark ✔
  [0xfd, '✘'], // heavy ballot X ✘
]);

/** Wingdings 2 bullets. */
const WINGDINGS2_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0xa7, '▪'], // small black square ▪
  [0xb7, '•'], // bullet •
]);

/**
 * Family name → its byte-to-Unicode table.
 *
 * Keys are lowercased because `w:rFonts` casing is authored, not canonical.
 */
const SYMBOL_FAMILIES: ReadonlyMap<string, ReadonlyMap<number, string>> = new Map([
  ['symbol', SYMBOL_TO_UNICODE],
  ['wingdings', WINGDINGS_TO_UNICODE],
  ['wingdings 2', WINGDINGS2_TO_UNICODE],
  ['wingdings 3', WINGDINGS2_TO_UNICODE],
  ['webdings', WINGDINGS_TO_UNICODE],
]);

/** Longest family name we will even look up — the value is file-derived. */
const MAX_FAMILY_LENGTH = 64;

/** True when the family is one of the legacy symbol-encoded fonts. */
export function isSymbolEncodedFamily(fontFamily: string | null | undefined): boolean {
  if (!fontFamily || fontFamily.length > MAX_FAMILY_LENGTH) return false;
  return SYMBOL_FAMILIES.has(fontFamily.toLowerCase());
}

/** True when the text contains a codepoint from the symbol-font private-use range. */
export function hasSymbolPua(text: string): boolean {
  for (const glyph of text) {
    const code = glyph.codePointAt(0)!;
    if (code >= SYMBOL_PUA_BASE && code <= SYMBOL_PUA_END) return true;
  }
  return false;
}

/**
 * Rewrite private-use symbol-font codepoints to their Unicode equivalents.
 *
 * Applies only to a known symbol-encoded family, only to the U+F020–U+F0FF range, and only
 * to codepoints with an exact Unicode counterpart — anything else is returned untouched, so
 * an unrecognised glyph is never replaced by a wrong one. Returns the input string by
 * identity when nothing changes.
 *
 * `isFamilyAvailable` is the escape hatch: a host that KNOWS the authored font is present
 * should return true, and the file's own codepoint is kept so the real typeface draws it.
 * Absent, the fallback applies, because an unmapped PUA codepoint renders as a tofu box in
 * every font that is not the symbol-encoded original.
 */
export function mapSymbolPuaText(
  text: string,
  fontFamily: string | null | undefined,
  isFamilyAvailable?: (family: string) => boolean
): string {
  if (text.length === 0 || !isSymbolEncodedFamily(fontFamily)) return text;
  const table = SYMBOL_FAMILIES.get(fontFamily!.toLowerCase())!;
  if (isFamilyAvailable?.(fontFamily!) === true) return text;
  let out = '';
  let changed = false;
  for (const glyph of text) {
    const code = glyph.codePointAt(0)!;
    if (code >= SYMBOL_PUA_BASE && code <= SYMBOL_PUA_END) {
      const mapped = table.get(code - SYMBOL_PUA_BASE);
      if (mapped !== undefined) {
        out += mapped;
        changed = true;
        continue;
      }
    }
    out += glyph;
  }
  return changed ? out : text;
}
