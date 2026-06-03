import { describe, test, expect } from 'bun:test';
import type {
  Document,
  DocumentBody,
  Footnote,
  Endnote,
} from '@eigenpal/docx-editor-core/headless';
import { DocxReviewer } from '../DocxReviewer';
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

describe('getChanges — note bodies', () => {
  test('ignores note changes by default (body-only behavior preserved)', () => {
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraphFrom([makeInsertion('body add', 1, 'Alice')])],
      footnotes: [makeFootnote(2, makeInsertion('note add', 5, 'Bob'))],
    });
    const changes = reviewer.getChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: 1, text: 'body add' });
    expect(changes[0].noteId).toBeUndefined();
    expect(changes[0].noteType).toBeUndefined();
  });

  test('surfaces footnote changes with noteId and noteType when opted in', () => {
    const reviewer = makeReviewerWithNotes({
      footnotes: [makeFootnote(7, makeInsertion('footnote insertion', 5, 'Bob'))],
    });
    const changes = reviewer.getChanges({ includeFootnotes: true });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      id: 5,
      type: 'insertion',
      text: 'footnote insertion',
      noteId: 7,
      noteType: 'footnote',
    });
  });

  test('surfaces endnote changes with noteType endnote when opted in', () => {
    const reviewer = makeReviewerWithNotes({
      endnotes: [makeEndnote(3, makeDeletion('endnote deletion', 9, 'Carol'))],
    });
    const changes = reviewer.getChanges({ includeEndnotes: true });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      id: 9,
      type: 'deletion',
      text: 'endnote deletion',
      noteId: 3,
      noteType: 'endnote',
    });
  });

  test('reports body and note changes together, tagged by location', () => {
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraphFrom([makeInsertion('body add', 1, 'Alice')])],
      footnotes: [makeFootnote(10, makeInsertion('fn add', 2, 'Alice'))],
      endnotes: [makeEndnote(11, makeDeletion('en del', 3, 'Alice'))],
    });
    const changes = reviewer.getChanges({ includeFootnotes: true, includeEndnotes: true });
    expect(changes).toHaveLength(3);
    expect(changes.find((c) => c.id === 1)?.noteType).toBeUndefined();
    expect(changes.find((c) => c.id === 2)?.noteType).toBe('footnote');
    expect(changes.find((c) => c.id === 3)?.noteType).toBe('endnote');
  });

  test('author/type filters apply to note changes too', () => {
    const reviewer = makeReviewerWithNotes({
      footnotes: [
        makeFootnote(20, makeInsertion('keep', 4, 'Alice')),
        makeFootnote(21, makeInsertion('drop', 5, 'Bob')),
      ],
    });
    const byAuthor = reviewer.getChanges({ includeFootnotes: true, author: 'Alice' });
    expect(byAuthor).toHaveLength(1);
    expect(byAuthor[0].id).toBe(4);
  });

  test('does not surface note changes when notes opt-in but no notes present', () => {
    const reviewer = makeReviewerWithNotes({ body: [makeParagraph('clean')] });
    expect(reviewer.getChanges({ includeFootnotes: true, includeEndnotes: true })).toHaveLength(0);
  });

  test('a body change and a note change that share an id do not clobber each other', () => {
    // w:ins ids are unique only within a part, so the body and a footnote can
    // both carry id 5. Both must survive as distinct changes.
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraphFrom([makeInsertion('body add', 5, 'Alice')])],
      footnotes: [makeFootnote(30, makeInsertion('note add', 5, 'Alice'))],
    });
    const changes = reviewer.getChanges({ includeFootnotes: true });
    expect(changes).toHaveLength(2);
    const body = changes.find((c) => c.noteType === undefined);
    const note = changes.find((c) => c.noteType === 'footnote');
    expect(body?.text).toBe('body add');
    expect(note?.text).toBe('note add');
    expect(note?.noteId).toBe(30);
  });
});
