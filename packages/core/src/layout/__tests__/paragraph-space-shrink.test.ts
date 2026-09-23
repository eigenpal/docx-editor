import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../pending-line.ts';
import type { TextMeasurer } from '../semantic-records.ts';
const measurer: TextMeasurer = {
  measure(text, style) {
    return [...text].reduce(
      (n, c) => n + (c === ' ' ? 4 + (style.shaping?.wordSpacingPt ?? 0) : 10),
      0
    );
  },
  lineMetrics() {
    return { height: 14, baseline: 11 };
  },
};
const source = (alignment = 'both', text = 'aa bb cc dd', width = 66) =>
  loadBody(
    `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
  );
const content = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  linesOf(layout).map((l) =>
    l.spans
      .map((s) => s.text)
      .join('')
      .trimEnd()
  );

test('modern justified flow compresses spaces, preserving letters and measurable span widths', () => {
  const result = layoutSemanticDocument(source(), 1, { measurer, compatibilityMode: 15 });
  expect(content(result)).toEqual(['aa bb cc', 'dd']);
  const spans = linesOf(result)[0]!.spans;
  expect(spans[0]!.style.shaping?.wordSpacingPt).toBeCloseTo(-1, 6);
  expect(spans[1]!.style.shaping?.wordSpacingPt).toBeCloseTo(-1, 6);
  for (const span of spans)
    expect(measurer.measure(span.text, span.style)).toBeCloseTo(span.box.width, 6);
  expect(spans[1]!.box.x).toBeCloseTo(spans[0]!.box.x + spans[0]!.box.width, 6);
  expect(linesOf(result)[1]!.spans.every((s) => !s.style.shaping?.wordSpacingPt)).toBe(true);
});

test('legacy, unspecified compatibility, and left alignment preserve existing wrapping', () => {
  for (const compatibilityMode of [undefined, 14])
    expect(content(layoutSemanticDocument(source(), 1, { measurer, compatibilityMode }))).toEqual([
      'aa bb',
      'cc dd',
    ]);
  expect(
    content(layoutSemanticDocument(source('left'), 1, { measurer, compatibilityMode: 15 }))
  ).toEqual(['aa bb', 'cc dd']);
});

test('compatibility changes invalidate retained paragraph layout', () => {
  const body = source(),
    session = createLayoutSession(),
    cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const options = { measurer, session, cache, producer: 'space-test' };
  expect(content(layoutSemanticDocument(body, 1, { ...options, compatibilityMode: 14 }))).toEqual([
    'aa bb',
    'cc dd',
  ]);
  expect(content(layoutSemanticDocument(body, 2, { ...options, compatibilityMode: 15 }))).toEqual([
    'aa bb cc',
    'dd',
  ]);
  expect(content(layoutSemanticDocument(body, 3, { ...options, compatibilityMode: 14 }))).toEqual([
    'aa bb',
    'cc dd',
  ]);
});

test('space floor and weighted expansion prevent greedy extra words', () => {
  expect(
    content(
      layoutSemanticDocument(source('both', 'aa bb cc dd', 65), 1, {
        measurer,
        compatibilityMode: 15,
      })
    )
  ).toEqual(['aa bb', 'cc dd']);
  const text = Array(10).fill('aa').join(' ') + ' b cc';
  const result = layoutSemanticDocument(source('both', text, 241), 1, {
    measurer,
    compatibilityMode: 15,
  });
  expect(content(result)[0]).toBe(Array(10).fill('aa').join(' '));
});

// A quoted bold term or a stray closing mark leaves its word split across source runs,
// so the overflow lands on a piece that continues the word instead of opening one.
const seamSource = (runs: readonly string[], boldIndex = -1, width = 66) =>
  loadBody(
    `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${runs
      .map(
        (text, index) =>
          `<w:r>${index === boldIndex ? '<w:rPr><w:b/></w:rPr>' : ''}` +
          `<w:t xml:space="preserve">${text}</w:t></w:r>`
      )
      .join('')}</w:p><w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/>` +
      `<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
  );

test('a word split across source runs borrows the same inter-word space', () => {
  for (const [runs, boldIndex] of [
    [['aa bb c', 'c dd'], -1],
    [['aa bb ', 'c', 'c dd'], 1],
  ] as const) {
    const result = layoutSemanticDocument(seamSource(runs, boldIndex), 1, {
      measurer,
      compatibilityMode: 15,
    });
    expect(content(result)).toEqual(['aa bb cc', 'dd']);
    expect(linesOf(result)[0]!.spans[0]!.style.shaping?.wordSpacingPt).toBeCloseTo(-1, 6);
  }
  expect(
    content(
      layoutSemanticDocument(seamSource(['aa bb c', 'c dd']), 1, {
        measurer,
        compatibilityMode: 14,
      })
    )
  ).toEqual(['aa bb', 'cc dd']);
});

test('a seam does not lift the space floor for a split word', () => {
  expect(
    content(
      layoutSemanticDocument(seamSource(['aa bb c', 'c dd'], -1, 65), 1, {
        measurer,
        compatibilityMode: 15,
      })
    )
  ).toEqual(['aa bb', 'cc dd']);
});

// Word 2019 and Microsoft 365 author `compatibilityMode` 16. Modern justification is mode 15
// and everything after it; gating on `=== 15` left every current Word document on the legacy
// path the moment the parser started returning 16 instead of `undefined`.
test('modes 16 and 17 justify exactly as mode 15 does', () => {
  const modern = content(layoutSemanticDocument(source(), 1, { measurer, compatibilityMode: 15 }));
  for (const compatibilityMode of [16, 17])
    expect(content(layoutSemanticDocument(source(), 1, { measurer, compatibilityMode }))).toEqual(
      modern
    );
});

// Producers often keep the space after a word in its own run (tracked edits, character
// spacing), and East Asian break rules split every word from its space. The word before
// that space is complete, so it borrows inter-word space like a same-run word.
test('a word whose space sits in the next run borrows inter-word space', () => {
  for (const runs of [
    ['aa bb cc', ' dd'],
    ['aa ', 'bb', ' ', 'cc', ' ', 'dd'],
  ]) {
    const result = layoutSemanticDocument(seamSource(runs), 1, {
      measurer,
      compatibilityMode: 15,
    });
    expect(content(result)).toEqual(['aa bb cc', 'dd']);
    const line = linesOf(result)[0]!;
    expect(line.spans.at(-1)!.box.x + line.spans.at(-1)!.box.width).toBeLessThanOrEqual(66.001);
    expect(line.spans.some((s) => (s.style.shaping?.wordSpacingPt ?? 0) < 0)).toBe(true);
    expect(
      content(layoutSemanticDocument(seamSource(runs), 1, { measurer, compatibilityMode: 14 }))
    ).toEqual(['aa bb', 'cc dd']);
  }
});

test('an East Asian language paragraph compresses Latin spaces the same way', () => {
  const body = loadBody(
    `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:lang w:eastAsia="zh-CN"/></w:rPr>` +
      `<w:t>aa bb cc dd</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="2320" w:h="6000"/>` +
      `<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
  );
  expect(content(layoutSemanticDocument(body, 1, { measurer, compatibilityMode: 15 }))).toEqual([
    'aa bb cc',
    'dd',
  ]);
});

test('a following run that continues the word, or ends the paragraph, gets no shrink', () => {
  for (const [runs, expected] of [
    [
      ['aa bb cc', 'x dd'],
      ['aa bb', 'ccx dd'],
    ],
    [
      ['aa bb cc', ' '],
      ['aa bb', 'cc'],
    ],
  ] as const) {
    expect(
      content(layoutSemanticDocument(seamSource(runs), 1, { measurer, compatibilityMode: 15 }))
    ).toEqual(expected);
  }
});

// A double space split across runs: the word keeps its own space and the next run's
// space hangs after it. Both spaces hang, so the line still compresses to the measure.
test('a word with its own space and a hanging space run still compresses to the measure', () => {
  const result = layoutSemanticDocument(seamSource(['aa bb cc ', ' dd']), 1, {
    measurer,
    compatibilityMode: 15,
  });
  expect(content(result)).toEqual(['aa bb cc', 'dd']);
  const spans = linesOf(result)[0]!.spans;
  const cc = spans.find((s) => s.text.startsWith('cc'))!;
  expect(cc.box.x).toBeCloseTo(46, 6);
  expect(cc.box.x + measurer.measure('cc', cc.style)).toBeLessThanOrEqual(66.001);
  expect(cc.style.shaping?.wordSpacingPt ?? 0).toBe(0);
});

test('a hanging space run after a word with its own space does not shorten the stretch', () => {
  for (const compatibilityMode of [14, 15]) {
    const endOf = (runs: readonly string[]) => {
      const spans = linesOf(
        layoutSemanticDocument(seamSource(runs, -1, 72), 1, { measurer, compatibilityMode })
      )[0]!.spans;
      const cc = spans.find((s) => s.text.startsWith('cc'))!;
      return cc.box.x + measurer.measure('cc', cc.style);
    };
    expect(endOf(['aa bb cc ', ' dd'])).toBeCloseTo(endOf(['aa bb cc dd']), 6);
    expect(endOf(['aa bb cc ', '  dd'])).toBeCloseTo(endOf(['aa bb cc dd']), 6);
  }
});

test('a no-break space before a hanging space stays content in the stretch', () => {
  const lines = linesOf(
    layoutSemanticDocument(seamSource(['aa bb cc ', ' dd'], -1, 80), 1, {
      measurer,
      compatibilityMode: 15,
    })
  );
  expect(lines.length).toBe(2);
  const spans = lines[0]!.spans;
  const cc = spans.find((s) => s.text.startsWith('cc'))!;
  expect(cc.box.x + measurer.measure('cc ', cc.style) - spans[0]!.box.x).toBeCloseTo(80, 6);
});

// A field result is measured whole, so its leading space cannot hang at the line end.
// A word before it must not borrow space on the promise that the space will hang.
test('a space that opens a field result does not let the word before it compress', () => {
  const result = ' 1';
  for (const field of [
    `<w:fldSimple w:instr="PAGE"><w:r><w:t xml:space="preserve">${result}</w:t></w:r></w:fldSimple>`,
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF bm1 \\h </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">${result}</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
  ]) {
    const body = loadBody(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>aa bb cc</w:t></w:r>${field}` +
        `<w:r><w:t xml:space="preserve"> ee</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="2320" w:h="6000"/>` +
        `<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
    );
    const lines = linesOf(layoutSemanticDocument(body, 1, { measurer, compatibilityMode: 15 }));
    const texts = lines.map((l) => l.spans.map((s) => s.text).join(''));
    expect(texts[0]!.trimEnd()).toBe('aa bb');
    for (const text of texts.slice(1)) expect(text.startsWith(' ')).toBe(false);
  }
});
