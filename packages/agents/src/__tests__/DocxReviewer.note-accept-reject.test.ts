import { describe, test, expect } from 'bun:test';
import type {
  Document,
  DocumentBody,
  Footnote,
  Endnote,
} from '@eigenpal/docx-editor-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import { NoteChangeNotEditableError } from '../errors';
import { makeParagraph, makeParagraphFrom, makeInsertion, makeDeletion } from './_helpers';

function makeFootnote(id: number, change: ReturnType<typeof makeInsertion>): Footnote {
  return { type: 'footnote', id, noteType: 'normal', content: [makeParagraphFrom([change])] };
}

function makeEndnote(id: number, change: ReturnType<typeof makeDeletion>): Endnote {
  return { type: 'endnote', id, noteType: 'normal', content: [makeParagraphFrom([change])] };
}

function makeReviewerWithNotes(opts: {
  body?: DocumentBody['content'];
  footnotes?: Footnote[];
  endnotes?: Endnote[];
}): DocxReviewer {
  const doc = {
    package: {
      document: { content: opts.body ?? [makeParagraph('Body text')] } as DocumentBody,
      footnotes: opts.footnotes,
      endnotes: opts.endnotes,
    },
  } as Document;
  return new DocxReviewer(doc);
}

describe('acceptChange / rejectChange — in-note changes (fail-closed guard)', () => {
  test('acceptChange on a footnote-only change throws NoteChangeNotEditableError', () => {
    // id 5 lives only inside the footnote, not the body. The old behavior was a
    // misleading generic ChangeNotFoundError ("change not found") even though the
    // change exists — it just isn't reachable by the body-only accept path.
    const reviewer = makeReviewerWithNotes({
      footnotes: [makeFootnote(7, makeInsertion('footnote insertion', 5, 'Bob'))],
    });
    expect(() => reviewer.acceptChange(5)).toThrow(NoteChangeNotEditableError);
    // The note must NOT have been mutated.
    expect(reviewer.getChanges({ includeFootnotes: true })).toHaveLength(1);
  });

  test('rejectChange on an endnote-only change throws NoteChangeNotEditableError', () => {
    const reviewer = makeReviewerWithNotes({
      endnotes: [makeEndnote(3, makeDeletion('endnote deletion', 9, 'Carol'))],
    });
    expect(() => reviewer.rejectChange(9)).toThrow(NoteChangeNotEditableError);
    expect(reviewer.getChanges({ includeEndnotes: true })).toHaveLength(1);
  });

  test('the note error names the footnote/endnote limitation, not a generic not-found', () => {
    const reviewer = makeReviewerWithNotes({
      footnotes: [makeFootnote(7, makeInsertion('footnote insertion', 5, 'Bob'))],
    });
    let message = '';
    try {
      reviewer.acceptChange(5);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/footnote|endnote|note/i);
    expect(message).toContain('5');
  });

  test('a still-valid body change accepts exactly as before (no regression)', () => {
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraphFrom([makeInsertion('body add', 1, 'Alice')])],
      footnotes: [makeFootnote(7, makeInsertion('footnote insertion', 5, 'Bob'))],
    });
    reviewer.acceptChange(1);
    expect(reviewer.getChanges()).toHaveLength(0);
    // The note change is untouched.
    expect(reviewer.getChanges({ includeFootnotes: true })).toHaveLength(1);
  });

  test('collision (same id in body AND a note): body wins, note untouched, no error', () => {
    // A tracked-change w:id is unique only within its part, so the body and a
    // footnote can both carry id 5. accept/reject resolves the BODY change
    // (the part the public id has always addressed) and leaves the note alone —
    // it must never silently mutate the wrong part.
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraphFrom([makeInsertion('body add', 5, 'Alice')])],
      footnotes: [makeFootnote(30, makeInsertion('note add', 5, 'Alice'))],
    });
    expect(() => reviewer.acceptChange(5)).not.toThrow();
    // Body change consumed.
    expect(reviewer.getChanges()).toHaveLength(0);
    // Footnote change still present and unchanged.
    const noteChanges = reviewer.getChanges({ includeFootnotes: true });
    expect(noteChanges).toHaveLength(1);
    expect(noteChanges[0]).toMatchObject({ text: 'note add', noteId: 30 });
  });
});
