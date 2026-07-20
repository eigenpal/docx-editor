import { describe, test, expect } from 'bun:test';
import { ChangeNotFoundError } from '../errors';
import {
  makeRun,
  makeParagraph,
  makeInsertion,
  makeDeletion,
  makeParagraphFrom,
  makeReviewer,
  textOf,
} from './_helpers';

// ============================================================================
// proposeReplacement / proposeInsertion / proposeDeletion
// ============================================================================

describe('proposeReplacement', () => {
  test('creates deletion + insertion tracked changes', () => {
    const reviewer = makeReviewer([makeParagraph('Price is $50,000.')]);
    reviewer.proposeReplacement({
      paragraphIndex: 0,
      search: '$50,000',
      author: 'AI',
      replaceWith: '$500,000',
    });
    const changes = reviewer.getChanges();
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.type === 'deletion')?.text).toBe('$50,000');
    expect(changes.find((c) => c.type === 'insertion')?.text).toBe('$500,000');
  });
});

describe('proposeInsertion', () => {
  test('inserts tracked change at end of paragraph', () => {
    const reviewer = makeReviewer([makeParagraph('All licenses shall cease.')]);
    reviewer.proposeInsertion({
      paragraphIndex: 0,
      author: 'AI',
      insertText: ' Sections 5 and 6 survive.',
      position: 'after',
    });
    const changes = reviewer.getChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('insertion');
    expect(changes[0].text).toBe(' Sections 5 and 6 survive.');
  });
});

describe('proposeDeletion', () => {
  test('wraps matched text in deletion', () => {
    const reviewer = makeReviewer([makeParagraph('Remove this clause entirely.')]);
    reviewer.proposeDeletion({
      paragraphIndex: 0,
      search: 'this clause',
      author: 'AI',
    });
    const changes = reviewer.getChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('deletion');
    expect(changes[0].text).toBe('this clause');
  });
});

// ============================================================================
// acceptChange / rejectChange
// ============================================================================

describe('acceptChange', () => {
  test('keeps insertion text', () => {
    const para = makeParagraphFrom([makeRun('Hello '), makeInsertion('world', 1, 'Alice')]);
    const reviewer = makeReviewer([para]);
    reviewer.acceptChange(1);
    expect(reviewer.getChanges()).toHaveLength(0);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Hello world');
  });

  test('removes deletion text', () => {
    const para = makeParagraphFrom([makeRun('Keep '), makeDeletion('remove', 1, 'Alice')]);
    const reviewer = makeReviewer([para]);
    reviewer.acceptChange(1);
    expect(reviewer.getChanges()).toHaveLength(0);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Keep ');
  });

  test('throws ChangeNotFoundError for invalid ID', () => {
    const reviewer = makeReviewer([makeParagraph('text')]);
    expect(() => reviewer.acceptChange(999)).toThrow(ChangeNotFoundError);
  });
});

describe('rejectChange', () => {
  test('removes insertion text', () => {
    const para = makeParagraphFrom([makeRun('Hello '), makeInsertion('world', 1, 'Alice')]);
    const reviewer = makeReviewer([para]);
    reviewer.rejectChange(1);
    expect(reviewer.getChanges()).toHaveLength(0);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Hello ');
  });

  test('keeps deletion text', () => {
    const para = makeParagraphFrom([makeRun('Keep '), makeDeletion('this', 1, 'Alice')]);
    const reviewer = makeReviewer([para]);
    reviewer.rejectChange(1);
    expect(reviewer.getChanges()).toHaveLength(0);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Keep this');
  });
});

describe('acceptAll / rejectAll', () => {
  test('acceptAll processes all changes', () => {
    const para = makeParagraphFrom([
      makeInsertion('a', 1, 'Alice'),
      makeDeletion('b', 2, 'Bob'),
      makeInsertion('c', 3, 'Alice'),
    ]);
    const reviewer = makeReviewer([para]);
    const count = reviewer.acceptAll();
    expect(count).toBe(3);
    expect(reviewer.getChanges()).toHaveLength(0);
  });
});

// ============================================================================
// applyReview (batch)
// ============================================================================

describe('applyReview', () => {
  test('processes mixed operations', () => {
    const para = makeParagraphFrom([makeRun('Text with '), makeInsertion('new stuff', 1, 'Alice')]);
    const reviewer = makeReviewer([para, makeParagraph('Another paragraph')]);
    const result = reviewer.applyReview({
      accept: [1],
      comments: [{ paragraphIndex: 1, author: 'AI', text: 'Review this' }],
    });
    expect(result.accepted).toBe(1);
    expect(result.commentsAdded).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  test('collects errors without stopping', () => {
    const reviewer = makeReviewer([makeParagraph('Text')]);
    const result = reviewer.applyReview({
      accept: [999],
      comments: [{ paragraphIndex: 0, author: 'AI', text: 'Works' }],
    });
    expect(result.accepted).toBe(0);
    expect(result.commentsAdded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].operation).toBe('accept');
  });

  test('empty batch returns zeros', () => {
    const reviewer = makeReviewer([makeParagraph('Text')]);
    const result = reviewer.applyReview({});
    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.commentsAdded).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================================
// getChanges — cross-paragraph reused revision id (read_changes under-report)
// ============================================================================

describe('getChanges — reused w:id across paragraphs', () => {
  // A tracked-change `w:id` is unique only within its part; Word routinely emits
  // the SAME revision id on distinct changes in different paragraphs. getChanges
  // must enumerate every one — not collapse two same-id changes into a single
  // entry, silently dropping the earlier paragraph's change. Mirrors the field
  // repro where three body deletions surfaced as two (the middle one dropped)
  // while acceptAll reported all three.
  const buildThreeDeletions = () =>
    makeReviewer([
      makeParagraphFrom([makeRun('Keep one '), makeDeletion('alpha', 1, 'Alice')]),
      makeParagraphFrom([makeRun('Keep two '), makeDeletion('bravo', 7, 'Alice')]),
      makeParagraphFrom([makeRun('Keep three '), makeDeletion('charlie', 7, 'Alice')]),
    ]);

  test('enumerates every deletion even when two paragraphs share a w:id', () => {
    const changes = buildThreeDeletions().getChanges();
    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.text).sort()).toEqual(['alpha', 'bravo', 'charlie']);
    // paragraphIndex disambiguates the two id-7 changes (one per paragraph).
    expect(
      changes
        .filter((c) => c.id === 7)
        .map((c) => c.paragraphIndex)
        .sort()
    ).toEqual([1, 2]);
  });

  test('getChanges count agrees with acceptAll count', () => {
    // The cross-check that caught the bug in the field: read_changes listed 2
    // while accept_all reported 3.
    expect(buildThreeDeletions().getChanges()).toHaveLength(buildThreeDeletions().acceptAll());
  });
});
