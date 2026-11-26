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
 * Symbol glyphs by byte value, from the Adobe Symbol encoding.
 *
 * Each entry was compared with the glyph name the face itself has for that byte. Bullet
 * levels (`w:lvlText`, §17.9.11, CT_LevelText) and symbol characters (`w:sym`, §17.3.3.30,
 * CT_Sym) use the whole range: Greek letters, arithmetic, arrows, and set operators.
 *
 * Left out: the space; the bracket, brace, and integral extension pieces and the serif and
 * sans registered, copyright, and trademark signs (only private-use code points stand for
 * them); the euro sign (the face has no glyph); and `divide` and `logicalnot`. Their Unicode
 * twins (U+00F7, U+00AC) are also bare bytes of other glyphs, so {@link symbolFaceByteOf}
 * could not invert them. `multiply` (U+00D7) has the same clash and keeps its entry: the
 * inverse prefers the twin.
 * Where the encoding lists two code points, the Greek letter (Delta, Omega, mu) and the
 * fraction slash are used.
 */
const SYMBOL_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0x21, '\u0021'], // exclam !
  [0x22, '\u2200'], // universal ∀
  [0x23, '\u0023'], // numbersign #
  [0x24, '\u2203'], // existential ∃
  [0x25, '\u0025'], // percent %
  [0x26, '\u0026'], // ampersand &
  [0x27, '\u220b'], // suchthat ∋
  [0x28, '\u0028'], // parenleft (
  [0x29, '\u0029'], // parenright )
  [0x2a, '\u2217'], // asteriskmath ∗
  [0x2b, '\u002b'], // plus +
  [0x2c, '\u002c'], // comma ,
  [0x2d, '\u2212'], // minus −
  [0x2e, '\u002e'], // period .
  [0x2f, '\u002f'], // slash /
  [0x30, '\u0030'], // zero 0
  [0x31, '\u0031'], // one 1
  [0x32, '\u0032'], // two 2
  [0x33, '\u0033'], // three 3
  [0x34, '\u0034'], // four 4
  [0x35, '\u0035'], // five 5
  [0x36, '\u0036'], // six 6
  [0x37, '\u0037'], // seven 7
  [0x38, '\u0038'], // eight 8
  [0x39, '\u0039'], // nine 9
  [0x3a, '\u003a'], // colon :
  [0x3b, '\u003b'], // semicolon ;
  [0x3c, '\u003c'], // less <
  [0x3d, '\u003d'], // equal =
  [0x3e, '\u003e'], // greater >
  [0x3f, '\u003f'], // question ?
  [0x40, '\u2245'], // congruent ≅
  [0x41, '\u0391'], // Alpha Α
  [0x42, '\u0392'], // Beta Β
  [0x43, '\u03a7'], // Chi Χ
  [0x44, '\u0394'], // Delta Δ
  [0x45, '\u0395'], // Epsilon Ε
  [0x46, '\u03a6'], // Phi Φ
  [0x47, '\u0393'], // Gamma Γ
  [0x48, '\u0397'], // Eta Η
  [0x49, '\u0399'], // Iota Ι
  [0x4a, '\u03d1'], // theta1 ϑ
  [0x4b, '\u039a'], // Kappa Κ
  [0x4c, '\u039b'], // Lambda Λ
  [0x4d, '\u039c'], // Mu Μ
  [0x4e, '\u039d'], // Nu Ν
  [0x4f, '\u039f'], // Omicron Ο
  [0x50, '\u03a0'], // Pi Π
  [0x51, '\u0398'], // Theta Θ
  [0x52, '\u03a1'], // Rho Ρ
  [0x53, '\u03a3'], // Sigma Σ
  [0x54, '\u03a4'], // Tau Τ
  [0x55, '\u03a5'], // Upsilon Υ
  [0x56, '\u03c2'], // sigma1 ς
  [0x57, '\u03a9'], // Omega Ω
  [0x58, '\u039e'], // Xi Ξ
  [0x59, '\u03a8'], // Psi Ψ
  [0x5a, '\u0396'], // Zeta Ζ
  [0x5b, '\u005b'], // bracketleft [
  [0x5c, '\u2234'], // therefore ∴
  [0x5d, '\u005d'], // bracketright ]
  [0x5e, '\u22a5'], // perpendicular ⊥
  [0x5f, '\u005f'], // underscore _
  [0x61, '\u03b1'], // alpha α
  [0x62, '\u03b2'], // beta β
  [0x63, '\u03c7'], // chi χ
  [0x64, '\u03b4'], // delta δ
  [0x65, '\u03b5'], // epsilon ε
  [0x66, '\u03c6'], // phi φ
  [0x67, '\u03b3'], // gamma γ
  [0x68, '\u03b7'], // eta η
  [0x69, '\u03b9'], // iota ι
  [0x6a, '\u03d5'], // phi1 ϕ
  [0x6b, '\u03ba'], // kappa κ
  [0x6c, '\u03bb'], // lambda λ
  [0x6d, '\u03bc'], // mu μ
  [0x6e, '\u03bd'], // nu ν
  [0x6f, '\u03bf'], // omicron ο
  [0x70, '\u03c0'], // pi π
  [0x71, '\u03b8'], // theta θ
  [0x72, '\u03c1'], // rho ρ
  [0x73, '\u03c3'], // sigma σ
  [0x74, '\u03c4'], // tau τ
  [0x75, '\u03c5'], // upsilon υ
  [0x76, '\u03d6'], // omega1 ϖ
  [0x77, '\u03c9'], // omega ω
  [0x78, '\u03be'], // xi ξ
  [0x79, '\u03c8'], // psi ψ
  [0x7a, '\u03b6'], // zeta ζ
  [0x7b, '\u007b'], // braceleft {
  [0x7c, '\u007c'], // bar |
  [0x7d, '\u007d'], // braceright }
  [0x7e, '\u223c'], // similar ∼
  [0xa1, '\u03d2'], // Upsilon1 ϒ
  [0xa2, '\u2032'], // minute ′
  [0xa3, '\u2264'], // lessequal ≤
  [0xa4, '\u2044'], // fraction ⁄
  [0xa5, '\u221e'], // infinity ∞
  [0xa6, '\u0192'], // florin ƒ
  [0xa7, '\u2663'], // club ♣
  [0xa8, '\u2666'], // diamond ♦
  [0xa9, '\u2665'], // heart ♥
  [0xaa, '\u2660'], // spade ♠
  [0xab, '\u2194'], // arrowboth ↔
  [0xac, '\u2190'], // arrowleft ←
  [0xad, '\u2191'], // arrowup ↑
  [0xae, '\u2192'], // arrowright →
  [0xaf, '\u2193'], // arrowdown ↓
  [0xb0, '\u00b0'], // degree °
  [0xb1, '\u00b1'], // plusminus ±
  [0xb2, '\u2033'], // second ″
  [0xb3, '\u2265'], // greaterequal ≥
  [0xb4, '\u00d7'], // multiply ×
  [0xb5, '\u221d'], // proportional ∝
  [0xb6, '\u2202'], // partialdiff ∂
  [0xb7, '\u2022'], // bullet •
  [0xb9, '\u2260'], // notequal ≠
  [0xba, '\u2261'], // equivalence ≡
  [0xbb, '\u2248'], // approxequal ≈
  [0xbc, '\u2026'], // ellipsis …
  [0xbf, '\u21b5'], // carriagereturn ↵
  [0xc0, '\u2135'], // aleph ℵ
  [0xc1, '\u2111'], // Ifraktur ℑ
  [0xc2, '\u211c'], // Rfraktur ℜ
  [0xc3, '\u2118'], // weierstrass ℘
  [0xc4, '\u2297'], // circlemultiply ⊗
  [0xc5, '\u2295'], // circleplus ⊕
  [0xc6, '\u2205'], // emptyset ∅
  [0xc7, '\u2229'], // intersection ∩
  [0xc8, '\u222a'], // union ∪
  [0xc9, '\u2283'], // propersuperset ⊃
  [0xca, '\u2287'], // reflexsuperset ⊇
  [0xcb, '\u2284'], // notsubset ⊄
  [0xcc, '\u2282'], // propersubset ⊂
  [0xcd, '\u2286'], // reflexsubset ⊆
  [0xce, '\u2208'], // element ∈
  [0xcf, '\u2209'], // notelement ∉
  [0xd0, '\u2220'], // angle ∠
  [0xd1, '\u2207'], // gradient ∇
  [0xd5, '\u220f'], // product ∏
  [0xd6, '\u221a'], // radical √
  [0xd7, '\u22c5'], // dotmath ⋅
  [0xd9, '\u2227'], // logicaland ∧
  [0xda, '\u2228'], // logicalor ∨
  [0xdb, '\u21d4'], // arrowdblboth ⇔
  [0xdc, '\u21d0'], // arrowdblleft ⇐
  [0xdd, '\u21d1'], // arrowdblup ⇑
  [0xde, '\u21d2'], // arrowdblright ⇒
  [0xdf, '\u21d3'], // arrowdbldown ⇓
  [0xe0, '\u25ca'], // lozenge ◊
  [0xe1, '\u2329'], // angleleft 〈
  [0xe5, '\u2211'], // summation ∑
  [0xf1, '\u232a'], // angleright 〉
  [0xf2, '\u222b'], // integral ∫
  [0xf3, '\u2320'], // integraltp ⌠
  [0xf5, '\u2321'], // integralbt ⌡
]);

/**
 * Wingdings glyphs used for bullets and form check boxes, by byte value.
 *
 * Each entry was compared with the glyph the face itself draws for that byte.
 */
const WINGDINGS_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0x3f, '\u270d'], // writing hand ✍
  [0x45, '\u261c'], // white left pointing index ☜
  [0x6c, '\u25cf'], // 'l' — black circle ●
  [0x6e, '\u25a0'], // 'n' — black square ■
  [0x6f, '\u25a1'], // 'o' — white square □
  [0x71, '\u2751'], // 'q' — lower right shadowed white square ❑
  [0x72, '\u2752'], // 'r' — upper right shadowed white square ❒
  [0xa7, '\u25aa'], // small black square ▪ — Word's default level-2 bullet
  [0xa8, '\u25fb'], // white medium square ◻
  [0xd8, '\u27a2'], // three-D arrowhead ➢
  [0xfb, '\u2717'], // ballot X ✗
  [0xfc, '\u2714'], // heavy check mark ✔
  [0xfd, '\u2718'], // heavy ballot X ✘
  [0xfe, '\u2611'], // ballot box with check ☑
]);

/** Wingdings 2 glyphs used for bullets and form check boxes, compared with the face. */
const WINGDINGS2_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0x2a, '\u25ab'], // white small square ▫
  [0x30, '\u25af'], // white vertical rectangle ▯
  [0x35, '\u25a2'], // white square with rounded corners ▢
  [0x4f, '\u2717'], // ballot X ✗
  [0x50, '\u2713'], // check mark ✓
  [0x52, '\u2611'], // ballot box with check ☑
  [0x53, '\u2612'], // ballot box with X ☒
  [0x9a, '\u2b58'], // heavy circle ⭘
  [0xa3, '\u25a1'], // white square □
  [0xa7, '\u25a3'], // white square containing black small square ▣
  [0xb7, '\u25c6'], // black diamond ◆
]);

/** Wingdings 3 arrows, compared with the face. */
const WINGDINGS3_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0xa7, '\u2b05'], // leftwards black arrow ⬅
]);

/**
 * Webdings glyphs, compared with the face. Its encoding is its own: the window buttons that
 * forms use as check boxes sit on the digits.
 */
const WEBDINGS_TO_UNICODE: ReadonlyMap<number, string> = new Map([
  [0x30, '\u{1f5d5}'], // minimize 🗕
  [0x31, '\u{1f5d6}'], // maximize 🗖
  [0x32, '\u{1f5d7}'], // overlap 🗗
  [0x63, '\u25a1'], // white square □
  [0x6e, '\u25cf'], // black circle ●
  [0x72, '\u{1f5d9}'], // cancellation X 🗙
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
  ['wingdings 3', WINGDINGS3_TO_UNICODE],
  ['webdings', WEBDINGS_TO_UNICODE],
]);

/** Longest family name we will even look up — the value is file-derived. */
const MAX_FAMILY_LENGTH = 64;

/**
 * Every legacy symbol-encoded family, case-folded.
 *
 * This is the CLOSED set an availability oracle can ever be asked about, because
 * {@link mapSymbolPuaText} consults its oracle only after {@link isSymbolEncodedFamily}
 * passes. A caller probing these names therefore probes a fixed list of five, never a
 * file-derived one. Derived from the table so the two cannot drift; font requests fold
 * case, so the folded spelling reaches the same face as the document's own.
 */
export const SYMBOL_ENCODED_FAMILIES: readonly string[] = Object.freeze([
  ...SYMBOL_FAMILIES.keys(),
]);

/** True when the family is one of the legacy symbol-encoded fonts. */
export function isSymbolEncodedFamily(fontFamily: string | null | undefined): boolean {
  if (!fontFamily || fontFamily.length > MAX_FAMILY_LENGTH) return false;
  return SYMBOL_FAMILIES.has(fontFamily.toLowerCase());
}

/** Unicode twin → face byte, per table, built on first use. */
const unicodeToByteByTable = new Map<ReadonlyMap<number, string>, ReadonlyMap<number, number>>();

/**
 * The byte of a symbol-encoded face that one character stands for, or null.
 *
 * The inverse of {@link mapSymbolPuaText}: a private-use code names its byte directly, a
 * Unicode twin that mapping produced names the byte it came from, and a bare byte (U+0020–
 * U+00FF) is the byte itself, which is how the face reads it. Twins win over bare bytes,
 * because mapping is the only producer of a twin inside that range (`×` from Symbol 0xB4).
 * Anything else is no byte of the face.
 */
export function symbolFaceByteOf(codePoint: number, fontFamily: string): number | null {
  if (!isSymbolEncodedFamily(fontFamily)) return null;
  if (codePoint >= SYMBOL_PUA_BASE + 0x20 && codePoint <= SYMBOL_PUA_END)
    return codePoint - SYMBOL_PUA_BASE;
  const table = SYMBOL_FAMILIES.get(fontFamily.toLowerCase())!;
  let inverse = unicodeToByteByTable.get(table);
  if (!inverse) {
    const built = new Map<number, number>();
    for (const [byte, twin] of table) built.set(twin.codePointAt(0)!, byte);
    unicodeToByteByTable.set(table, built);
    inverse = built;
  }
  const twin = inverse.get(codePoint);
  if (twin !== undefined) return twin;
  return codePoint >= 0x20 && codePoint <= 0xff ? codePoint : null;
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
 *
 * Called without the oracle it is also the EXTRACTION answer: the text a symbol glyph should
 * read as when the drawn glyph stays the authored one. A PDF exporter maps the drawn private
 * codepoint back through this for its `ToUnicode` table, so copying a Word bullet out of the
 * page yields a bullet rather than a private-use character.
 *
 * @public
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

/** Resolve single-byte Symbol and Wingdings bullets through their known glyph mapping. */
export function mapSymbolBulletText(
  text: string,
  fontFamily: string | null | undefined,
  isFamilyAvailable?: (family: string) => boolean
): string {
  if (text.length === 1 && isSymbolEncodedFamily(fontFamily)) {
    const family = fontFamily!.toLowerCase();
    if (family === 'symbol' || family === 'wingdings') {
      const mapped = SYMBOL_FAMILIES.get(family)!.get(text.charCodeAt(0));
      if (mapped !== undefined && isFamilyAvailable?.(fontFamily!) !== true) return mapped;
    }
  }
  return mapSymbolPuaText(text, fontFamily, isFamilyAvailable);
}
