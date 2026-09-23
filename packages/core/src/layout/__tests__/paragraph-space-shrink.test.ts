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
