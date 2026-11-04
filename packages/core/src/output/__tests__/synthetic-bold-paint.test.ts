// Screen paint puts synthesized-bold glyphs where layout put them.
//
// Layout gives each inked glyph of a bold run in a face without bold 1/50 em of extra advance, as
// Word does. A browser emboldens such a face but draws it at the face's own advances, so paint
// adds the extra as letter spacing and takes it back from spaces. The model browser here draws
// every character one em wide at the run's size, plus the spacing paint asks for.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { linesOf, type LineRecord, type TextMeasurer } from '../../layout/semantic-records.ts';
import { syntheticBoldAdvancePt } from '../../layout/synthetic-bold.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const inked = (text: string) => [...text].filter((character) => character !== ' ').length;
// Every bold run synthesizes its bold here, as with a family that has no bold face.
const measurer: TextMeasurer = {
  measure: (text, style) =>
    text.length * (style.fontSizePt + style.characterSpacingPt) +
    (style.bold ? inked(text) * syntheticBoldAdvancePt(style) : 0),
  syntheticBold: (style) => style.bold,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};

function paint(runs: string, jc: string, width: number) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>${runs}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 0, {
    measurer,
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

/** Where inline flow starts each painted run, in the model browser. */
function paintedOrigins(line: LineRecord, runs: readonly HTMLElement[]): number[] {
  const spans = line.spans.filter((span) => span.text !== '');
  let x = spans[0]?.box.x ?? 0;
  return runs.map((run, index) => {
    const span = spans[index]!;
    x += parseFloat(run.style.marginLeft || '0');
    const origin = x;
    const text = run.textContent ?? '';
    const spaces = text.length - inked(text);
    x +=
      text.length * span.style.fontSizePt +
      text.length * parseFloat(run.style.letterSpacing || '0') +
      spaces * parseFloat(run.style.wordSpacing || '0');
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

test('every painted run of a bold paragraph starts at its layout x', () => {
  const runs =
    run('Synthesized bold words wrap across lines ') +
    run('beside plain words ', '') +
    run('and bold words again until the paragraph ends.');
  let checked = 0;
  for (const jc of ['left', 'both', 'center', 'distribute']) {
    for (let width = 120; width <= 260; width += 7) {
      for (const { line, runs: painted } of paint(runs, jc, width)) {
        const spans = line.spans.filter((span) => span.text !== '');
        expect(painted).toHaveLength(spans.length);
        const origins = paintedOrigins(line, painted);
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
  expect(checked).toBeGreaterThan(500);
});
