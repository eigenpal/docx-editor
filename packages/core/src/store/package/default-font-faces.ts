// The faces a document uses when it names none, and which faces count as Chinese fonts.
//
// Every table here was measured against reference output with anonymous probe documents:
// one run per case, the face read back from each drawn glyph. Keep them together so layout,
// font discovery and the notice read one answer.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** The face of a Latin slot (`w:ascii`, `w:hAnsi`) that no level names, under an authored `w:rPrDefault`. */
export const FORMAT_DEFAULT_LATIN_FAMILY = 'Times New Roman';

/** The East Asian face that no level names, under an authored `w:rPrDefault`. */
export const FORMAT_DEFAULT_EAST_ASIAN_FAMILY = 'SimSun';

/** East Asian script of the theme language when it names none. */
export const DEFAULT_EAST_ASIAN_SCRIPT = 'Hans';

interface ScriptFaces {
  readonly minor: ReadonlyMap<string, string>;
  readonly major: ReadonlyMap<string, string>;
}

/** An empty East Asian theme slot in a theme part, by the theme language's script. */
export const THEME_EAST_ASIAN_DEFAULTS: ScriptFaces = Object.freeze({
  minor: new Map([
    ['Hans', 'SimSun'],
    ['Hant', 'PMingLiU'],
    ['Jpan', 'MS Mincho'],
    ['Hang', 'Batang'],
  ]),
  major: new Map([
    ['Hans', 'SimHei'],
    ['Hant', 'MingLiU'],
    ['Jpan', 'MS Gothic'],
    ['Hang', 'Dotum'],
  ]),
});

/** The built-in theme's East Asian faces, used when the package has no theme part. */
export const BUILT_IN_EAST_ASIAN_FACES: ScriptFaces = Object.freeze({
  minor: new Map([
    ['Hans', 'DengXian'],
    ['Hant', 'PMingLiU'],
    ['Jpan', 'Yu Mincho'],
    ['Hang', 'Malgun Gothic'],
  ]),
  major: new Map([
    ['Hans', 'DengXian Light'],
    ['Hant', 'PMingLiU'],
    ['Jpan', 'Yu Gothic Light'],
    ['Hang', 'Malgun Gothic'],
  ]),
});

/**
 * Faces whose own character set is Simplified or Traditional Chinese, by lower-cased name.
 * A font's own character set decides; a font table `w:charset` does not override it.
 */
const CHINESE_FACES: ReadonlySet<string> = new Set([
  'simsun',
  'nsimsun',
  'simsun-extb',
  'simhei',
  'kaiti',
  'kaiti_gb2312',
  'fangsong',
  'fangsong_gb2312',
  'microsoft yahei',
  'microsoft yahei ui',
  'microsoft yahei light',
  'microsoft jhenghei',
  'microsoft jhenghei ui',
  'microsoft jhenghei light',
  'mingliu',
  'pmingliu',
  'mingliu_hkscs',
  'mingliu-extb',
  'pmingliu-extb',
  'dfkai-sb',
  'dengxian',
  'dengxian light',
  'lisu',
  'youyuan',
  'stsong',
  'stzhongsong',
  'stfangsong',
  'stkaiti',
  'stheiti',
  'stxihei',
  'stxingkai',
  'stliti',
  'sthupo',
  'stxinwei',
  'pingfang sc',
  'pingfang tc',
  'pingfang hk',
  'songti sc',
  'songti tc',
  'heiti sc',
  'heiti tc',
  'kaiti sc',
  'kaiti tc',
  '宋体',
  '新宋体',
  '黑体',
  '楷体',
  '仿宋',
  '微软雅黑',
  '微軟正黑體',
  '等线',
  '細明體',
  '新細明體',
  '標楷體',
  '华文楷体',
  '华文宋体',
  '华文黑体',
  '华文仿宋',
  '华文中宋',
  '华文细黑',
]);

/**
 * Common faces with another character set: their own set wins over the font table (probes
 * c16 and k-latin-ft86-ja give a GB2312 table entry to Meiryo and Verdana).
 */
const NON_CHINESE_FACES: ReadonlySet<string> = new Set([
  'arial',
  'aptos',
  'aptos display',
  'calibri',
  'calibri light',
  'cambria',
  'candara',
  'consolas',
  'constantia',
  'corbel',
  'courier new',
  'georgia',
  'segoe ui',
  'tahoma',
  'times new roman',
  'trebuchet ms',
  'verdana',
  'ms mincho',
  'ms gothic',
  'ms pmincho',
  'ms pgothic',
  'meiryo',
  'meiryo ui',
  'yu mincho',
  'yu gothic',
  'yu gothic ui',
  'yu gothic light',
  'hiragino mincho pron',
  'hiragino sans',
  'malgun gothic',
  'batang',
  'batangche',
  'gulim',
  'dotum',
  'gungsuh',
  'apple sd gothic neo',
]);

// `w:charset` values of the Chinese character sets: GB2312 and Big5.
const CHINESE_CHARSETS: ReadonlySet<string> = new Set(['86', '88']);

/**
 * Whether an East Asian face is a Chinese font. A known face answers by its own character set.
 * Any other face, typically one the reader lacks, answers by the font table's `w:charset`.
 * A vertical-writing name (`@SimSun`) is not one, and surrounding spaces do not count.
 */
export function isChineseFace(
  face: string | null | undefined,
  fontTableChineseFaces: readonly string[] | undefined
): boolean {
  const name = face?.trim().toLowerCase();
  if (!name || name.startsWith('@')) return false;
  if (CHINESE_FACES.has(name)) return true;
  if (NON_CHINESE_FACES.has(name)) return false;
  return fontTableChineseFaces?.includes(name) ?? false;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

/** Lower-cased names of the font table entries that declare a Chinese `w:charset`. */
export function fontTableChineseFaces(fontTableRoot: OoxmlElement | null): readonly string[] {
  if (!fontTableRoot) return [];
  const names: string[] = [];
  for (const font of fontTableRoot.children as readonly OoxmlNode[]) {
    if (!isElement(font) || font.localName !== 'font') continue;
    const name = font.attributes.find((attribute) => attribute.localName === 'name')?.value;
    if (!name || name.length > 128) continue;
    for (const child of font.children as readonly OoxmlNode[]) {
      if (!isElement(child) || child.localName !== 'charset') continue;
      const value = child.attributes.find((attribute) => attribute.localName === 'val')?.value;
      if (value && CHINESE_CHARSETS.has(value.toLowerCase())) {
        names.push(name.trim().toLowerCase());
      }
    }
    if (names.length >= 256) break;
  }
  return Object.freeze(names);
}
