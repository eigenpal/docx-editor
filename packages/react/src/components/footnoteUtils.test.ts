import { describe, it, expect } from 'bun:test';
import type { Footnote } from '@eigenpal/docx-core/types/document';
import { getNextNoteId, createEmptyFootnote, createEmptyEndnote } from './footnoteUtils';

describe('getNextNoteId', () => {
  it('returns 1 when no notes are present', () => {
    expect(getNextNoteId()).toBe(1);
  });

  it('ignores separators and returns max+1', () => {
    const notes: Footnote[] = [
      { type: 'footnote', id: -1, noteType: 'separator', content: [] },
      { type: 'footnote', id: 1, noteType: 'normal', content: [{ type: 'paragraph', content: [] }] },
      { type: 'footnote', id: 3, noteType: 'normal', content: [{ type: 'paragraph', content: [] }] },
    ];
    expect(getNextNoteId(notes)).toBe(4);
  });
});

describe('createEmptyFootnote/createEmptyEndnote', () => {
  it('creates empty note bodies with one paragraph', () => {
    const footnote = createEmptyFootnote(2);
    const endnote = createEmptyEndnote(5);

    expect(footnote.type).toBe('footnote');
    expect(footnote.id).toBe(2);
    expect(footnote.content).toEqual([{ type: 'paragraph', content: [] }]);

    expect(endnote.type).toBe('endnote');
    expect(endnote.id).toBe(5);
    expect(endnote.content).toEqual([{ type: 'paragraph', content: [] }]);
  });
});
