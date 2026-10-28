import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { hitTestSemantic } from '../semantic-point-queries.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';
import { distributeLineCharacters, SPACE_SHARE_LIMIT } from '../distributed-character-spacing.ts';
import { loadBody, layoutUnderFloat, squareWrapZone, W } from './float-over-table-harness.ts';

// 10pt per character at 11pt and a 100pt measure, so every position is checkable by hand.
const measurer = createFixedMeasurer(10, 14);
const geometry = { width: 120, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const RUN = '<w:rPr><w:sz w:val="22"/></w:rPr>';
const run = (text: string, rPr = RUN) => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (content: string, pPr = '<w:jc w:val="distribute"/>') =>
  `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;

function styles(docDefaults: string) {
  const xml = `<w:styles xmlns:w="${W}">${docDefaults}<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const result = readOoxmlPart(xml, { name: '/word/styles.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return buildStyleCascadeTable(result.part.root);
}

/** Styles parts that author a `w:rPrDefault`, even an empty one. */
const WITH_RUN_DEFAULTS = {
  'an empty rPrDefault': styles('<w:docDefaults><w:rPrDefault/></w:docDefaults>'),
  'an rPrDefault with properties': styles(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults>'
  ),
};
/** Packages whose styles leave the run defaults to the application. */
const WITHOUT_RUN_DEFAULTS = {
  'no styles part': undefined,
  'an empty docDefaults': styles('<w:docDefaults/>'),
  'only a pPrDefault': styles('<w:docDefaults><w:pPrDefault/></w:docDefaults>'),
};

function layout(body: string, styleCascade: ReturnType<typeof styles> | undefined) {
  const source = loadBody(body);
  const before = serializeOoxmlPart(source);
  const result = layoutSemanticDocument(source, 0, {
    measurer,
    geometry,
    ...(styleCascade ? { styleCascade } : {}),
  });
  expect(serializeOoxmlPart(source)).toBe(before);
  return result;
}

/** Each visible span of a line as `[text, start x]`, x is content-relative. */
function placed(line: LineRecord) {
  return line.spans
    .filter((span) => span.text !== '' && span.text !== '\n')
    .map((span) => [span.text, Number(span.box.x.toFixed(6))] as const);
}

for (const [kind, cascade] of Object.entries(WITH_RUN_DEFAULTS)) {
  test(`a distributed single word spreads its letters to both edges: ${kind}`, () => {
    const [line] = linesOf(layout(paragraph(run('Text')), cascade));
    // 60pt of slack over three character gaps.
    expect(placed(line!)).toEqual([
      ['T', 0],
      ['e', 30],
      ['x', 60],
      ['t', 90],
    ]);
  });

  test(`a distributed single character stays centered: ${kind}`, () => {
    for (const text of ['X', '名']) {
      const [line] = linesOf(layout(paragraph(run(text)), cascade));
      expect(placed(line!)).toEqual([[text, 45]]);
    }
  });
}

test('spaces take their share of the slack first, the rest goes after every character', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const [line] = linesOf(layout(paragraph(run('ab cd')), cascade));
  // 50pt of slack: the space takes 4.5pt, and four gaps share the other 45.5pt.
  const step = (50 - SPACE_SHARE_LIMIT * 10) / 4;
  expect(placed(line!).map(([text]) => text)).toEqual(['a', 'b', ' ', 'c', 'd']);
  const xs = placed(line!).map(([, x]) => x);
  expect(xs[1]).toBeCloseTo(10 + step, 6);
  expect(xs[2]).toBeCloseTo(20 + 2 * step, 6);
  expect(xs[3]).toBeCloseTo(30 + 3 * step + SPACE_SHARE_LIMIT * 10, 6);
  expect(xs[4]).toBeCloseTo(90, 6);
});

test('a line with less slack than its spaces can take stretches only its spaces', () => {
  const [line] = linesOf(
    layout(paragraph(run('a b c d e')), WITH_RUN_DEFAULTS['an empty rPrDefault'])
  );
  // 10pt of slack, less than four spaces can take (18pt): each space takes 2.5pt.
  expect(placed(line!)).toEqual([
    ['a', 0],
    [' ', 10],
    ['b', 22.5],
    [' ', 32.5],
    ['c', 45],
    [' ', 55],
    ['d', 67.5],
    [' ', 77.5],
    ['e', 90],
  ]);
});

test('leading spaces keep their advance and trailing spaces hang', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const [leading] = linesOf(layout(paragraph(run('  ab')), cascade));
  expect(placed(leading!)).toEqual([
    [' ', 0],
    [' ', 10],
    ['a', 20],
    ['b', 90],
  ]);
  const [trailing] = linesOf(layout(paragraph(run('ab  ')), cascade));
  expect(placed(trailing!).slice(0, 2)).toEqual([
    ['a', 0],
    ['b', 90],
  ]);
});

test('inner distributed lines stretch their spaces; the final line spreads characters', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const text = 'aa bb cc dd ee ff gg hh ii';
  const distributed = linesOf(layout(paragraph(run(text)), cascade));
  const justified = linesOf(layout(paragraph(run(text), '<w:jc w:val="both"/>'), cascade));
  expect(distributed.length).toBeGreaterThan(1);
  for (let index = 0; index < distributed.length - 1; index++) {
    expect(placed(distributed[index]!)).toEqual(placed(justified[index]!));
  }
  const last = placed(distributed.at(-1)!);
  expect(last.filter(([value]) => value !== ' ').map(([value]) => value)).toEqual([
    'g',
    'g',
    'h',
    'h',
    'i',
    'i',
  ]);
  expect(last[0]![1]).toBe(0);
  expect(last.at(-1)![1]).toBeCloseTo(90, 6);
});

test('a line before a manual line break spreads its characters', () => {
  const lines = linesOf(
    layout(
      paragraph(`<w:r>${RUN}<w:t>ab</w:t><w:br/><w:t>cd</w:t></w:r>`),
      WITH_RUN_DEFAULTS['an empty rPrDefault']
    )
  );
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    const [first, second] = placed(line);
    expect(first![1]).toBe(0);
    expect(second![1]).toBeCloseTo(90, 6);
  }
});

test('letters spread across formatting runs and grapheme clusters stay whole', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const [line] = linesOf(
    layout(paragraph(run('Te') + run('xt', '<w:rPr><w:b/><w:sz w:val="22"/></w:rPr>')), cascade)
  );
  expect(placed(line!)).toEqual([
    ['T', 0],
    ['e', 30],
    ['x', 60],
    ['t', 90],
  ]);
  const [cluster] = linesOf(layout(paragraph(run('café')), cascade));
  expect(placed(cluster!).map(([text]) => text)).toEqual(['c', 'a', 'f', 'é']);
});

test('a distributed East Asian line spaces every character, punctuation included', () => {
  const [line] = linesOf(
    layout(paragraph(run('「漢字」')), WITH_RUN_DEFAULTS['an empty rPrDefault'])
  );
  expect(placed(line!)).toEqual([
    ['「', 0],
    ['漢', 30],
    ['字', 60],
    ['」', 90],
  ]);
});

test('right-to-left text keeps its letters together', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const rtl = '<w:rPr><w:rtl/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
  // A right-to-left paragraph stretches only its spaces, so one word centers.
  const [bidiText] = linesOf(
    layout(paragraph(run('Text'), '<w:bidi/><w:jc w:val="distribute"/>'), cascade)
  );
  expect(placed(bidiText!)[0]![1]).toBeCloseTo(30, 6);
  // A right-to-left word in a left-to-right paragraph has no gap of its own.
  const [hebrew] = linesOf(layout(paragraph(run('שלום', rtl)), cascade));
  expect(placed(hebrew!)).toEqual([['שלום', 30]]);
});

test('a distributed tab line keeps its tab position', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const body = (alignment: string) =>
    paragraph(
      `<w:r>${RUN}<w:t>Ab</w:t><w:tab/><w:t>Cd</w:t></w:r>`,
      `<w:jc w:val="${alignment}"/>`
    );
  const xOf = (alignment: string) =>
    linesOf(layout(body(alignment), cascade))[0]!.spans.find((s) => s.text.includes('Cd'))!.box.x;
  expect(xOf('distribute')).toBeCloseTo(xOf('left'), 7);
});

test('a distributed single word spreads its letters in a table cell', () => {
  const [line] = linesOf(
    layout(
      `<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph(run('Cell'))}</w:tc></w:tr></w:tbl>`,
      WITH_RUN_DEFAULTS['an empty rPrDefault']
    )
  );
  expect(placed(line!).map(([, x]) => x)).toEqual([0, 30, 60, 90]);
});

test('the last passage beside a float spreads its characters inside the passage', () => {
  const source = loadBody(paragraph(run('aa bb cc dd ee ff gg hh ii jj kk ll mm nn')));
  const target = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zone = squareWrapZone({
    anchorParagraphId: target.id,
    top: 0,
    height: 70,
    left: 60,
    width: 40,
  });
  const result = layoutUnderFloat(source, new Map([[0, [zone]]]), undefined, {
    styleCascade: WITH_RUN_DEFAULTS['an empty rPrDefault'],
  });
  const last = linesOf(result).at(-1)!;
  const jump = last.spans.findIndex((span) => (span.wrapAdvanceBefore ?? 0) > 0.001);
  expect(jump).toBeGreaterThan(0);
  // The part before the float keeps whole words; the part after it is split per character.
  expect(last.spans.slice(0, jump).some((span) => span.text.trim().length > 1)).toBe(true);
  const after = last.spans.slice(jump).filter((span) => span.text.trim() !== '');
  expect(after.every((span) => span.text.length === 1)).toBe(true);
  const end = after.at(-1)!;
  expect(end.box.x + end.box.width).toBeCloseTo(180, 6);
});

test('the caret and hit testing follow the spread letters', () => {
  const result = layout(paragraph(run('Text')), WITH_RUN_DEFAULTS['an empty rPrDefault']);
  const [line] = linesOf(result);
  const paragraphId = line!.spans[0]!.range.paragraphId;
  const caret = caretAt(result, { paragraphId, offset: 2 }, measurer)!;
  const x = line!.spans.find((span) => span.text === 'x')!;
  expect(caret.x).toBeCloseTo(x.box.x, 6);
  const hit = hitTestSemantic(result, { x: x.box.x + 2, y: caret.y + 1 })!;
  expect(hit.position).toEqual({ paragraphId, offset: 2 });
});

for (const [kind, cascade] of Object.entries(WITHOUT_RUN_DEFAULTS)) {
  test(`without run defaults a distributed line stretches only its spaces: ${kind}`, () => {
    const [word] = linesOf(layout(paragraph(run('Text')), cascade));
    expect(placed(word!)).toEqual([['Text', 30]]);
    const [spaced] = linesOf(layout(paragraph(run('ab cd')), cascade));
    expect(placed(spaced!).map(([text]) => text)).toEqual(['ab ', 'cd']);
    expect(placed(spaced!)[1]![1]).toBeCloseTo(80, 6);
    // Spaces before the first character are no slot, so the line centers with them.
    const [leading] = linesOf(layout(paragraph(run('  ab')), cascade));
    const a = placed(leading!).find(([text]) => text.startsWith('a'))!;
    expect(a[1]).toBeCloseTo(50, 6);
  });
}

test('paint draws each spread letter at its layout position', () => {
  const result = layout(paragraph(run('Text')), WITH_RUN_DEFAULTS['an empty rPrDefault']);
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const element = host.querySelector<HTMLElement>('.docx-line')!;
  const runs = Array.from(element.querySelectorAll<HTMLElement>('.layout-run-text'));
  expect(runs.map((painted) => painted.textContent)).toEqual(['T', 'e', 'x', 't']);
  // The gap before each letter is painted as its margin, so the letters land on the layout.
  const margins = runs.map((painted) => parseFloat(painted.style.marginLeft || '0'));
  expect(margins).toEqual([0, 20, 20, 20]);
});

test('distributeLineCharacters reports a line with no character gap', () => {
  const [line] = linesOf(layout(paragraph(run('X')), undefined));
  expect(distributeLineCharacters(line!.spans, measurer, 90, line!.spans.length)).toBeNull();
});
