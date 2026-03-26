import { describe, it, expect } from 'bun:test';
import type { Document, Paragraph } from '../../types/document';
import { mergeDocumentBlocks } from './mergeDocumentBlocks';

const createParagraph = (text: string): Paragraph => ({
  type: 'paragraph',
  content: [{ type: 'run', content: [{ type: 'text', text }] }],
});

const base: Document = {
  package: {
    document: {
      content: [createParagraph('one'), createParagraph('two')],
    },
  },
};

describe('mergeDocumentBlocks', () => {
  it('replaces the dirty index with the updated block', () => {
    const updated: Paragraph = createParagraph('two!');
    const result = mergeDocumentBlocks(base, new Map([[1, updated]]), 2);
    expect(result.package.document.content[1]).toEqual(updated);
  });
});
