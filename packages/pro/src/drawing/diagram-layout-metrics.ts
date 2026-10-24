/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Advance widths for the diagram rule loop when no text measurer is injected.
//
// Generated from the metric-compatible faces in `@docx-editor.dev/fonts` (Carlito for
// Calibri, Caladea for Cambria, Liberation Sans for Arial, Liberation Serif for Times New
// Roman): per face the line height (win ascent plus descent) and the advance of U+0020 to
// U+007E and U+00A0 to U+00FF, in thousandths of an em, two base-36 digits each.

const FACES = {
  'Carlito-Regular': [
    1221,
    '6a92b5due3jviy658f8fdudu6y8i70aqe3e3e3e3e3e3e3e3e3e37g7gdududucvoug3f4eth3dkcrhjhb708vegbonrhyieedipf3crdjhufroqefdjd08jaq8jdudu83dbelbreldu8hd3el6d6ncn6dm7elenelel9pav9belckjvc1claz8qcs8qdu6a92due3due3duduaxn6b6e8due3e3ay9fdu9c9a84faga708j6ubqe8hoinircvg3g3g3g3g3g3l7etdkdkdkdk70707070hdhyieieieieieduighuhuhuhudjedendbdbdbdbdbdblhbrdudududu6d6d6d6delelenenenenenduepelelelelclelcl',
  ],
  'Carlito-Bold': [
    1221,
    '6a92c6due3k9jl6h8o8odudu768i7fbye3e3e3e3e3e3e3e3e3e37o7odududucvoyguflephidkcrhphj7f97f7broaibisesj2fnd5dri5gfp6fbegda91by91dudu8cdqexbmexdz8sd6ex6u73dc6umlexeyexex9vb39nexd5kpcrd6b19kd79kdu6a92due3due3dudubjn6bkezdue3e3au9idu9e9c8dfngm7g8f70c3eziaj7jicvguguguguguguljepdkdkdkdk7f7f7f7fhribisisisisisduixi5i5i5i5egesffdqdqdqdqdqdqljbmdzdzdzdz6u6u6u6uexexeyeyeyeyeyduf4exexexexd6exd6',
  ],
  'Caladea-Regular': [
    1300,
    '647yaxh7e2oqj36lamambvfe5p955qdmeda2d4ctdod7d2d2dhda7c7cfefefebqolgng3efhdf0e5ezjc9j8ghidxooj9gnetgnh1clfhj3gmopfvfhe39qdm9qfeab47d2egbpegc98pcrfe7p73el7jmlfidcegdxb0aw91f6d2k0dfdebwar8sarjs647yc9eof4gx8sdw79nnbldnfe98nn7qaffebbbb47f4gc2y7xbbbwdnn1o3o2bqgngngngngngno2eff0f0f0f09j9j9j9jiej9gngngngngnfei5j3j3j3j3fhfygtd2d2d2d2d2d2jobpc9c9c9c97p7p7p7peqfidcdcdcdcdcfedmf6f6f6f6def7de',
  ],
  'Caladea-Bold': [
    1300,
    '649bbqh6f3r4kk6zbcbcclgg6g8n6ee1etcqe3e4fdegeydqfgeu7s7sggggggckpli5hmfbigfjeugajz9y9giwf1nhj2hzghhzhsd5gbjbhkqnh4gbfea8e1a8ggab54elfscifue99be4go8k89gd8norgseqfxfjcmcca5gxeflnelehcwax8waxgg649bd1fggbgs8wet86nnboergg9dnn8naiggc5c553gtgc3w7xc5c4eroxp4qycki5i5i5i5i5i5ogfbfjfjfjfj9y9y9y9yjpj2hzhzhzhzhzggjbjbjbjbjbgbh5itelelelelelelm2cie9e9e9e98k8k8k8nfwgseqeqeqeqeqggftgxgxgxgxehgfeh',
  ],
  'LiberationSans-Regular': [
    1117,
    '7q7q9vfgfgopij5b9999atg87q997q7qfgfgfgfgfgfgfgfgfgfg7q7qg8g8g8fgs7ijijk2k2ijgzlmk27qdwijfgn5k2lmijlmk2ijgzk2ijq8ijijgz7q7q7qd1fg99fgfgdwfgfg7qfgfg6666dw66n5fgfgfgfg99dw7qfgdwk2dwdwdw9a789ag87q99fgfgfgfg78fg99khaafgg899khfcb4f9999999g0ex999999a5fgn6n6n6gzijijijijijijrsk2ijijijij7q7q7q7qk2k2lmlmlmlmlmg8lmk2k2k2k2ijijgzfgfgfgfgfgfgopdwfgfgfgfg7q7q7q7qfgfgfgfgfgfgfgf9gzfgfgfgfgdwfgdw',
  ],
  'LiberationSans-Bold': [
    1117,
    '7q99d6fgfgopk26m9999atg87q997q7qfgfgfgfgfgfgfgfgfgfg9999g8g8g8gzr3k2k2k2k2ijgzlmk27qfgk2gzn5k2lmijlmk2ijgzk2ijq8ijijgz997q99g8fg99fggzfggzfg99gzgz7q7qfg7qopgzgzgzgzatfg99gzfglmfgfgdwat7satg87q99fgfgfgfg7sfg99khaafgg899khfcb4f9999999g0fg999999a5fgn6n6n6gzk2k2k2k2k2k2rsk2ijijijij7q7q7q7qk2k2lmlmlmlmlmg8lmk2k2k2k2ijijgzfgfgfgfgfgfgopfgfgfgfgfg7q7q7q7qgzgzgzgzgzgzgzf9gzgzgzgzgzfggzfg',
  ],
  'LiberationSerif-Regular': [
    1107,
    '6y99bcdwdwn5lm509999dwfo6y996y7qdwdwdwdwdwdwdwdwdwdw7q7qfofofoccplk2ijijk2gzfgk2k299atk2gzopk2k2fgk2ijfggzk2k2q8k2k2gz997q99d1dw99ccdwccdwcc99dwdw7q7qdw7qlmdwdwdwdw99at7qdwdwk2dwdwccdc5kdcf16y99dwdwdwdw5kdw99l47odwfo99l4dwb4f98c8c99g0cl99998c8mdwkukukucck2k2k2k2k2k2opijgzgzgzgz99999999k2k2k2k2k2k2k2fok2k2k2k2k2k2fgdwccccccccccccijcccccccccc7q7q7q7qdwdwdwdwdwdwdwf9dwdwdwdwdwdwdwdw',
  ],
  'LiberationSerif-Bold': [
    1107,
    '6y99ffdwdwrsn57q9999dwfu6y996y7qdwdwdwdwdwdwdwdwdwdw9999fufufudwpuk2ijk2k2ijgzlmlmatdwlmijq8k2lmgzlmk2fgijk2k2rsk2k2ij997q99g5dw99dwfgccfgcc99dwfg7q99fg7qn5fgdwfgfgccat99fgdwk2dwdwccay64ayeg6y99dwdwdwdw64dw99kr8cdwfu99krdwb4f98c8c99g0f099998c96dwkukukudwk2k2k2k2k2k2rsk2ijijijijatatatatk2k2lmlmlmlmlmfulmk2k2k2k2k2gzfgdwdwdwdwdwdwk2cccccccccc7q7q7q7qdwfgdwdwdwdwdwf9dwfgfgfgfgdwfgdw',
  ],
} as const satisfies Record<string, readonly [number, string]>;

type FaceName = keyof typeof FACES;

/** Families the tables stand in for; anything else measures as the sans default. */
const FAMILY_FACES: Record<string, string> = {
  calibri: 'Carlito',
  carlito: 'Carlito',
  'calibri light': 'Carlito',
  aptos: 'Carlito',
  cambria: 'Caladea',
  caladea: 'Caladea',
  arial: 'LiberationSans',
  helvetica: 'LiberationSans',
  'liberation sans': 'LiberationSans',
  'times new roman': 'LiberationSerif',
  times: 'LiberationSerif',
  'liberation serif': 'LiberationSerif',
  georgia: 'LiberationSerif',
};

interface DecodedFace {
  readonly lineHeight: number;
  readonly widths: Uint16Array;
}

const decoded = new Map<FaceName, DecodedFace>();

function digit(code: number): number {
  return code <= 57 ? code - 48 : code - 87;
}

function face(name: FaceName): DecodedFace {
  let entry = decoded.get(name);
  if (!entry) {
    const [lineHeight, table] = FACES[name];
    const widths = new Uint16Array(table.length / 2);
    for (let i = 0; i < widths.length; i++) {
      widths[i] = digit(table.charCodeAt(2 * i)) * 36 + digit(table.charCodeAt(2 * i + 1));
    }
    entry = { lineHeight, widths };
    decoded.set(name, entry);
  }
  return entry;
}

/** Width of one code point in thousandths of an em; an average for anything outside. */
function advance(widths: Uint16Array, code: number): number {
  if (code >= 32 && code <= 126) return widths[code - 32]!;
  if (code >= 160 && code <= 255) return widths[code - 160 + 95]!;
  // Wide scripts take a full em; anything else the width of a lowercase `n`.
  if (code >= 0x2e80) return 1000;
  return widths[78]!;
}

/** Measures diagram text in points. Injected by a host with real font metrics. */
export interface DiagramTextMeasurer {
  /** Advance width of `text` at `sizePt` in `family`. */
  width(text: string, sizePt: number, family: string, bold: boolean): number;
  /** Single line height at `sizePt` (ascent plus descent). */
  lineHeight(sizePt: number, family: string): number;
}

function faceFor(family: string, bold: boolean): FaceName {
  const base = FAMILY_FACES[family.trim().toLowerCase()] ?? 'Carlito';
  return `${base}-${bold ? 'Bold' : 'Regular'}` as FaceName;
}

/** The built-in measurer: metric-compatible advance tables, no shaping or kerning. */
export const tableDiagramTextMeasurer: DiagramTextMeasurer = {
  width(text, sizePt, family, bold) {
    const { widths } = face(faceFor(family, bold));
    let total = 0;
    for (let i = 0; i < text.length; i++) total += advance(widths, text.charCodeAt(i));
    return (total / 1000) * sizePt;
  },
  lineHeight(sizePt, family) {
    return (face(faceFor(family, false)).lineHeight / 1000) * sizePt;
  },
};
