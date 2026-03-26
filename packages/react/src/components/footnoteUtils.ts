import type { Endnote, Footnote, Paragraph } from '@eigenpal/docx-core/types/document';

function createEmptyParagraph(): Paragraph {
  return { type: 'paragraph', content: [] };
}

function isNormalNote(note: Footnote | Endnote): boolean {
  return (note.noteType ?? 'normal') === 'normal' && note.id > 0;
}

export function getNextNoteId(notes?: Array<Footnote | Endnote>): number {
  if (!notes || notes.length === 0) return 1;
  let maxId = 0;
  for (const note of notes) {
    if (!isNormalNote(note)) continue;
    if (note.id > maxId) maxId = note.id;
  }
  return maxId + 1;
}

export function createEmptyFootnote(id: number): Footnote {
  return {
    type: 'footnote',
    id,
    noteType: 'normal',
    content: [createEmptyParagraph()],
  };
}

export function createEmptyEndnote(id: number): Endnote {
  return {
    type: 'endnote',
    id,
    noteType: 'normal',
    content: [createEmptyParagraph()],
  };
}
