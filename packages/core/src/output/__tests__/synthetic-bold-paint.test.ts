// Screen paint puts synthesized-bold glyphs where layout put them.
//
// Layout gives each inked glyph of a bold run in a face without bold 1/50 em of extra advance, as
// Word does. A browser emboldens such a face but draws it at the face's own advances, so paint
// adds the extra as letter spacing and takes it back from spaces. The model browser here draws
// every character one em wide at the run's size, plus the spacing paint asks for. As in
// Chromium, letter spacing widens every character and word spacing only U+0020 and U+00A0.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  layoutSemanticDocument,
  sha256FontBytes,
} from '@docx-editor.dev/core/layout';
import { styleForFontSlot } from '../../layout/script-itemization.ts';
import {
  linesOf,
  type LineRecord,
  type StyleSpanRecord,
  type TextMeasurer,
} from '../../layout/semantic-records.ts';
import { syntheticBoldAdvancePt } from '../../layout/synthetic-bold.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

await initializeHarfBuzz();

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const inked = (text: string) => [...text].filter((character) => !/\s/u.test(character)).length;
const wordSeparators = (text: string) =>
  [...text].filter((c) => c === ' ' || c === '\u00a0').length;
/** The model browser: one em for every character, bold or not. */
const browser: TextMeasurer = {
  measure: (text, style) => text.length * (style.fontSizePt + style.characterSpacingPt),
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};
// Every bold run synthesizes its bold here, as with a family that has no bold face. Blanks keep
// their advance.
const measurer: TextMeasurer = {
  ...browser,
  measure: (text, style) =>
    browser.measure(text, style) + (style.bold ? inked(text) * syntheticBoldAdvancePt(style) : 0),
  syntheticBold: (style) => style.bold,
};

function paint(runs: string, jc: string, width: number, using = measurer) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>${runs}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 0, {
    measurer: using,
    geometry: {
      width: width + 20,
      height: 900,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const elements = Array.from(host.querySelectorAll<HTMLElement>('.docx-line'));
  return linesOf(result).map((line, index) => ({
    line,
    runs: Array.from(elements[index]!.querySelectorAll<HTMLElement>('.layout-run-text')),
  }));
}

/** The advance a browser draws a span's text at before spacing: its face's own advances. */
type NaturalWidth = (span: StyleSpanRecord, text: string) => number;
const oneEm: NaturalWidth = (span, text) => text.length * span.style.fontSizePt;

/** Where inline flow starts each painted run, in the model browser. */
function paintedOrigins(
  line: LineRecord,
  runs: readonly HTMLElement[],
  natural: NaturalWidth
): number[] {
  const spans = line.spans.filter((span) => span.text !== '');
  let x = spans[0]?.box.x ?? 0;
  return runs.map((run, index) => {
    const span = spans[index]!;
    x += parseFloat(run.style.marginLeft || '0');
    const origin = x;
    const text = run.textContent ?? '';
    x +=
      natural(span, text) +
      text.length * parseFloat(run.style.letterSpacing || '0') +
      wordSeparators(text) * parseFloat(run.style.wordSpacing || '0');
    return origin;
  });
}

const run = (text: string, properties = '<w:b/>') =>
  `<w:r><w:rPr>${properties}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

test('a synthesized-bold run paints its extra advance as letter spacing, and spaces keep theirs', () => {
  const [{ line, runs }] = paint(run('Bold head') + run(' plain', ''), 'left', 400);
  const bold = runs.find((element) => element.textContent?.startsWith('Bold'))!;
  const plain = runs.find((element) => element.textContent?.includes('plain'))!;
  expect(parseFloat(bold.style.letterSpacing)).toBeCloseTo(11 / 50, 6);
  expect(parseFloat(bold.style.wordSpacing)).toBeCloseTo(-11 / 50, 6);
  expect(plain.style.letterSpacing).toBe('');
  expect(line!.spans.filter((span) => span.syntheticBold).map((span) => span.text)).toEqual([
    'Bold ',
    'head',
  ]);
});

test('character spacing and the extra advance add up', () => {
  const [{ runs }] = paint(run('Spaced', '<w:b/><w:spacing w:val="20"/>'), 'left', 400);
  expect(parseFloat(runs[0]!.style.letterSpacing)).toBeCloseTo(1 + 11 / 50, 6);
});

/** Check that every painted run starts at its layout x, over alignments and widths. */
function expectRunsAtLayoutX(
  runs: string,
  alignments: readonly string[],
  using = measurer,
  natural = oneEm
) {
  let checked = 0;
  for (const jc of alignments) {
    for (let width = 120; width <= 260; width += 7) {
      for (const { line, runs: painted } of paint(runs, jc, width, using)) {
        const spans = line.spans.filter((span) => span.text !== '');
        expect(painted).toHaveLength(spans.length);
        const origins = paintedOrigins(line, painted, natural);
        spans.forEach((span, index) => {
          expect([jc, width, span.text, origins[index]! - span.box.x]).toEqual([
            jc,
            width,
            span.text,
            expect.closeTo(0, 4),
          ]);
        });
        checked += spans.length;
      }
    }
  }
  return checked;
}

test('every painted run of a bold paragraph starts at its layout x', () => {
  const runs =
    run('Synthesized bold words wrap across lines ') +
    run('beside plain words ', '') +
    run('and bold words again until the paragraph ends.');
  expect(expectRunsAtLayoutX(runs, ['left', 'both', 'center', 'distribute'])).toBeGreaterThan(500);
});

test('a blank that word spacing cannot take back paints without the extra advance', () => {
  // U+3000 and U+2003 draw no ink, so layout leaves their advance alone. A browser gives them
  // letter spacing but no word spacing, so they lay out in unmarked spans of their own.
  const runs =
    run('Bold\u3000words\u3000wrap across\u2003lines ') + run('and\u3000more bold words.');
  expect(expectRunsAtLayoutX(runs, ['left', 'both', 'center'])).toBeGreaterThan(300);
});

test('text that the face cannot shape paints where layout put it', () => {
  // The bold slot holds the regular DejaVu Sans, which has no Hangul. The Hangul words measure
  // on the fallback, the model browser, which draws them as the browser draws fallback text. The
  // spaces shape in DejaVu Sans, which the browser draws at its regular advances.
  const regular = new Uint8Array(
    readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [400, 700].map((weight) => ({
      request: { family: 'Single Weight', weight, style: 'normal' as const },
      id: `Single Weight-${weight}`,
      bytes: regular,
      hash: sha256FontBytes(regular),
      faceIndex: 0,
    })),
    validateFont: harfBuzzFontValidator,
  });
  const shaped = createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: (style) => {
      const resolved = snapshot.resolve({
        family: style.fontFamily ?? 'Single Weight',
        weight: style.bold ? 700 : 400,
        style: 'normal',
      });
      return resolved instanceof FontResolutionError ? null : resolved;
    },
    fallback: browser,
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
  const fonts =
    '<w:rFonts w:ascii="Single Weight" w:hAnsi="Single Weight" w:eastAsia="Single Weight"/>';
  const runs =
    run('굵은 글씨는 줄을 넘겨 이어지고 ', `${fonts}<w:b/>`) + run('끝까지 굵다', `${fonts}<w:b/>`);
  const natural: NaturalWidth = (span, text) =>
    shaped.measure(text, { ...styleForFontSlot(span.style, span.fontSlot), bold: false });
  expect(expectRunsAtLayoutX(runs, ['left', 'both', 'center'], shaped, natural)).toBeGreaterThan(
    100
  );
});
