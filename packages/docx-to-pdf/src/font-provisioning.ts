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

const assetRoot = new NodeURL(
  '../assets/',
  typeof __dirname === 'string' ? pathToFileURL(__dirname + '/').href : import.meta.url
);
const supplemental = [
  ['Noto Sans Symbols 2', 'NotoSansSymbols2-Regular.ttf'],
  ['Noto Sans Math', 'NotoSansMath-Regular.ttf'],
  ['Noto Sans Arabic', 'NotoSansArabic-Regular.ttf'],
  ['Noto Sans CJK JP', 'NotoSansCJKjp-Regular.otf'],
  ['Noto Emoji', 'NotoEmoji-Regular.ttf'],
] as const;
export const PDF_GLYPH_FALLBACKS: readonly FontRequest[] = [
  'Segoe UI Symbol',
  'Noto Sans Symbols 2',
  'Noto Sans Math',
  'Noto Sans Arabic',
  // Prefer available Word CJK faces; packaged Noto remains the portable fallback.
  'SimSun',
  'Batang',
  'Noto Sans CJK JP',
  'Noto Emoji',
].map((family) => ({ family, weight: 400, style: 'normal' }));
const face = (
  family: string,
  weight = 400,
  style: 'normal' | 'italic' = 'normal'
): FontRequest => ({ family, weight, style });

export const supplementalFonts = defineFontResolver(async ({ families, signal }) => {
  const sources = await Promise.all(
    supplemental.map(async ([family, file]) => {
      const bytes = new Uint8Array(await readFontFile(new NodeURL(file, assetRoot), signal));
      const result = createFontSource(bytes, face(family));
      if ('failure' in result) throw new Error(`Invalid packaged PDF font: ${file}`);
      return result.source;
    })
  );
  const substitutes: Record<string, string> = {
    'Cambria Math': 'Noto Sans Math',
    'MS Gothic': 'Noto Sans CJK JP',
    Georgia: 'Liberation Serif',
    Verdana: 'Liberation Sans',
  };
  return {
    sources,
    substitutions: families.flatMap((family) => {
      const target = Object.hasOwn(substitutes, family) ? substitutes[family] : undefined;
      return target
        ? [400, 700].flatMap((weight) =>
            (['normal', 'italic'] as const).map((style) => ({
              from: face(family, weight, style),
              to: face(
                target,
                target.startsWith('Noto') ? 400 : weight,
                target.startsWith('Noto') ? 'normal' : style
              ),
            }))
          )
        : [];
    }),
  };
});

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
    };
    const sources = [];
    for (const family of new Set([...families, ...(defaultFamily ? [defaultFamily] : [])])) {
      if (!Object.hasOwn(names, family)) continue;
      for (const [weight, style, suffix, short] of [
        [400, 'normal', '', ''],
        [700, 'normal', ' Bold', 'bd'],
        [400, 'italic', ' Italic', 'i'],
        [700, 'italic', ' Bold Italic', 'bi'],
      ] as const) {
        let found = false;
        for (const root of roots) {
          const shortSuffix = ['Georgia', 'Verdana', 'Calibri', 'Cambria'].includes(family)
            ? (({ bd: 'b', bi: 'z' } as Record<string, string>)[short] ?? short)
            : short;
          const candidates = names[family]!.flatMap((name) => [
            name + suffix + '.ttf',
            name + shortSuffix + '.ttf',
          ]);
          if (weight === 400 && style === 'normal' && ['Cambria', 'Cambria Math'].includes(family))
            candidates.push('Cambria.ttc', 'cambria.ttc');
          if (
            weight === 400 &&
            style === 'normal' &&
            ['MS Gothic', 'MS PGothic', 'MS UI Gothic'].includes(family)
          )
            candidates.push('msgothic.ttc', 'MSGOTHIC.TTC');
          if (weight === 400 && style === 'normal') {
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
                faceIndex = collection.fonts.findIndex(
                  (font) =>
                    typeof font.postscriptName === 'string' &&
                    font.postscriptName.replace(/[- ]/g, '') === family.replace(/[- ]/g, '')
                );
                if (faceIndex < 0) continue;
              }
              const source = createFontSource(bytes, { ...face(family, weight, style), faceIndex });
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

/** Read only fixed, known Word font filenames from trusted OS font locations. */
export const installedWordFonts = installedWordFontResolver(wordFontRoots);

async function readFontFile(path: string | NodeURL, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw signal.reason;
  // Check the local size before allocation. Signals can come from another JS realm;
  // Node fs rejects those, so observe them before and after this bounded file read.
  if ((await stat(path)).size > 32 * 1024 * 1024) throw new RangeError('Local font exceeds 32 MiB');
  const bytes = await readFile(path);
  if (signal?.aborted) throw signal.reason;
  return bytes;
}
