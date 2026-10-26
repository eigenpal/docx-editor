// Chinese, Japanese, and Korean faces for `googleFonts({ cjk })`, one per regional variant.
//
// The current google/fonts families are variable-only, and the shaper refuses variation
// axes, so these pin the last revision that shipped static Noto Sans CJK faces. Each face
// is one regional subset (4.6-8.5 MB), not the 16 MB pan-CJK face: a Japanese document
// loads only the Japanese face, in Japanese glyph forms.
//
// The same trust rules as the catalog apply. A document family is only a lookup key into
// the closed table below, every URL is commit-pinned, and every face carries its SHA-256,
// which the engine re-derives on admission.

import type { GoogleFontFace } from './google-catalog.generated.ts';

/** The last google/fonts revision with static Noto Sans CJK faces. */
const CJK_REVISION = 'beff1d8226e598dfaf06f9f8312c01021f70e9d2';

const face = (family: string, path: string, byteLength: number, sha256: string): GoogleFontFace =>
  Object.freeze({
    family,
    weight: 400,
    style: 'normal',
    url: `https://cdn.jsdelivr.net/gh/google/fonts@${CJK_REVISION}/ofl/${path}`,
    byteLength,
    hash: `sha256:${sha256}`,
  });

const JAPANESE = face(
  'Noto Sans JP',
  'notosansjp/NotoSansJP-Regular.otf',
  4570384,
  'a134311616ec89a45682312bcde81f3d61fc84191e20d1098c6764218e103cc5'
);
const SIMPLIFIED_CHINESE = face(
  'Noto Sans SC',
  'notosanssc/NotoSansSC-Regular.otf',
  8493924,
  '04da2dac7dc3960fad1046d75b9a61ee30ecf3de8dd3b71a7860fbb99492ac21'
);
const TRADITIONAL_CHINESE = face(
  'Noto Sans TC',
  'notosanstc/NotoSansTC-Regular.otf',
  5789520,
  '5e825e8c8969a911a4d0897ea764591097c9125f53140f8a652e30ef7a6146bc'
);
const KOREAN = face(
  'Noto Sans KR',
  'notosanskr/NotoSansKR-Regular.otf',
  4760584,
  'd9fbb8c54185f3dadaa26123021933ef8e779358fbfdaffb08330086de9fb0ed'
);

/** The four regional faces `googleFonts({ cjk })` can load. */
export const GOOGLE_CJK_FACES: readonly GoogleFontFace[] = Object.freeze([
  JAPANESE,
  SIMPLIFIED_CHINESE,
  TRADITIONAL_CHINESE,
  KOREAN,
]);

/**
 * East Asian families, in English and in the localized names documents write, each with
 * the regional face that stands in for it. The face covers their text, not their metrics.
 * A `Map`, because the key is file-derived and must never find a prototype member.
 */
const CJK_FAMILY_TABLE: readonly (readonly [GoogleFontFace, string])[] = (
  [
    [JAPANESE, ['MS Gothic', 'MS PGothic', 'MS UI Gothic', 'MS Mincho', 'MS PMincho']],
    [JAPANESE, ['Meiryo', 'Meiryo UI', 'Yu Gothic', 'Yu Gothic UI', 'Yu Mincho']],
    [JAPANESE, ['ＭＳ 明朝', 'ＭＳ Ｐ明朝', 'ＭＳ ゴシック', 'ＭＳ Ｐゴシック']],
    [JAPANESE, ['ＭＳ ＵＩ Ｇｏｔｈｉｃ', 'メイリオ', '游ゴシック', '游明朝']],
    [SIMPLIFIED_CHINESE, ['SimSun', 'NSimSun', 'SimHei', 'FangSong', 'KaiTi', 'DengXian']],
    [SIMPLIFIED_CHINESE, ['Microsoft YaHei', '宋体', '新宋体', '黑体', '仿宋', '楷体']],
    [SIMPLIFIED_CHINESE, ['等线', '微软雅黑']],
    [TRADITIONAL_CHINESE, ['Microsoft JhengHei', 'MingLiU', 'PMingLiU', 'DFKai-SB']],
    [TRADITIONAL_CHINESE, ['微軟正黑體', '新細明體', '細明體', '標楷體']],
    [KOREAN, ['Malgun Gothic', 'Batang', 'BatangChe', 'Gulim', 'GulimChe']],
    [KOREAN, ['Dotum', 'DotumChe', 'Gungsuh', '맑은 고딕', '바탕', '굴림', '돋움', '궁서']],
    ...GOOGLE_CJK_FACES.map((regional) => [regional, [regional.family]] as const),
  ] as const
).flatMap(([regional, families]) => families.map((family) => [regional, family] as const));

const CJK_FAMILY_FACES: ReadonlyMap<string, GoogleFontFace> = new Map(
  CJK_FAMILY_TABLE.map(([regional, family]) => [family.toLowerCase(), regional] as const)
);

/** Every East Asian family name `googleFonts({ cjk })` answers, as documents write it. */
export const GOOGLE_CJK_FAMILY_NAMES: readonly {
  readonly family: string;
  readonly face: string;
}[] = Object.freeze(
  CJK_FAMILY_TABLE.map(([regional, family]) => ({ family, face: regional.family }))
);

/** The regional face for a declared family, or `undefined` when it is not an East Asian one. */
export function googleCjkFaceFor(family: string): GoogleFontFace | undefined {
  return CJK_FAMILY_FACES.get(family.trim().toLowerCase());
}
