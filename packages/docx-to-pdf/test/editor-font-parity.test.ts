/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The editor and the PDF export must lay a document out in the same faces.
//
// Both use one layout engine. They differ in where the fonts come from: the export reads the
// packaged faces from disk, and the editor asks its host for them. The font fallback rules are
// shared (`@docx-editor.dev/core/layout`), so a family that is missing, and a character that
// a face lacks, resolve to the same face in both. Each case here lays one paragraph out both
// ways and compares where the lines break and how tall they are.
//
// Small caps in a face without the `smcp` feature match here because this editor has no
// browser canvas. With one, the editor paints them through CSS and its measurer follows the
// browser; the export synthesizes them.
import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  composeFontOrigins,
  createDocxEditor,
  defineFontResolver,
  type FontResolutionRequest,
} from '@docx-editor.dev/core/editor';
import { linesOf, sha256FontBytes } from '@docx-editor.dev/core/layout';
import { cjkFonts } from '../../fonts-cjk/src/browser.ts';
import { packagedFonts } from '../../fonts/src/index.ts';
import { openExportSession } from '../src/open-session.ts';
import { docx } from './fixture.ts';

const run = (family: string, text: string): string =>
  `<w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>` +
  `<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const symbol = (font: string, char: string): string =>
  `<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:sym w:font="${font}" w:char="${char}"/></w:r>`;
/** One paragraph of `runs` seven times over, so the text wraps. */
const paragraph = (runs: string): string =>
  `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
  `${(runs + run('Arial', ' ')).repeat(7)}</w:p>`;

const SENTENCE = 'The quick brown fox jumps over';

const CASES: readonly (readonly [name: string, body: string, fetched: RegExp | null])[] = [
  ['a family with a metric-compatible substitute', paragraph(run('Arial', SENTENCE)), null],
  ['a missing family with a serif name', paragraph(run('Sagona', SENTENCE)), /LiberationSerif/],
  ['a missing family with no class', paragraph(run('Foo Grotesk', SENTENCE)), null],
  ['a missing family with a monospaced name', paragraph(run('Foo Mono', SENTENCE)), /Mono/],
  [
    'a missing family with a symbol name',
    paragraph(run('Example Symbols', 'abc = def')),
    /Symbols2/,
  ],
  ['a family with a named substitute', paragraph(run('Verdana', SENTENCE)), null],
  ['a family named with a style word', paragraph(run('Times New Roman Bold', SENTENCE)), /Serif/],
  ['a mathematics family', paragraph(run('Cambria Math', 'x + y ∑ z')), /NotoSansMath/],
  [
    'a symbol in a missing symbol font',
    paragraph(
      run('Arial', 'abcd ') + symbol('WP TypographicSymbols', '003D') + run('Arial', ' efgh')
    ),
    /Symbols2/,
  ],
  ['a symbol that the face lacks', paragraph(run('Arial', 'abcd ☐☒ efgh')), /Symbols2/],
  ['Arabic text in a Latin face', paragraph(run('Arial', 'abcd مرحبا بالعالم efgh')), /Arabic/],
  ['mathematical operators', paragraph(run('Arial', 'abcd ∑∫≤ ⟶ efgh')), /NotoSansMath/],
  ['mathematical letters', paragraph(run('Arial', 'abcd 𝑥𝑦 efgh')), /NotoSansMath/],
  ['emoji', paragraph(run('Arial', 'abcd 😀✅ efgh')), /Twemoji/],
  [
    // The document holds Times New Roman, which is also a glyph fallback face behind the
    // symbol faces. It must not draw the symbols before the symbol face loads.
    'symbols beside text in a face that is also a fallback face',
    paragraph(run('Calibri', 'abcd ■♠☐ efgh ') + run('Times New Roman', 'serif text')),
    /Symbols2/,
  ],
  [
    'small caps in a face without the feature',
    paragraph(
      `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:smallCaps/><w:sz w:val="24"/></w:rPr>` +
        `<w:t xml:space="preserve">The Quick Brown Fox</w:t></w:r>`
    ),
    null,
  ],
  ['a non-breaking hyphen', paragraph(run('Calibri', 'non‑breaking hyphen')), null],
  ['an East Asian family', paragraph(run('SimSun', '中文测试 abc')), /CJK/],
  ['East Asian text in a Latin face', paragraph(run('Arial', 'abcd 中文 efgh')), /CJK/],
];

const fontsDirectory = new URL('../../fonts/assets/', import.meta.url);
const cjkFace = new URL('../../fonts-cjk/assets/NotoSansCJKjp-Regular.otf', import.meta.url);

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** The editor's lines for `bytes`, with the files its host was asked to fetch. */
async function editorLines(bytes: Uint8Array) {
  const fetched: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    const file = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
    fetched.push(file);
    try {
      return Promise.resolve(
        new Response(new Uint8Array(readFileSync(new URL(file, fontsDirectory))))
      );
    } catch {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
  }) as typeof fetch;
  const cjkFetcher = ((_input: RequestInfo | URL) => {
    fetched.push('NotoSansCJKjp-Regular.otf');
    return Promise.resolve(new Response(new Uint8Array(readFileSync(cjkFace))));
  }) as typeof fetch;
  const origins = [
    packagedFonts({ fetcher, onFailure: () => {} }),
    cjkFonts({ fetcher: cjkFetcher, loading: 'wait', onFailure: () => {} }),
  ];
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    document: bytes,
    fonts: defineFontResolver((request: FontResolutionRequest) =>
      composeFontOrigins(origins as never, request)
    ),
  });
  cleanup = () => {
    editor.destroy();
    container.remove();
  };
  editor.attach(container);
  const painted = (): string =>
    [...container.querySelectorAll<HTMLElement>('.docx-line')]
      .map((line) => `${line.textContent?.length}/${line.style.height}`)
      .join();
  // Fallback faces load after the first layout, so wait until the lines stop changing.
  let last = '';
  for (let stable = 0, turn = 0; turn < 400 && stable < 10; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const now = `${editor.fontMeasurement().resolving}|${painted()}`;
    stable = now === last && now.startsWith('false|') ? stable + 1 : 0;
    last = now;
  }
  const lines = [...container.querySelectorAll<HTMLElement>('.docx-line')].map((line) => ({
    characters: line.textContent?.length ?? 0,
    // The surface paints at 96 pixels to the inch.
    height: (Number.parseFloat(line.style.height) * 0.75).toFixed(2),
  }));
  return { lines, fetched, measurer: editor.fontMeasurement().measurer };
}

/** The export's lines for `bytes`, from the packaged faces alone. */
async function exportLines(bytes: Uint8Array) {
  const opened = await openExportSession(bytes, { useSystemFonts: false });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return linesOf(await opened.session.layout()).map((line) => ({
      characters: line.spans.reduce((sum, span) => sum + span.text.length, 0),
      height: line.box.height.toFixed(2),
    }));
  } finally {
    opened.session.dispose();
  }
}

test.each(CASES)('the editor and the export lay out %s alike', async (_name, body, fetched) => {
  const bytes = docx(body);
  const [exported, edited] = [await exportLines(bytes), await editorLines(bytes)];
  expect(edited.measurer).toBe('shaped');
  expect(exported.length).toBeGreaterThan(0);
  expect(edited.lines).toEqual(exported);
  if (fetched) expect(edited.fetched.some((file) => fetched.test(file))).toBe(true);
});

test('a document whose faces cover its text loads no glyph fallback face', async () => {
  const { fetched } = await editorLines(docx(paragraph(run('Arial', SENTENCE))));
  expect(fetched.filter((file) => /Noto|Twemoji/.test(file))).toEqual([]);
});

test('a symbol that the face lacks loads the symbol face and nothing after it', async () => {
  const { fetched } = await editorLines(docx(paragraph(run('Arial', 'abcd ☐☒ efgh'))));
  expect(fetched.filter((file) => /Noto|Twemoji/.test(file))).toEqual([
    'NotoSansSymbols2-Regular.ttf',
  ]);
});

test('a fixed configuration that holds a fallback face uses it, with no request', async () => {
  const source = (family: string, file: string) => {
    const bytes = new Uint8Array(readFileSync(new URL(file, fontsDirectory)));
    return {
      request: { family, weight: 400, style: 'normal' as const },
      id: file,
      bytes,
      hash: sha256FontBytes(bytes),
      faceIndex: 0,
    };
  };
  const lines = async (sources: ReturnType<typeof source>[]) => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      document: docx(paragraph(run('Arial', 'abcd ☐☒ efgh'))),
      fonts: { sources },
    });
    cleanup = () => {
      editor.destroy();
      container.remove();
    };
    editor.attach(container);
    let last = '';
    for (let stable = 0, turn = 0; turn < 400 && stable < 10; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const now =
        `${editor.fontMeasurement().resolving}|` +
        [...container.querySelectorAll<HTMLElement>('.docx-line')]
          .map((line) => line.style.height)
          .join();
      stable = now === last && now.startsWith('false|') ? stable + 1 : 0;
      last = now;
    }
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    cleanup();
    cleanup = undefined;
    return last;
  };
  const arial = source('Arial', 'LiberationSans-Regular.ttf');
  const plain = await lines([arial]);
  const withSymbols = await lines([
    arial,
    source('Noto Sans Symbols 2', 'NotoSansSymbols2-Regular.ttf'),
  ]);
  // The symbol face is taller than the text face, so the lines that hold a symbol grow.
  expect(withSymbols).not.toBe(plain);
});
