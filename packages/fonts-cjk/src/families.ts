// The families the packaged face stands in for. No Node.js or browser API here: both entries
// read it.

/**
 * Family name of the packaged face.
 *
 * @public
 */
export const NOTO_SANS_CJK_JP_FAMILY = 'Noto Sans CJK JP';

/**
 * SHA-256 of `assets/NotoSansCJKjp-Regular.otf`, as `assets/sources.json` records it. The
 * editor checks font bytes against the hash a source states.
 */
export const NOTO_SANS_CJK_JP_SHA256 =
  '68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5';

/**
 * East Asian families the packaged face stands in for when the family itself is missing.
 *
 * The face covers their text, not their metrics: substituting it can change glyph forms,
 * line breaks, and page counts.
 *
 * @public
 */
export const CJK_SUBSTITUTED_FAMILIES: readonly string[] = Object.freeze([
  'MS Gothic',
  'MS PGothic',
  'MS UI Gothic',
  'MS Mincho',
  'MS PMincho',
  'Meiryo',
  'Yu Gothic',
  'Yu Mincho',
  'SimSun',
  'NSimSun',
  'SimHei',
  'FangSong',
  'KaiTi',
  'DengXian',
  'Microsoft YaHei',
  'Microsoft JhengHei',
  'MingLiU',
  'PMingLiU',
  'Batang',
  'Gulim',
  'Dotum',
  'Malgun Gothic',
]);

/**
 * Localized names that documents write for the families in {@link CJK_SUBSTITUTED_FAMILIES},
 * each mapped to its English name. A document saved in a Chinese, Japanese, or Korean locale
 * names its East Asian font this way.
 *
 * A `Map`, not an object: the key is file-derived, and a name such as `constructor` must not
 * find a prototype member.
 *
 * @public
 */
export const LOCALIZED_CJK_FAMILIES: ReadonlyMap<string, string> = new Map([
  ['宋体', 'SimSun'],
  ['新宋体', 'NSimSun'],
  ['黑体', 'SimHei'],
  ['仿宋', 'FangSong'],
  ['楷体', 'KaiTi'],
  ['等线', 'DengXian'],
  ['微软雅黑', 'Microsoft YaHei'],
  ['微軟正黑體', 'Microsoft JhengHei'],
  ['新細明體', 'PMingLiU'],
  ['細明體', 'MingLiU'],
  ['ＭＳ 明朝', 'MS Mincho'],
  ['ＭＳ Ｐ明朝', 'MS PMincho'],
  ['ＭＳ ゴシック', 'MS Gothic'],
  ['ＭＳ Ｐゴシック', 'MS PGothic'],
  ['ＭＳ ＵＩ Ｇｏｔｈｉｃ', 'MS UI Gothic'],
  ['メイリオ', 'Meiryo'],
  ['游ゴシック', 'Yu Gothic'],
  ['游明朝', 'Yu Mincho'],
  ['맑은 고딕', 'Malgun Gothic'],
  ['바탕', 'Batang'],
  ['굴림', 'Gulim'],
  ['돋움', 'Dotum'],
]);
