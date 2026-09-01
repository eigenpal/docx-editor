import { expect, test } from 'bun:test';
import { preserveLeadingWhitespace } from '../src/markdown-source-map.ts';

test('keeps leading whitespace one-to-one without emitting HTML entities or code indentation', () => {
  const value = preserveLeadingWhitespace({
    markdown: ' \tText',
    sources: [
      {
        sourceScope: 'body',
        paragraphId: 'p',
        sourceStart: 0,
        sourceEnd: 6,
        markdownStart: 0,
        markdownEnd: 6,
        markdownBoundaries: [
          { sourceOffset: 0, markdownOffset: 0 },
          { sourceOffset: 2, markdownOffset: 2 },
          { sourceOffset: 6, markdownOffset: 6 },
        ],
        exact: true,
      },
    ],
  });

  expect(value.markdown).toBe('\u00a0\u00a0Text');
  expect(value.markdown).not.toContain('&nbsp;');
  expect(value.sources[0]).toMatchObject({
    markdownStart: 0,
    markdownEnd: 6,
    markdownBoundaries: [
      { sourceOffset: 0, markdownOffset: 0 },
      { sourceOffset: 2, markdownOffset: 2 },
      { sourceOffset: 6, markdownOffset: 6 },
    ],
  });
});
