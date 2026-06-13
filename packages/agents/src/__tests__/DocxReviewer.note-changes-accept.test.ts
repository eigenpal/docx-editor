/**
 * Accept/reject of tracked changes inside footnote/endnote bodies.
 *
 * Lifts #646's "discovery only" limitation: a ReviewChange carrying
 * noteId/noteType (or acceptAll/rejectAll with include* opts) now resolves the
 * change inside the note, and the result persists through toBuffer().
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import type {
  Document,
  DocumentBody,
  Paragraph,
  Footnote,
  Endnote,
  ParagraphContent,
} from '@eigenpal/docx-editor-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import { ChangeNotFoundError } from '../errors';
import { makeRun, makeInsertion, makeDeletion, makeParagraph, makeParagraphFrom } from './_helpers';

function endnote(id: number, content: Paragraph[]): Endnote {
  return { type: 'endnote', id, noteType: 'normal', content };
}
function footnote(id: number, content: Paragraph[]): Footnote {
  return { type: 'footnote', id, noteType: 'normal', content };
}
function reviewerWith(opts: {
  body?: Paragraph[];
  footnotes?: Footnote[];
  endnotes?: Endnote[];
}): DocxReviewer {
  const doc = {
    package: {
      document: { content: opts.body ?? [makeParagraph('body')], comments: [] } as DocumentBody,
      footnotes: opts.footnotes,
      endnotes: opts.endnotes,
    },
  } as Document;
  return new DocxReviewer(doc, 'AI');
}

const para = (content: ParagraphContent[]) => makeParagraphFrom(content);

describe('accept/reject a tracked change inside a note', () => {
  test('accept an insertion in an endnote → unwrapped, discovery clears', () => {
    const reviewer = reviewerWith({
      endnotes: [endnote(2, [para([makeRun('see '), makeInsertion('Smith', 100, 'AI')])])],
    });
    const change = reviewer.getChanges({ includeEndnotes: true })[0];
    expect(change).toMatchObject({ noteType: 'endnote', noteId: 2, type: 'insertion' });

    reviewer.acceptChange(change);

    expect(reviewer.getChanges({ includeEndnotes: true })).toHaveLength(0);
    // Insertion text survives as a plain run.
    const en = (reviewer.toDocument().package.endnotes ?? [])[0];
    const text = (en.content[0] as Paragraph).content
      .flatMap((it) => (it.type === 'run' ? it.content : []))
      .filter((r) => r.type === 'text')
      .map((r) => (r as { text: string }).text)
      .join('');
    expect(text).toBe('see Smith');
  });

  test('reject an insertion in an endnote → removed', () => {
    const reviewer = reviewerWith({
      endnotes: [endnote(2, [para([makeRun('see '), makeInsertion('Smith', 100, 'AI')])])],
    });
    reviewer.rejectChange(reviewer.getChanges({ includeEndnotes: true })[0]);
    expect(reviewer.getChanges({ includeEndnotes: true })).toHaveLength(0);
    const en = (reviewer.toDocument().package.endnotes ?? [])[0];
    const text = (en.content[0] as Paragraph).content
      .flatMap((it) => (it.type === 'run' ? it.content : []))
      .filter((r) => r.type === 'text')
      .map((r) => (r as { text: string }).text)
      .join('');
    expect(text).toBe('see ');
  });

  test('accept a deletion in a footnote → removed; reject → kept', () => {
    const accept = reviewerWith({
      footnotes: [footnote(1, [para([makeRun('keep '), makeDeletion('cut', 50, 'AI')])])],
    });
    accept.acceptChange(accept.getChanges({ includeFootnotes: true })[0]);
    expect(accept.getChanges({ includeFootnotes: true })).toHaveLength(0);

    const reject = reviewerWith({
      footnotes: [footnote(1, [para([makeRun('keep '), makeDeletion('cut', 50, 'AI')])])],
    });
    reject.rejectChange(reject.getChanges({ includeFootnotes: true })[0]);
    expect(reject.getChanges({ includeFootnotes: true })).toHaveLength(0);
    const fn = (reject.toDocument().package.footnotes ?? [])[0];
    const text = (fn.content[0] as Paragraph).content
      .flatMap((it) => (it.type === 'run' ? it.content : []))
      .filter((r) => r.type === 'text')
      .map((r) => (r as { text: string }).text)
      .join('');
    expect(text).toBe('keep cut'); // rejected deletion keeps the text
  });
});

describe('collision + back-compat', () => {
  test('acceptChange(number) resolves the body change, not a note change with the same id', () => {
    const reviewer = reviewerWith({
      body: [para([makeRun('body '), makeInsertion('B', 5, 'AI')])],
      endnotes: [endnote(2, [para([makeRun('note '), makeInsertion('N', 5, 'AI')])])],
    });
    expect(reviewer.getChanges({ includeEndnotes: true })).toHaveLength(2); // distinct locations

    reviewer.acceptChange(5); // numeric → body only

    expect(reviewer.getChanges()).toHaveLength(0); // body cleared
    expect(reviewer.getChanges({ includeEndnotes: true })).toHaveLength(1); // note change survives
  });

  test('unknown noteId throws ChangeNotFoundError', () => {
    const reviewer = reviewerWith({
      endnotes: [endnote(2, [para([makeRun('x '), makeInsertion('y', 100, 'AI')])])],
    });
    expect(() =>
      reviewer.acceptChange({
        id: 100,
        type: 'insertion',
        author: 'AI',
        date: null,
        text: 'y',
        context: '',
        paragraphIndex: 0,
        noteId: 999,
        noteType: 'endnote',
      })
    ).toThrow(ChangeNotFoundError);
  });

  test('a noteType without a noteId fails loud (does not silently hit the body)', () => {
    const reviewer = reviewerWith({
      body: [para([makeRun('b '), makeInsertion('B', 7, 'AI')])],
      endnotes: [endnote(2, [para([makeRun('e '), makeInsertion('E', 7, 'AI')])])],
    });
    // Malformed: note-intent (noteType) but no noteId → must throw, not resolve in body.
    expect(() =>
      reviewer.acceptChange({
        id: 7,
        type: 'insertion',
        author: 'AI',
        date: null,
        text: 'B',
        context: '',
        paragraphIndex: 0,
        noteType: 'endnote',
      })
    ).toThrow(ChangeNotFoundError);
    // Body change untouched (proves it didn't silently route there).
    expect(reviewer.getChanges()).toHaveLength(1);
  });
});

describe('acceptAll / rejectAll with note opt-in', () => {
  test('acceptAll() is body-only by default; note changes survive', () => {
    const reviewer = reviewerWith({
      body: [para([makeRun('b '), makeInsertion('B', 1, 'AI')])],
      endnotes: [endnote(2, [para([makeRun('e '), makeInsertion('E', 2, 'AI')])])],
    });
    expect(reviewer.acceptAll()).toBe(1); // body only
    expect(reviewer.getChanges({ includeEndnotes: true })).toHaveLength(1); // note untouched
  });

  test('acceptAll({includeEndnotes}) resolves body + endnote changes', () => {
    const reviewer = reviewerWith({
      body: [para([makeRun('b '), makeInsertion('B', 1, 'AI')])],
      endnotes: [
        endnote(2, [para([makeRun('e '), makeInsertion('E', 2, 'AI')])]),
        endnote(3, [para([makeRun('f '), makeDeletion('X', 3, 'AI')])]),
      ],
    });
    expect(reviewer.acceptAll({ includeEndnotes: true })).toBe(3);
    expect(reviewer.getChanges({ includeEndnotes: true })).toHaveLength(0);
  });
});

describe('round-trip: accept an endnote change, save, reload', () => {
  const FIXTURE = path.resolve(__dirname, '../../../../e2e/fixtures/endnotes-tracked-changes.docx');
  const loadBuffer = (): ArrayBuffer => {
    const buf = readFileSync(FIXTURE);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };

  test('accepted endnote change is gone after toBuffer → fromBuffer', async () => {
    const reviewer = await DocxReviewer.fromBuffer(loadBuffer(), 'AI');
    const before = reviewer.getChanges({ includeEndnotes: true });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ noteType: 'endnote' });

    reviewer.acceptChange(before[0]);
    const reloaded = await DocxReviewer.fromBuffer(await reviewer.toBuffer(), 'AI');

    expect(reloaded.getChanges({ includeEndnotes: true })).toHaveLength(0);
  });
});
