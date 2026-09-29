/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { create as openFont } from 'fontkit';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, URL as NodeURL } from 'node:url';
import { createFontSource, defineFontResolver } from '@docx-editor.dev/core/editor';
import type { FontRequest } from '@docx-editor.dev/core/export';
import { FONT_ASSET_ROOT } from '@docx-editor.dev/fonts';

const assetRoot = new NodeURL(
  '../assets/',
  typeof __dirname === 'string' ? pathToFileURL(__dirname + '/').href : import.meta.url
);
type FaceStyle = 'normal' | 'italic';
type PackagedFace = readonly [
  family: string,
  file: string | NodeURL,
  weight: number,
  style: FaceStyle,
];
const latinSubstitute = (family: string, prefix: string): readonly PackagedFace[] =>
  (
    [
      ['Regular', 400, 'normal'],
      ['Bold', 700, 'normal'],
      ['Italic', 400, 'italic'],
      ['BoldItalic', 700, 'italic'],
    ] as const
  ).map(([suffix, weight, style]) => [
    family,
    new NodeURL(`${prefix}-${suffix}.ttf`, FONT_ASSET_ROOT),
    weight,
    style,
  ]);
/** The CJK fallback face. Its file comes from the optional `@docx-editor.dev/fonts-cjk`. */
const CJK_FAMILY = 'Noto Sans CJK JP';
/**
 * Every face this resolver can read: the symbol, mathematics, Arabic and emoji faces this
 * package carries, and the metric-compatible Latin substitutes from `@docx-editor.dev/fonts`,
 * which stand in here for families that package has no plan for. The CJK face is not listed:
 * its file is located on demand ({@link CjkFaceLocator}).
 */
const supplemental: readonly PackagedFace[] = [
  ['Noto Sans Symbols 2', new NodeURL('NotoSansSymbols2-Regular.ttf', assetRoot), 400, 'normal'],
  ['Noto Sans Math', new NodeURL('NotoSansMath-Regular.ttf', assetRoot), 400, 'normal'],
  ['Noto Sans Arabic', new NodeURL('NotoSansArabic-Regular.ttf', assetRoot), 400, 'normal'],
  ['Twemoji Mozilla', new NodeURL('TwemojiMozilla.ttf', assetRoot), 400, 'normal'],
  ['Noto Emoji', new NodeURL('NotoEmoji-Regular.ttf', assetRoot), 400, 'normal'],
  ...latinSubstitute('Liberation Sans', 'LiberationSans'),
  ...latinSubstitute('Liberation Serif', 'LiberationSerif'),
  ...latinSubstitute('Liberation Mono', 'LiberationMono'),
  ...latinSubstitute('Carlito', 'Carlito'),
  ...latinSubstitute('Caladea', 'Caladea'),
];
/**
 * The fallback faces offered to every export, small faces first.
 *
 * Offering a face costs nothing until a family the document uses needs it: the resolver
 * below reads a packaged file only for a family it is asked about.
 */
export const PDF_GLYPH_FALLBACKS: readonly FontRequest[] = [
  'Segoe UI Symbol',
  'Noto Sans Symbols 2',
  'Noto Sans Math',
  'Noto Sans Arabic',
  // Hebrew, and Latin, Greek or Cyrillic letters the faces above lack. A missing glyph falls
  // back to Times New Roman in the reference renderer. A host without it resolves the packaged
  // Liberation Serif, whose Latin letters share its widths but whose Hebrew runs about 12%
  // wider, so Hebrew in that face can wrap earlier.
  'Times New Roman',
  // Prefer available Word CJK faces; Noto Sans CJK JP from `@docx-editor.dev/fonts-cjk` is
  // the portable fallback when that package is installed.
  'SimSun',
  'Batang',
  CJK_FAMILY,
  // Color first: a COLR face paints its layers in the writer. The monochrome face stays
  // behind it for the few symbols the color set leaves out.
  'Twemoji Mozilla',
  'Noto Emoji',
].map((family) => ({ family, weight: 400, style: 'normal' }));
const face = (
  family: string,
  weight = 400,
  style: 'normal' | 'italic' = 'normal'
): FontRequest => ({ family, weight, style });

/**
 * Word families whose text a packaged face can carry when the family itself is absent.
 *
 * Helvetica is the one metric match here (Arial was drawn to its widths, and Liberation Sans
 * to Arial's). The CJK entries are coverage, not metrics: a document set in SimSun or
 * MS Mincho renders in Noto Sans CJK rather than refusing every ideograph, the same fall
 * back Word shows when the face is missing.
 */
const substitutes: Record<string, string> = {
  'Cambria Math': 'Noto Sans Math',
  Georgia: 'Liberation Serif',
  Verdana: 'Liberation Sans',
  Helvetica: 'Liberation Sans',
  ...Object.fromEntries(
    [
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
    ].map((family) => [family, CJK_FAMILY])
  ),
};
/**
 * The localized names Word writes for its East Asian faces, in the language of the Word
 * that saved the document. Word treats each as the same font; so does this resolver.
 */
const localizedFamilies: Record<string, string> = {
  宋体: 'SimSun',
  新宋体: 'NSimSun',
  黑体: 'SimHei',
  仿宋: 'FangSong',
  楷体: 'KaiTi',
  等线: 'DengXian',
  微软雅黑: 'Microsoft YaHei',
  微軟正黑體: 'Microsoft JhengHei',
  新細明體: 'PMingLiU',
  細明體: 'MingLiU',
  'ＭＳ 明朝': 'MS Mincho',
  'ＭＳ Ｐ明朝': 'MS PMincho',
  'ＭＳ ゴシック': 'MS Gothic',
  'ＭＳ Ｐゴシック': 'MS PGothic',
  'ＭＳ ＵＩ Ｇｏｔｈｉｃ': 'MS UI Gothic',
  メイリオ: 'Meiryo',
  游ゴシック: 'Yu Gothic',
  游明朝: 'Yu Mincho',
  '맑은 고딕': 'Malgun Gothic',
  바탕: 'Batang',
  굴림: 'Gulim',
  돋움: 'Dotum',
};
/**
 * The family a document names, read as Word reads it.
 *
 * A converter that writes face names for family names produces `Times New Roman Bold`, and a
 * Chinese Word writes `宋体` for SimSun. Both name a face this resolver knows; neither is a
 * key in its tables. The style words fold into the request's weight and style, and a
 * localized name resolves to the English one the tables use. The face is still registered
 * under the name the document wrote, which is the name layout asks for.
 */
export function canonicalFamily(family: string): {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
} {
  // No regular expression: the name is file-derived and unbounded, and a lazy prefix against
  // a greedy run of spaces is quadratic in the spaces. A real face name is short; anything
  // longer than Word's 31-character family limit by a wide margin is left as it is.
  let base = family;
  let bold = false;
  let italic = false;
  if (family.length <= 128) {
    const lower = family.toLowerCase();
    for (const [suffix, flags] of [
      [' bold italic', [true, true]],
      [' bolditalic', [true, true]],
      [' bold', [true, false]],
      [' italic', [false, true]],
    ] as const) {
      if (!lower.endsWith(suffix) || lower.length === suffix.length) continue;
      base = family.slice(0, family.length - suffix.length).trimEnd();
      [bold, italic] = flags;
      break;
    }
  }
  return {
    family: Object.hasOwn(localizedFamilies, base) ? localizedFamilies[base]! : base,
    bold,
    italic,
  };
}
/**
 * The families `@docx-editor.dev/fonts` substitutes when the document names them exactly.
 * Named through a style word or a localized name, they reach this resolver instead.
 */
const packagedSubstitutes: Record<string, string> = {
  Calibri: 'Carlito',
  Cambria: 'Caladea',
  'Times New Roman': 'Liberation Serif',
  Arial: 'Liberation Sans',
  'Courier New': 'Liberation Mono',
  'Century Gothic': 'TeX Gyre Adventor',
};
const substituteFor = (family: string): string | undefined => {
  const canonical = canonicalFamily(family).family;
  if (Object.hasOwn(substitutes, canonical)) return substitutes[canonical];
  if (canonical !== family && Object.hasOwn(packagedSubstitutes, canonical))
    return packagedSubstitutes[canonical];
  return undefined;
};

/**
 * The packaged face that stands in for a family nothing else resolved.
 *
 * Word does the same when a document names a font the machine lacks: it picks a face of the
 * same class and renders. The class is read from the name, which is all a resolver sees:
 * monospaced names to Liberation Mono, symbol names to Noto Sans Symbols 2, serif names to
 * Liberation Serif, everything else to Liberation Sans. The metrics are not the missing font's,
 * and the export says so with an information diagnostic, but the page shows the text.
 *
 * A symbol name must not get a text face: `Segoe UI Symbol` heads the glyph fallback list, and
 * a Liberation Sans stand-in there drew every Hebrew letter an Arabic face lacks in Liberation
 * Sans, before the Times New Roman entry was reached.
 */
export function genericSubstituteFor(family: string): string {
  const name = canonicalFamily(family).family;
  if (/mono|courier|consol|menlo|typewriter|\bcode\b|fixed/i.test(name)) return 'Liberation Mono';
  if (/symbol/i.test(name)) return 'Noto Sans Symbols 2';
  if (/sans/i.test(name)) return 'Liberation Sans';
  if (
    /serif|roman|garamond|georgia|times|book|baskerville|cambria|minion|palatino|century|didot|caslon|constantia|sagona|lora|merriweather|playfair|charter|bodoni|perpetua|rockwell|goudy|bembo|sabon|antiqua/i.test(
      name
    )
  )
    return 'Liberation Serif';
  return 'Liberation Sans';
}

/**
 * The families the generic stand-in must not touch: the ones this package answers for by
 * name, and the legacy symbol-encoded faces. A Symbol or Wingdings run draws private-use
 * codepoints that only those faces carry; a text face standing in has no glyph for them,
 * where the glyph fallback path maps them to their Unicode twins in a symbol face.
 */
const knownFamilies = new Set<string>([
  ...supplemental.map(([family]) => family),
  CJK_FAMILY,
  ...Object.keys(substitutes),
  ...Object.keys(packagedSubstitutes),
  ...Object.values(packagedSubstitutes),
  'Symbol',
  'Wingdings',
  'Wingdings 2',
  'Wingdings 3',
  'Webdings',
  'MT Extra',
]);
/**
 * The CJK face and the Word families planned onto it. The plan holds only when that face
 * resolves, so the stand-in covers one that is still uncovered when it runs. A document can
 * name the CJK face itself, so it is here too.
 */
const cjkWordFamilies = new Set<string>([
  CJK_FAMILY,
  ...Object.keys(substitutes).filter((family) => substitutes[family] === CJK_FAMILY),
]);

/** The optional package that carries the CJK face. */
const CJK_PACKAGE = '@docx-editor.dev/fonts-cjk';

/** Where the CJK face file is, or `null` when `@docx-editor.dev/fonts-cjk` is not installed. */
export type CjkFaceLocator = () => Promise<string | NodeURL | null>;

/**
 * Whether `error` says that `specifier` itself is not installed, as Node's ESM loader, its
 * CommonJS loader and Bun each phrase it. A package that is installed but broken (a missing
 * `dist/` file, a missing dependency of its own) names another module, so it does not match:
 * that failure propagates instead of reading as "not installed".
 */
export function isPackageNotFound(error: unknown, specifier: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false;
  if (typeof message !== 'string') return false;
  return [`Cannot find package '${specifier}'`, `Cannot find module '${specifier}'`].some(
    (prefix) => message.startsWith(prefix)
  );
}

/** Locate the CJK face in `@docx-editor.dev/fonts-cjk`, or `null` when it is not installed. */
export async function importCjkFace(): Promise<NodeURL | null> {
  let module: { NOTO_SANS_CJK_JP_URL?: unknown };
  try {
    // A literal specifier, so a file tracer that follows it ships the package with a
    // deployment. `webpackIgnore` leaves the import to Node at run time in the bundlers that
    // read it, so such a bundle builds without the optional package.
    module = await import(/* webpackIgnore: true */ '@docx-editor.dev/fonts-cjk');
  } catch (error) {
    if (isPackageNotFound(error, CJK_PACKAGE)) return null;
    throw error;
  }
  const file = module.NOTO_SANS_CJK_JP_URL as { href?: unknown } | undefined;
  if (typeof file?.href !== 'string')
    throw new TypeError(`${CJK_PACKAGE} does not export NOTO_SANS_CJK_JP_URL`);
  return new NodeURL(file.href);
}

/** Characters only the CJK face carries among the packaged faces: Hangul, kana, ideographs. */
const CJK_TEXT =
  /[\u1100-\u11ff\u2e80-\u2fdf\u3000-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]|[\u{20000}-\u{3ffff}]/u;

/**
 * Substitutions that point every face of `family` at `target`: at the one packaged face when
 * the target is a single-face Noto family, at the matching weight and style otherwise.
 */
const substitutionsTo = (family: string, target: string) => {
  const { bold, italic } = canonicalFamily(family);
  return [400, 700].flatMap((weight) =>
    (['normal', 'italic'] as const).map((style) => ({
      from: face(family, weight, style),
      // The packaged CJK, symbol and mathematics faces come in one weight and one style.
      to: target.startsWith('Noto')
        ? face(target)
        : face(
            target,
            bold || weight === 700 ? 700 : 400,
            italic || style === 'italic' ? 'italic' : 'normal'
          ),
    }))
  );
};

/**
 * The packaged resolvers, over one way to locate the CJK face.
 *
 * The locator runs at most once per instance, and its answer holds for the process: a
 * package is installed or it is not. Whether the face resolved is decided per export: a Word
 * CJK family that no source covers takes the generic stand-in of its class, which the export
 * reports. When the locator found no package, missing CJK glyphs also name it. Tests supply
 * their own locator.
 */
export function packagedFontResolvers(locateCjkFace: CjkFaceLocator = importCjkFace) {
  let located: Promise<string | NodeURL | null> | undefined;
  let cjkMissing = false;
  const cjkFace = () =>
    (located ??= locateCjkFace().then(
      (file) => {
        cjkMissing = file === null;
        return file;
      },
      (error: unknown) => {
        // A package that is installed but broken supplies no face either.
        cjkMissing = true;
        throw error;
      }
    ));
  const readFaces = (faces: readonly PackagedFace[], signal: AbortSignal | undefined) =>
    Promise.all(
      faces.map(async ([family, file, weight, style]) => {
        const bytes = new Uint8Array(await readFontFile(file, signal));
        const result = createFontSource(bytes, face(family, weight, style));
        if ('failure' in result) throw new Error(`Invalid packaged PDF font: ${String(file)}`);
        return result.source;
      })
    );

  /**
   * Packaged faces, read on demand.
   *
   * `families` is every family the document names plus every glyph fallback the caller
   * requested, so a packaged face is opened when something asked for it, by its own name or
   * as the substitute for a family the document uses. The CJK face is not here: see
   * `cjkFonts`.
   */
  const supplementalFonts = defineFontResolver(async ({ families, signal }) => {
    const wanted = new Set<string>();
    for (const family of families) {
      wanted.add(family);
      const target = substituteFor(family);
      if (target) wanted.add(target);
    }
    const sources = await readFaces(
      supplemental.filter(([family]) => wanted.has(family)),
      signal
    );
    return {
      sources,
      substitutions: families.flatMap((family) => {
        const target = substituteFor(family);
        return target && target !== CJK_FAMILY ? substitutionsTo(family, target) : [];
      }),
    };
  });

  /**
   * The CJK face from `@docx-editor.dev/fonts-cjk`, with the substitutions that point the
   * Word CJK families at it.
   *
   * Its own origin, so a package that is installed but cannot supply its face (a broken
   * install, a deployment without its `assets/`, a failed read) fails here alone and is
   * reported as a font origin failure. Every other packaged face still resolves, and the
   * stand-in covers the CJK families in that export.
   */
  const cjkFonts = defineFontResolver(async ({ families, signal }) => {
    const planned = families.filter((family) => substituteFor(family) === CJK_FAMILY);
    if (!families.includes(CJK_FAMILY) && planned.length === 0) return { sources: [] };
    let sources;
    try {
      const file = await cjkFace();
      if (!file) return { sources: [] };
      sources = await readFaces([[CJK_FAMILY, file, 400, 'normal']], signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${CJK_PACKAGE} could not supply its face: ${detail}`, { cause: error });
    }
    return {
      sources,
      substitutions: planned.flatMap((family) => substitutionsTo(family, CJK_FAMILY)),
    };
  });

  /**
   * The last word on a face nothing else covers, composed after the document's own embedded
   * fonts so it can never shadow one of them.
   *
   * Two answers. A family with no face at all renders in a packaged face of its class
   * ({@link genericSubstituteFor}); the export reports it. A family whose regular face is
   * covered but whose bold or italic is not points those at the regular face, as Word does
   * when it emboldens a font that ships in one weight: every symbol face, most CJK faces.
   * Legacy symbol families never get a text stand-in; their private-use bullets belong to the
   * glyph fallback path.
   */
  const standInFonts = defineFontResolver(async ({ families, signal, resolvedFaces }) => {
    const covered = new Set(
      (resolvedFaces ?? []).map(
        (face) => `${face.family.toLowerCase()}/${face.weight}/${face.style}`
      )
    );
    const has = (family: string, weight: number, style: FaceStyle) =>
      covered.has(`${family.toLowerCase()}/${weight}/${style}`);
    const faces = [
      [400, 'normal'],
      [700, 'normal'],
      [400, 'italic'],
      [700, 'italic'],
    ] as const;
    const substitutions: { from: FontRequest; to: FontRequest }[] = [];
    const wanted = new Set<string>();
    for (const family of families) {
      if (has(family, 400, 'normal')) {
        for (const [weight, style] of faces)
          if (!has(family, weight, style))
            substitutions.push({ from: face(family, weight, style), to: face(family) });
        continue;
      }
      // A Word CJK family reaching here is uncovered: its plan needed a face that did not
      // resolve in this export.
      const canonical = canonicalFamily(family).family;
      if (knownFamilies.has(canonical) && !cjkWordFamilies.has(canonical)) continue;
      const target = genericSubstituteFor(family);
      wanted.add(target);
      const { bold, italic } = canonicalFamily(family);
      for (const [weight, style] of faces)
        substitutions.push({
          from: face(family, weight, style),
          to: face(
            target,
            bold || weight === 700 ? 700 : 400,
            italic || style === 'italic' ? 'italic' : 'normal'
          ),
        });
    }
    const sources = await readFaces(
      supplemental.filter(([family]) => wanted.has(family)),
      signal
    );
    return { sources, substitutions };
  });

  return {
    supplementalFonts,
    cjkFonts,
    standInFonts,
    /**
     * Whether a face resolved through the generic stand-in rather than a metric-compatible
     * plan: a substitution whose family this package does not answer for, or a Word CJK
     * family in its stand-in rather than the CJK face. The writer reports these, since the
     * page carries the text in another font's metrics.
     */
    isGenericSubstitution(family: string, sourceFamily: string): boolean {
      if (family === sourceFamily) return false;
      const canonical = canonicalFamily(family).family;
      if (cjkWordFamilies.has(canonical)) return sourceFamily === genericSubstituteFor(family);
      return !knownFamilies.has(canonical);
    },
    /**
     * What a missing-glyph report adds for `text`: the package to install, when the text is
     * CJK and the lookup found no usable package. Empty otherwise.
     */
    missingGlyphHint(text: string): string {
      return cjkMissing && CJK_TEXT.test(text)
        ? `; install ${CJK_PACKAGE} for Chinese, Japanese, and Korean text`
        : '';
    },
  };
}

export const {
  supplementalFonts,
  cjkFonts,
  standInFonts,
  isGenericSubstitution,
  missingGlyphHint,
} = packagedFontResolvers();

const wordFontRoots =
  process.platform === 'darwin'
    ? [
        '/System/Library/Fonts/Supplemental',
        '/Library/Fonts',
        join(homedir(), 'Library/Fonts'),
        '/Applications/Microsoft Word.app/Contents/Resources/DFonts',
      ]
    : process.platform === 'win32'
      ? [join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]
      : [
          '/usr/share/fonts/truetype/msttcorefonts',
          '/usr/share/fonts/truetype/msttcore',
          join(homedir(), '.local/share/fonts'),
        ];
/** Internal factory: tests supply isolated trusted directories without mocking global fs. */
export function installedWordFontResolver(roots: readonly string[]) {
  return defineFontResolver(async ({ families, defaultFamily, signal }) => {
    // Filename stems that take Word's ` Bold` / `bd` style suffixes.
    const names: Record<string, readonly string[]> = {
      Arial: ['Arial', 'arial'],
      'Times New Roman': ['Times New Roman', 'times'],
      'Courier New': ['Courier New', 'cour'],
      Georgia: ['Georgia', 'georgia'],
      Verdana: ['Verdana', 'verdana'],
      Calibri: ['Calibri', 'calibri'],
      'Segoe UI Symbol': ['Segoe UI Symbol', 'seguisym'],
      SimSun: ['SimSun', 'simsun'],
      Batang: ['Batang', 'batang'],
      Cambria: ['Cambria', 'cambria'],
      'Cambria Math': ['Cambria Math'],
      'MS Gothic': ['MS Gothic', 'msgothic'],
      'MS PGothic': ['MS PGothic'],
      'MS UI Gothic': ['MS UI Gothic'],
      'Arial Narrow': ['Arial Narrow', 'ArialNarrow'],
      'Malgun Gothic': ['malgun'],
      // Legacy symbol-encoded faces. A Word bullet is the font's own byte plus 0xF000
      // (U+F0B7 in Symbol), a private-use codepoint only these faces carry — and the face
      // also SIZES the line it sits on, because a 12 pt Symbol ascends 12.06 pt where a
      // 12 pt text face ascends 11.52. Without them the glyph falls to the shared symbol
      // fallback, which has neither the right outline nor the right ascent.
      Symbol: ['Symbol', 'symbol'],
      Wingdings: ['Wingdings', 'wingding'],
      'Wingdings 2': ['Wingdings 2', 'wingdng2'],
      'Wingdings 3': ['Wingdings 3', 'wingdng3'],
      Webdings: ['Webdings', 'webdings'],
    };
    // Files named by face rather than by suffix rule, in the order regular, bold, italic,
    // bold italic. A collection lists one file for every face; the face is picked by name.
    const files: Record<string, readonly [string[], string[], string[], string[]]> = {
      Aptos: [['Aptos.ttf'], ['Aptos-Bold.ttf'], ['Aptos-Italic.ttf'], ['Aptos-Bold-Italic.ttf']],
      'Aptos Narrow': [
        ['Aptos-Narrow.ttf'],
        ['Aptos-Narrow-Bold.ttf'],
        ['Aptos-Narrow-Italic.ttf'],
        ['Aptos-Narrow-Bold-Italic.ttf'],
      ],
      Helvetica: [['Helvetica.ttc'], ['Helvetica.ttc'], ['Helvetica.ttc'], ['Helvetica.ttc']],
      SimHei: [['SimHei.ttf', 'simhei.ttf'], [], [], []],
      FangSong: [['Fangsong.ttf', 'simfang.ttf'], [], [], []],
      KaiTi: [['Kaiti.ttf', 'simkai.ttf'], [], [], []],
      DengXian: [['Deng.ttf'], ['Dengb.ttf'], [], []],
      'MS Mincho': [['msmincho.ttc'], [], [], []],
      'MS PMincho': [['msmincho.ttc'], [], [], []],
      'Microsoft YaHei': [['msyh.ttc'], ['msyhbd.ttc'], [], []],
      Meiryo: [['meiryo.ttc'], ['meiryob.ttc'], [], []],
      MingLiU: [['mingliu.ttc'], [], [], []],
      PMingLiU: [['mingliu.ttc'], [], [], []],
      Gulim: [['gulim.ttc'], [], [], []],
      Dotum: [['gulim.ttc'], [], [], []],
    };
    const sources = [];
    for (const requested of new Set([...families, ...(defaultFamily ? [defaultFamily] : [])])) {
      const { family, bold, italic } = canonicalFamily(requested);
      if (!Object.hasOwn(names, family) && !Object.hasOwn(files, family)) continue;
      for (const [weight, style] of [
        [400, 'normal'],
        [700, 'normal'],
        [400, 'italic'],
        [700, 'italic'],
      ] as const) {
        // `Times New Roman Bold` at weight 400 is the bold file; at 700 it is the same file.
        const faceBold = bold || weight === 700;
        const faceItalic = italic || style === 'italic';
        const slot = (faceBold ? 1 : 0) + (faceItalic ? 2 : 0);
        const [suffix, short] = [
          ['', ''],
          [' Bold', 'bd'],
          [' Italic', 'i'],
          [' Bold Italic', 'bi'],
        ][slot]!;
        let found = false;
        for (const root of roots) {
          if (found) break;
          const shortSuffix = ['Georgia', 'Verdana', 'Calibri', 'Cambria'].includes(family)
            ? (({ bd: 'b', bi: 'z' } as Record<string, string>)[short] ?? short)
            : short;
          const candidates = (names[family] ?? []).flatMap((name) => [
            name + suffix + '.ttf',
            name + shortSuffix + '.ttf',
          ]);
          candidates.push(...(files[family]?.[slot] ?? []));
          if (slot === 0 && ['Cambria', 'Cambria Math'].includes(family))
            candidates.push('Cambria.ttc', 'cambria.ttc');
          if (slot === 0 && ['MS Gothic', 'MS PGothic', 'MS UI Gothic'].includes(family))
            candidates.push('msgothic.ttc', 'MSGOTHIC.TTC');
          if (slot === 0) {
            if (family === 'SimSun') candidates.push('Simsun.ttc', 'simsun.ttc');
            if (family === 'Batang') candidates.push('batang.ttc', 'Batang.ttc');
          }
          for (const filename of new Set(candidates)) {
            if (signal?.aborted) throw signal.reason;
            try {
              const bytes = new Uint8Array(await readFontFile(join(root, filename), signal));
              let faceIndex = 0;
              if (filename.toLowerCase().endsWith('.ttc')) {
                const collection = openFont(Buffer.from(bytes));
                if (!('fonts' in collection)) continue;
                faceIndex = collection.fonts.findIndex((font) =>
                  collectionFaceMatches(font.postscriptName, family, faceBold, faceItalic)
                );
                if (faceIndex < 0) continue;
              }
              const source = createFontSource(bytes, {
                ...face(requested, weight, style),
                faceIndex,
              });
              if ('failure' in source) continue;
              sources.push(source.source);
              found = true;
              break;
            } catch (error) {
              if (signal?.aborted) throw error;
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }
          if (found) break;
        }
      }
    }
    return { sources };
  });
}

/**
 * Whether a collection member is the requested face: its PostScript name is the family
 * with the style words appended, spaces and hyphens aside (`Helvetica-BoldOblique`,
 * `MicrosoftYaHei-Bold`, `MS-Mincho`). Oblique is a face's own word for italic.
 */
function collectionFaceMatches(
  postscriptName: unknown,
  family: string,
  bold: boolean,
  italic: boolean
): boolean {
  if (typeof postscriptName !== 'string') return false;
  const actual = postscriptName
    .replace(/[- ]/g, '')
    .replace(/Oblique$/, 'Italic')
    .toLowerCase();
  const expected = `${family.replace(/[- ]/g, '')}${bold ? 'Bold' : ''}${italic ? 'Italic' : ''}`;
  return actual === expected.toLowerCase();
}

/** Read only fixed, known Word font filenames from trusted OS font locations. */
export const installedWordFonts = installedWordFontResolver(wordFontRoots);

async function readFontFile(path: string | NodeURL, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw signal.reason;
  // Check the local size before allocation.
  if ((await stat(path)).size > 32 * 1024 * 1024) throw new RangeError('Local font exceeds 32 MiB');
  // Let the read itself observe the signal, so a cancelled export does not finish mapping a
  // 16 MB face first. Node's fs accepts only its own realm's `AbortSignal`, and `instanceof`
  // cannot tell: a DOM shim can install an `AbortSignal` global that passes the check and is
  // still refused with `ERR_INVALID_ARG_TYPE`. So the read is asked, and a refused signal
  // falls back to the bounded read with the signal checked around it, as before.
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path, signal ? { signal } : undefined);
  } catch (error) {
    if (!signal || (error as { code?: string }).code !== 'ERR_INVALID_ARG_TYPE') throw error;
    bytes = await readFile(path);
  }
  if (signal?.aborted) throw signal.reason;
  return bytes;
}
