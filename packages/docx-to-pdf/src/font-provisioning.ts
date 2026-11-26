/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { create as openFont } from 'fontkit';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { URL as NodeURL } from 'node:url';
import type { FontSource, FontSourceSubstitution } from '@docx-editor.dev/core';
import { createFontSource, defineFontResolver } from '@docx-editor.dev/core/editor';
import type { FontRequest } from '@docx-editor.dev/core/export';
import {
  CJK_FALLBACK_FAMILY as CJK_FAMILY,
  CJK_SUBSTITUTED_FAMILIES,
  FALLBACK_FACE_FAMILIES,
  GLYPH_FALLBACK_FACES,
  LOCALIZED_FONT_FAMILIES,
  canonicalFontFamily,
  genericStandInFamily,
  isGenericStandIn,
  namedFallbackFontResolver,
  namedSubstituteFamily,
  nearestFaceOrder,
  standInFontResolver,
  substitutionsToFallback,
  type FallbackFaceReader,
} from '@docx-editor.dev/core/layout';
import { FONT_ASSET_ROOT } from '@docx-editor.dev/fonts';
import { buildSystemFontIndex, indexedFace, type SystemFontIndex } from './system-font-index.ts';
import { derivedOnce, fontFiles } from './font-file-cache.ts';

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
/**
 * Every face this resolver can read: the symbol, mathematics, Arabic and emoji faces this
 * package carries, and the metric-compatible Latin substitutes from `@docx-editor.dev/fonts`,
 * which stand in here for families that package has no plan for. The CJK face is not listed:
 * its file is located on demand ({@link CjkFaceLocator}).
 */
const supplemental: readonly PackagedFace[] = [
  [
    'Noto Sans Symbols 2',
    new NodeURL('NotoSansSymbols2-Regular.ttf', FONT_ASSET_ROOT),
    400,
    'normal',
  ],
  ['Noto Sans Math', new NodeURL('NotoSansMath-Regular.ttf', FONT_ASSET_ROOT), 400, 'normal'],
  ['Noto Sans Arabic', new NodeURL('NotoSansArabic-Regular.ttf', FONT_ASSET_ROOT), 400, 'normal'],
  ['Twemoji Mozilla', new NodeURL('TwemojiMozilla.ttf', FONT_ASSET_ROOT), 400, 'normal'],
  ['Noto Emoji', new NodeURL('NotoEmoji-Regular.ttf', FONT_ASSET_ROOT), 400, 'normal'],
  ...latinSubstitute('Liberation Sans', 'LiberationSans'),
  ...latinSubstitute('Liberation Serif', 'LiberationSerif'),
  ...latinSubstitute('Liberation Mono', 'LiberationMono'),
  ...latinSubstitute('Carlito', 'Carlito'),
  ...latinSubstitute('Caladea', 'Caladea'),
];
/**
 * The fallback faces offered to every export: the shared glyph fallback order of
 * `@docx-editor.dev/core/layout`, so the editor and the PDF draw a missing glyph in one face.
 *
 * Offering a face costs nothing until a family the document uses needs it: the resolver
 * below reads a packaged file only for a family it is asked about.
 */
export const PDF_GLYPH_FALLBACKS: readonly FontRequest[] = GLYPH_FALLBACK_FACES;
const face = (
  family: string,
  weight = 400,
  style: 'normal' | 'italic' = 'normal'
): FontRequest => ({ family, weight, style });

export { CJK_SUBSTITUTED_FAMILIES };

/**
 * The localized names of the East Asian faces, in the language of the application that saved
 * the document. Each names the same font as its English name; a shared table.
 */
export const localizedFamilies: Record<string, string> =
  Object.fromEntries(LOCALIZED_FONT_FAMILIES);
/** The localized names of each English family in {@link localizedFamilies}. */
const localizedNamesOf = new Map<string, string[]>();
for (const [localized, english] of Object.entries(localizedFamilies)) {
  const names = localizedNamesOf.get(english);
  if (names) names.push(localized);
  else localizedNamesOf.set(english, [localized]);
}

/** The family a document names, read through the shared rules of `@docx-editor.dev/core/layout`. */
export const canonicalFamily = canonicalFontFamily;
const substituteFor = namedSubstituteFamily;

/** The packaged face that stands in for a family nothing else resolved; a shared rule. */
export const genericSubstituteFor = genericStandInFamily;

/** The faces this package ships, by case-folded name: never read from a system copy. */
const shippedFamilies = new Set<string>(
  [...FALLBACK_FACE_FAMILIES, CJK_FAMILY, 'TeX Gyre Adventor', 'Selawik'].map((family) =>
    family.toLowerCase()
  )
);

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

/** Whether an earlier origin paints a face, by family (ignoring case), weight, and style. */
const paintedFaces = (resolvedFaces: readonly FontRequest[] | undefined) => {
  const covered = new Set(
    (resolvedFaces ?? []).map((face) => `${face.family.toLowerCase()}/${face.weight}/${face.style}`)
  );
  return (family: string, weight: number, style: FaceStyle): boolean =>
    covered.has(`${family.toLowerCase()}/${weight}/${style}`);
};

const substitutionsTo = substitutionsToFallback;

/**
 * Substitutions that point every face of `family` at the nearest painted face of `target`,
 * another name of the same font, in the editor's order (`nearestFaceOrder`). A face that
 * `target` lacks then draws as a synthesized style of that face, as it does in the editor.
 */
const sameFontSubstitutions = (
  family: string,
  target: string,
  painted: (family: string, weight: number, style: FaceStyle) => boolean
): FontSourceSubstitution[] => {
  // A face name (`Meiryo Bold`) asks for its own weight and style in every face.
  const { bold, italic } = canonicalFamily(family);
  return [400, 700].flatMap((weight) =>
    (['normal', 'italic'] as const).flatMap((style) => {
      const nearest = nearestFaceOrder(
        bold || weight === 700 ? 700 : 400,
        italic || style === 'italic' ? 'italic' : 'normal'
      ).find(([w, s]) => painted(target, w, s));
      return nearest ? [{ from: face(family, weight, style), to: face(target, ...nearest) }] : [];
    })
  );
};

/** The four static faces of a family. */
const STATIC_FACES = [
  [400, 'normal'],
  [700, 'normal'],
  [400, 'italic'],
  [700, 'italic'],
] as const;

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
  // Annotated with the public `FontSource`, so the declarations of the resolvers below
  // name it through `@docx-editor.dev/core` rather than through a private build chunk.
  const readFaces = (
    faces: readonly PackagedFace[],
    signal: AbortSignal | undefined
  ): Promise<FontSource[]> =>
    Promise.all(
      faces.map(async ([family, file, weight, style]) => {
        const cached = await fontFiles.read(file, signal);
        const result = derivedOnce(cached, `source:${family}:${weight}:${style}:0`, () =>
          createFontSource(cached.bytes, face(family, weight, style))
        );
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
  const readSupplemental: FallbackFaceReader = (wanted, signal) =>
    readFaces(
      supplemental.filter(([family]) => wanted.has(family)),
      signal
    );
  const supplementalFonts = namedFallbackFontResolver(readSupplemental);

  /**
   * The CJK face from `@docx-editor.dev/fonts-cjk`, with the substitutions that point the
   * Word CJK families at it.
   *
   * Only a family no earlier origin paints goes to the CJK face. A family with a painted face
   * keeps it: its missing faces resolve to its nearest face through the stand-in, as a
   * synthesized style. A localized name whose English family is painted resolves to that
   * family, which is the same font, and so does an English name whose localized name is
   * painted (`Meiryo` supplied as `メイリオ`).
   *
   * Its own origin, so a package that is installed but cannot supply its face (a broken
   * install, a deployment without its `assets/`, a failed read) fails here alone and is
   * reported as a font origin failure. Every other packaged face still resolves, and the
   * stand-in covers the CJK families in that export.
   */
  const cjkFonts = defineFontResolver(async ({ families, signal, resolvedFaces }) => {
    const painted = paintedFaces(resolvedFaces);
    const paintsAny = (family: string): boolean =>
      STATIC_FACES.some(([weight, style]) => painted(family, weight, style));
    const aliases: FontSourceSubstitution[] = [];
    const planned = families.filter((family) => {
      if (substituteFor(family) !== CJK_FAMILY || paintsAny(family)) return false;
      const english = canonicalFamily(family).family;
      const sameFont = [
        ...(english === family ? [] : [english]),
        ...(localizedNamesOf.get(english) ?? []),
      ].find(paintsAny);
      if (sameFont === undefined) return true;
      aliases.push(...sameFontSubstitutions(family, sameFont, painted));
      return false;
    });
    if (!families.includes(CJK_FAMILY) && planned.length === 0)
      return { sources: [], substitutions: aliases };
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
      substitutions: [
        ...aliases,
        ...planned.flatMap((family) => substitutionsTo(family, CJK_FAMILY)),
      ],
    };
  });

  /**
   * The last word on a face nothing else covers, composed after the document's own embedded
   * fonts so it can never shadow one of them.
   *
   * Two answers. A family with no face at all renders in a packaged face of its class
   * ({@link genericSubstituteFor}); the export reports it. A family with some faces covered
   * points each other face at its nearest covered face, in the editor's order
   * (`nearestFaceOrder` in `@docx-editor.dev/core/layout`), which the renderer emboldens or
   * slants: every symbol face, most CJK faces, and a family that ships
   * in bold only.
   * Legacy symbol families never get a text stand-in; their private-use bullets belong to the
   * glyph fallback path.
   */
  const standInFonts = standInFontResolver(readSupplemental);

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
    isGenericSubstitution: isGenericStandIn,
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
/** The operating system's font folders, searched in full for a family the fixed rules lack. */
const systemFontRoots =
  process.platform === 'darwin'
    ? [
        '/System/Library/Fonts',
        '/Library/Fonts',
        join(homedir(), 'Library/Fonts'),
        '/Applications/Microsoft Word.app/Contents/Resources/DFonts',
      ]
    : process.platform === 'win32'
      ? [
          join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'),
          ...(process.env.LOCALAPPDATA
            ? [join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')]
            : []),
        ]
      : [
          '/usr/share/fonts',
          '/usr/local/share/fonts',
          join(homedir(), '.local/share/fonts'),
          join(homedir(), '.fonts'),
        ];
/** Internal factory: tests supply isolated trusted directories without mocking global fs. */
export function installedWordFontResolver(
  roots: readonly string[],
  indexRoots: readonly string[] = roots
) {
  // Built once, on the first family no fixed rule names, then shared by every export.
  let index: Promise<SystemFontIndex> | undefined;
  const systemIndex = () => (index ??= buildSystemFontIndex(indexRoots));
  /**
   * Every style of a family the fixed rules do not name, from the installed faces. A style
   * the family lacks reads its nearest face, which the renderer emboldens or slants.
   */
  const indexedSources = async (
    requested: string,
    family: string,
    bold: boolean,
    italic: boolean,
    signal: AbortSignal | undefined
  ): Promise<FontSource[]> => {
    // The faces this package ships come from the package, never from a system copy.
    if (shippedFamilies.has(family.toLowerCase())) return [];
    const installed = await systemIndex();
    if (signal?.aborted) throw signal.reason;
    const found: FontSource[] = [];
    // One face file serves at most one style: a style the family lacks resolves to the
    // nearest style that has a source, and the renderer emboldens or slants it.
    const used = new Set<string>();
    for (const [weight, style] of [
      [400, 'normal'],
      [700, 'normal'],
      [400, 'italic'],
      [700, 'italic'],
    ] as const) {
      const faceBold = bold || weight === 700;
      const faceItalic = italic || style === 'italic';
      const hit =
        indexedFace(installed, family, faceBold, faceItalic) ??
        (family === requested
          ? undefined
          : indexedFace(installed, requested, weight === 700, style === 'italic'));
      if (!hit || used.has(`${hit.path}#${hit.faceIndex}`)) continue;
      used.add(`${hit.path}#${hit.faceIndex}`);
      try {
        const file = await fontFiles.read(hit.path, signal);
        const source = derivedOnce(
          file,
          `source:${requested}:${weight}:${style}:${hit.faceIndex}`,
          () =>
            createFontSource(file.bytes, {
              ...face(requested, weight, style),
              faceIndex: hit.faceIndex,
            })
        );
        if (!('failure' in source)) found.push(source.source);
      } catch (error) {
        if (signal?.aborted) throw error;
        // An unreadable or oversized file resolves nothing for this style.
      }
    }
    return found;
  };
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
      Garamond: [
        ['GARA.ttf', 'GARA.TTF'],
        ['GARABD.ttf', 'GARABD.TTF'],
        ['GARAIT.ttf', 'GARAIT.TTF'],
        ['GARABDIT.ttf', 'GARABDIT.TTF'],
      ],
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
      if (!Object.hasOwn(names, family) && !Object.hasOwn(files, family)) {
        sources.push(...(await indexedSources(requested, family, bold, italic, signal)));
        continue;
      }
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
              const file = await fontFiles.read(join(root, filename), signal);
              // A collection is opened once per file to find the face by its name.
              const faceIndex = filename.toLowerCase().endsWith('.ttc')
                ? derivedOnce(file, `face:${family}:${faceBold}:${faceItalic}`, () => {
                    const collection = openFont(Buffer.from(file.bytes));
                    return 'fonts' in collection
                      ? collection.fonts.findIndex((font) =>
                          collectionFaceMatches(font.postscriptName, family, faceBold, faceItalic)
                        )
                      : -1;
                  })
                : 0;
              if (faceIndex < 0) continue;
              const source = derivedOnce(
                file,
                `source:${requested}:${weight}:${style}:${faceIndex}`,
                () => createFontSource(file.bytes, { ...face(requested, weight, style), faceIndex })
              );
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

/**
 * Read known Word font filenames from trusted OS font locations, and any other installed
 * family from an index of the OS font folders.
 */
export const installedWordFonts = installedWordFontResolver(wordFontRoots, systemFontRoots);
