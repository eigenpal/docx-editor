import { describe, expect, test } from 'bun:test';
import { PARTS, TOC_LINE } from '../reference/fetch.ts';

describe('the table of contents line', () => {
  test('gives the subclause, the title, and the page', () => {
    const line =
      '   18.3.1.13 col (Column Width & Formatting) ................................ 1600';
    expect(TOC_LINE.exec(line)?.slice(1)).toEqual([
      '18.3.1.13',
      'col (Column Width & Formatting)',
      '1600',
    ]);
  });

  test('reads a title with a dot in it', () => {
    expect(TOC_LINE.exec('  7.2 Ignorable Attribute...................... 8')?.[2]).toBe(
      'Ignorable Attribute'
    );
  });

  test('does not read a body heading or a line of text', () => {
    expect(TOC_LINE.exec('18.3.1.13           col (Column Width & Formatting)')).toBeNull();
    expect(TOC_LINE.exec('The width is 8.43 characters.')).toBeNull();
  });
});

test('fetches each of the four parts once', () => {
  expect(PARTS.map((p) => p.part)).toEqual([1, 2, 3, 4]);
});
