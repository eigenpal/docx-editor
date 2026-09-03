/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/** PDF WinAnsiEncoding byte-to-glyph table used by PDFKit standard fonts. @internal */
const WIN_ANSI_GLYPHS = `\
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
  
space         exclam         quotedbl       numbersign
dollar        percent        ampersand      quotesingle
parenleft     parenright     asterisk       plus
comma         hyphen         period         slash
zero          one            two            three
four          five           six            seven
eight         nine           colon          semicolon
less          equal          greater        question
  
at            A              B              C
D             E              F              G
H             I              J              K
L             M              N              O
P             Q              R              S
T             U              V              W
X             Y              Z              bracketleft
backslash     bracketright   asciicircum    underscore
  
grave         a              b              c
d             e              f              g
h             i              j              k
l             m              n              o
p             q              r              s
t             u              v              w
x             y              z              braceleft
bar           braceright     asciitilde     .notdef
  
Euro          .notdef        quotesinglbase florin
quotedblbase  ellipsis       dagger         daggerdbl
circumflex    perthousand    Scaron         guilsinglleft
OE            .notdef        Zcaron         .notdef
.notdef       quoteleft      quoteright     quotedblleft
quotedblright bullet         endash         emdash
tilde         trademark      scaron         guilsinglright
oe            .notdef        zcaron         ydieresis
  
space         exclamdown     cent           sterling
currency      yen            brokenbar      section
dieresis      copyright      ordfeminine    guillemotleft
logicalnot    hyphen         registered     macron
degree        plusminus      twosuperior    threesuperior
acute         mu             paragraph      periodcentered
cedilla       onesuperior    ordmasculine   guillemotright
onequarter    onehalf        threequarters  questiondown
  
Agrave        Aacute         Acircumflex    Atilde
Adieresis     Aring          AE             Ccedilla
Egrave        Eacute         Ecircumflex    Edieresis
Igrave        Iacute         Icircumflex    Idieresis
Eth           Ntilde         Ograve         Oacute
Ocircumflex   Otilde         Odieresis      multiply
Oslash        Ugrave         Uacute         Ucircumflex
Udieresis     Yacute         Thorn          germandbls
  
agrave        aacute         acircumflex    atilde
adieresis     aring          ae             ccedilla
egrave        eacute         ecircumflex    edieresis
igrave        iacute         icircumflex    idieresis
eth           ntilde         ograve         oacute
ocircumflex   otilde         odieresis      divide
oslash        ugrave         uacute         ucircumflex
udieresis     yacute         thorn          ydieresis\
`.split(/\s+/);

/** Unicode code point to WinAnsi byte overrides used by PDFKit standard fonts. @internal */
const WIN_ANSI_UNICODE_TO_BYTE = Object.freeze(
  new Map<number, number>([
    [0x0192, 131],
    [0x2013, 150],
    [0x2014, 151],
    [0x2018, 145],
    [0x2019, 146],
    [0x201a, 130],
    [0x201c, 147],
    [0x201d, 148],
    [0x201e, 132],
    [0x2020, 134],
    [0x2021, 135],
    [0x2022, 149],
    [0x2026, 133],
    [0x20ac, 128],
    [0x2030, 137],
    [0x2039, 139],
    [0x203a, 155],
    [0x02c6, 136],
    [0x2122, 153],
    [0x0152, 140],
    [0x0153, 156],
    [0x02dc, 152],
    [0x0160, 138],
    [0x0161, 154],
    [0x0178, 159],
    [0x017d, 142],
    [0x017e, 158],
  ])
);

function winAnsiGlyphForCodeUnit(codeUnit: number): string | undefined {
  const byte = WIN_ANSI_UNICODE_TO_BYTE.get(codeUnit) ?? codeUnit;
  if (!Number.isInteger(byte) || byte < 0 || byte >= WIN_ANSI_GLYPHS.length) return undefined;
  return WIN_ANSI_GLYPHS[byte];
}

/** Returns true when every UTF-16 code unit in `text` maps to PDF WinAnsiEncoding. @internal */
export function isWinAnsiRepresentable(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) return false;
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
    const glyph = winAnsiGlyphForCodeUnit(codeUnit);
    if (glyph === undefined || glyph === '.notdef') return false;
  }
  return true;
}
