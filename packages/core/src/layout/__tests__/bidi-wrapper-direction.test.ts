import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type SemanticLayout } from '../semantic-records.ts';
import { caretAt, caretStops } from '../semantic-interaction.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { bidiDirectionOfStop, horizontalCaretStep } from '../visual-caret-navigation.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function part(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}

const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

function layout(content: string, pPr = ''): SemanticLayout {
  return layoutSemanticDocument(
    part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${pPr}</w:pPr>${content}</w:p><w:sectPr><w:pgSz w:w="6000" w:h="5000"/><w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/></w:sectPr></w:body></w:document>`
    ),
    0,
    {
      measurer,
      styleCascade: buildStyleCascadeTable(
        part(
          `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      ),
    }
  );
}

/** The characters of the first line in painted order, left to right. */
function visualText(result: SemanticLayout): string {
  const line = linesOf(result)[0]!;
  return [...line.spans]
    .sort((a, b) => a.box.x - b.box.x)
    .map((span) =>
      span.style.shaping?.direction === 'rtl' ? [...span.text].reverse().join('') : span.text
    )
    .join('');
}

function caretXs(result: SemanticLayout, length: number): number[] {
  const paragraphId = linesOf(result)[0]!.range.paragraphId;
  return Array.from({ length: length + 1 }, (_, offset) => {
    const caret = caretAt(result, { paragraphId, offset }, measurer);
    if (!caret) throw Error(`no caret at ${offset}`);
    return caret.x;
  });
}

test('a right-to-left override paints its letters in reverse order', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${run(' y')}`);
  expect(visualText(result)).toBe('x cba y');
  const override = linesOf(result)[0]!.spans.find((span) => span.text === 'abc')!;
  expect(override.style.shaping?.direction).toBe('rtl');
  expect(override.style.shaping?.override).toBe('rtl');
});

test('paint draws an override span with the override, and plain spans as isolates', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${run(' y')}`);
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const elements = Array.from(host.querySelectorAll<HTMLElement>('.layout-run-text'));
  const override = elements.find((element) => element.textContent === 'abc')!;
  expect(override.style.direction).toBe('rtl');
  expect(override.style.unicodeBidi).toBe('isolate-override');
  for (const element of elements.filter((item) => item !== override))
    expect(element.style.unicodeBidi).toBe('isolate');
});

test('the caret moves right to left through a right-to-left override', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${run(' y')}`);
  const xs = caretXs(result, 7);
  // Offsets 2..5 cover `abc`: the caret after `a` sits left of the caret before it.
  expect(xs[3]).toBeLessThan(xs[2]!);
  expect(xs[4]).toBeLessThan(xs[3]!);
  // Every offset clicks back to itself.
  const line = linesOf(result)[0]!;
  for (const offset of [3, 4]) {
    const hit = hitTestPage(
      result,
      0,
      { x: xs[offset]!, y: line.box.y + line.box.height / 2 },
      { measurer }
    );
    expect(hit?.position.offset).toBe(offset);
  }
});

test('arrow keys move by painted position through a right-to-left override', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${run(' y')}`);
  const stops = caretStops(result, measurer);
  const at = stops.findIndex((stop) => stop.position.offset === 3);
  const directionOf = (stop: (typeof stops)[number]) => bidiDirectionOfStop(result, stop);
  // Between `a` and `b`, painted as `cba`: ArrowLeft passes `b`, ArrowRight passes `a`.
  expect(horizontalCaretStep(stops, at, -1, directionOf).target?.position.offset).toBe(4);
  expect(horizontalCaretStep(stops, at, 1, directionOf).target?.position.offset).toBe(2);
});

test('a right-to-left embedding keeps letters in order and moves its trailing neutral', () => {
  // The letters resolve to level 2 and keep their order; the trailing `!` takes the
  // embedding's direction and moves to its left.
  const result = layout(`${run('x ')}<w:dir w:val="rtl">${run('ab!')}</w:dir>`);
  expect(visualText(result)).toBe('x !ab');
});

test('a left-to-right override keeps Hebrew letters in logical order', () => {
  const result = layout(`<w:bdo w:val="ltr">${run('אבג')}</w:bdo>`);
  expect(visualText(result)).toBe('אבג');
});

test('an unknown direction value leaves the wrapper transparent', () => {
  const result = layout(`<w:bdo w:val="up">${run('abc')}</w:bdo>`);
  expect(visualText(result)).toBe('abc');
  expect(linesOf(result)[0]!.spans[0]!.style.shaping).toBeUndefined();
});

test('East Asian font slicing inside a wrapper matches the slicing outside it', () => {
  const fonts = '<w:rFonts w:ascii="Latin Face" w:hAnsi="Latin Face" w:eastAsia="MS Mincho"/>';
  const text = run('ab漢字cd', fonts);
  const spans = (content: string) =>
    linesOf(layout(content))[0]!.spans.map((span) => [
      span.text,
      span.style.fontFamily,
      span.style.fontFamilyEastAsia,
    ]);
  // Under a right-to-left directive the slices keep their text and faces; only order changes.
  const slices = (content: string) =>
    linesOf(layout(content))[0]!
      .spans.map((span) => `${span.text}|${span.style.fontFamilyEastAsia}`)
      .sort();
  const plain = spans(text);
  expect(plain.map(([slice]) => slice)).toEqual(['ab', '漢字', 'cd']);
  expect(spans(`<w:bdo w:val="ltr">${text}</w:bdo>`)).toEqual(plain);
  expect(spans(`<w:dir w:val="ltr">${text}</w:dir>`)).toEqual(plain);
  expect(slices(`<w:bdo w:val="rtl">${text}</w:bdo>`)).toEqual(slices(text));
  expect(slices(`<w:dir w:val="rtl">${text}</w:dir>`)).toEqual(slices(text));
});

test('a line break inside a wrapper keeps its direction on the next line', () => {
  for (const wrapper of ['bdo', 'dir']) {
    const result = layout(
      `<w:${wrapper} w:val="rtl">${run('abc')}<w:r><w:br/></w:r>${run('def')}</w:${wrapper}>`
    );
    const levels = linesOf(result).map((line) =>
      line.spans.filter((span) => span.text.trim()).map((span) => span.style.shaping?.level)
    );
    expect(levels[0]![0]).toBeGreaterThan(0);
    expect(levels[1]![0]).toBe(levels[0]![0]);
  }
  const lines = linesOf(
    layout(`<w:bdo w:val="rtl">${run('abc')}<w:r><w:br/></w:r>${run('def')}</w:bdo>`)
  );
  expect(lines[1]!.spans.find((span) => span.text === 'def')?.style.shaping?.direction).toBe('rtl');
});
