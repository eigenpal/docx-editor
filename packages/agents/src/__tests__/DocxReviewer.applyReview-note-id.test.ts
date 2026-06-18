import { describe, test, expect } from 'bun:test';
import type {
  Document,
  DocumentBody,
  Footnote,
  Endnote,
} from '@eigenpal/docx-editor-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import { applyReview } from '../batch';
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

describe('applyReview — note-resident change ids', () => {
  test('a footnote-only id gets a note-specific error, not the generic not-found', () => {
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraph('Body text')],
      footnotes: [makeFootnote(7, makeInsertion('footnote insertion', 5, 'Bob'))],
    });
    // id 5 lives only inside the footnote — never in the body
    const result = reviewer.applyReview({ accept: [5] });
    expect(result.accepted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].operation).toBe('accept');
    expect(result.errors[0].id).toBe(5);
    expect(result.errors[0].error).toContain('footnote');
    expect(result.errors[0].error).not.toBe('Tracked change not found: id=5');
  });

  test('an endnote-only id gets a note-specific error on reject', () => {
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraph('Body text')],
      endnotes: [makeEndnote(3, makeDeletion('endnote deletion', 9, 'Carol'))],
    });
    const result = reviewer.applyReview({ reject: [9] });
    expect(result.rejected).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('endnote');
  });

  test('a genuinely-absent id still gets the generic not-found error', () => {
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraph('Body text')],
      footnotes: [makeFootnote(7, makeInsertion('fn', 5, 'Bob'))],
    });
    const result = reviewer.applyReview({ accept: [999] });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('Tracked change not found: id=999');
  });

  test('a body-resident id applies normally even when a note shares that id', () => {
    const reviewer = makeReviewerWithNotes({
      body: [makeParagraphFrom([makeInsertion('body add', 5, 'Alice')])],
      footnotes: [makeFootnote(7, makeInsertion('fn add', 5, 'Bob'))], // same w:id 5, in a note
    });
    const result = reviewer.applyReview({ accept: [5] });
    expect(result.accepted).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  test('free applyReview without notes keeps the generic error (back-compat)', () => {
    const body = { content: [makeParagraph('Body text')] } as DocumentBody;
    const result = applyReview(body, { accept: [5] }); // no notes arg
    expect(result.errors[0].error).toBe('Tracked change not found: id=5');
  });
});
