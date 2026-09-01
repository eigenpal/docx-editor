import { expect, test } from 'bun:test';
import type { StyleSpanRecord } from '@docx-editor.dev/core/layout';
import { escapeText, MarkdownInlineWriter } from '../src/markdown-inline.ts';

function token(text: string, start: number, bold = false) {
  return {
    paragraphId: 'p',
    sourceText: text,
    span: {
      range: { paragraphId: 'p', start, end: start + text.length },
      text,
      style: bold ? { bold: true } : {},
    } as StyleSpanRecord,
  };
}

test('keeps ordinary in-word hyphens readable without opening Markdown syntax', () => {
  expect(escapeText('docx-editor.dev')).toBe('docx-editor\\.dev');
  expect(escapeText('multi-level and source-to-export')).toBe('multi-level and source-to-export');
  expect(escapeText('日本-語')).toBe('日本-語');
  expect(escapeText('𐐀-𐐁')).toBe('𐐀-𐐁');
});

test('keeps in-word hyphens readable across DOCX run and style boundaries', () => {
  const sameStyle = new MarkdownInlineWriter({
    tableCell: false,
    displayMode: 'all-markup',
    sourceScope: 'body',
  });
  sameStyle.writeText(token('source', 0));
  sameStyle.writeText(token('-', 6));
  sameStyle.writeText(token('to', 7));
  expect(sameStyle.finish()).toBe('source-to');

  const changedStyle = new MarkdownInlineWriter({
    tableCell: false,
    displayMode: 'all-markup',
    sourceScope: 'body',
  });
  changedStyle.writeText(token('source', 0));
  changedStyle.writeText(token('-', 6));
  changedStyle.writeText(token('to', 7, true));
  expect(changedStyle.finish()).toBe('source-**to**');

  const astral = new MarkdownInlineWriter({
    tableCell: false,
    displayMode: 'all-markup',
    sourceScope: 'body',
  });
  astral.writeText(token('𐐀', 0));
  astral.writeText(token('-', 2));
  astral.writeText(token('𐐁', 3));
  expect(astral.finish()).toBe('𐐀-𐐁');

  const structuralBoundary = new MarkdownInlineWriter({
    tableCell: false,
    displayMode: 'all-markup',
    sourceScope: 'body',
  });
  structuralBoundary.writeText(token('source', 0));
  structuralBoundary.writeBoundary('<br>');
  structuralBoundary.writeText(token('-to', 6));
  expect(structuralBoundary.finish()).toBe('source<br>\\-to');
});

test('still escapes hyphens that could be interpreted as Markdown punctuation', () => {
  expect(escapeText('- list item')).toBe('\\- list item');
  expect(escapeText('a - b')).toBe('a \\- b');
  expect(escapeText('---')).toBe('\\-\\-\\-');
});
