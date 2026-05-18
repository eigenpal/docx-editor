import { describe, test, expect } from 'bun:test';
import type { Insertion, Deletion } from '@eigenpal/docx-editor-core/headless';
import { TextNotFoundError } from '../errors';
import {
  makeRun,
  makeInsertion,
  makeDeletion,
  makeMoveFrom,
  makeMoveTo,
  makeHyperlink,
  makeParagraphFrom,
  makeReviewer,
  textOf,
} from './_helpers';

// ============================================================================
// textSearch
// ============================================================================

describe('textSearch', () => {
  test('finds text spanning multiple runs', () => {
    const para = makeParagraphFrom([makeRun('Hello '), makeRun('world')]);
    const reviewer = makeReviewer([para]);
    // Should not throw when searching across runs
    reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'lo wor',
    });
    expect(reviewer.getComments()).toHaveLength(1);
  });

  test('matches with normalized quotes and whitespace', () => {
    const para = makeParagraphFrom([makeRun('The “liability cap” is $50k.')]);
    const reviewer = makeReviewer([para]);
    // LLM sends straight quotes — normalized matching handles it
    reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: '"liability cap"',
    });
    expect(reviewer.getComments()).toHaveLength(1);
  });

  test('handles LLM truncation (trailing partial words)', () => {
    const para = makeParagraphFrom([
      makeRun('Requests with invalid types return HTTP 422. Each request is logged.'),
    ]);
    const reviewer = makeReviewer([para]);
    // LLM truncated: "return HTTP 422. e." instead of full text
    reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'return HTTP 422. e.',
    });
    expect(reviewer.getComments()).toHaveLength(1);
  });

  test('finds text inside a deletion wrapper (still in the vanilla doc)', () => {
    const para = makeParagraphFrom([
      makeRun('Before '),
      makeDeletion('inside', 1, 'Alice'),
      makeRun(' after'),
    ]);
    const reviewer = makeReviewer([para]);
    reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'inside',
    });
    expect(reviewer.getComments()).toHaveLength(1);
  });

  test('does not find text inside an insertion wrapper (not in the vanilla doc)', () => {
    const para = makeParagraphFrom([
      makeRun('Before '),
      makeInsertion('inside', 1, 'Alice'),
      makeRun(' after'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(() =>
      reviewer.addComment({
        paragraphIndex: 0,
        author: 'AI',
        text: 'note',
        search: 'inside',
      })
    ).toThrow(TextNotFoundError);
  });
});

// ============================================================================
// Vanilla-view regression suite
//
// "Vanilla view" = the document as the agent reads it via read_document with
// includeTrackedChanges=false. Pre-acceptance state of the doc:
//   plain runs / hyperlinks → visible
//   <w:del> / <w:moveFrom>  → visible (still in the doc until accepted)
//   <w:ins> / <w:moveTo>    → hidden  (not in the doc until accepted)
//
// The same partition is used by findTextInParagraph (anchor search) and by
// reviewerBridge.findText. These tests pin the matrix end-to-end so a future
// edit can't drift the views out of sync without a test failure.
// ============================================================================

describe('vanilla view (read_document)', () => {
  test('hides a single insertion', () => {
    const para = makeParagraphFrom([
      makeRun('Before '),
      makeInsertion('inserted', 1, 'A'),
      makeRun(' after.'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe('Before  after.');
  });

  test('shows a single deletion as plain text', () => {
    const para = makeParagraphFrom([
      makeRun('Keep '),
      makeDeletion('deleted', 1, 'A'),
      makeRun(' after.'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe(
      'Keep deleted after.'
    );
  });

  test('hides moveTo (treated as insertion-side of a move)', () => {
    const para = makeParagraphFrom([
      makeRun('Around '),
      makeMoveTo('moved-to', 1, 'A'),
      makeRun('.'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe('Around .');
  });

  test('shows moveFrom (treated as deletion-side of a move)', () => {
    const para = makeParagraphFrom([
      makeRun('Around '),
      makeMoveFrom('moved-from', 1, 'A'),
      makeRun('.'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe(
      'Around moved-from.'
    );
  });

  test('hides multiple insertions, all of them', () => {
    const para = makeParagraphFrom([
      makeRun('A '),
      makeInsertion('one', 1, 'A'),
      makeRun(' B '),
      makeInsertion('two', 2, 'A'),
      makeRun(' C'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe('A  B  C');
  });

  test('shows multiple deletions, all of them, in document order', () => {
    const para = makeParagraphFrom([
      makeRun('A '),
      makeDeletion('one', 1, 'A'),
      makeRun(' B '),
      makeDeletion('two', 2, 'A'),
      makeRun(' C'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe('A one B two C');
  });

  test('preserves order across mixed plain / insertion / deletion runs', () => {
    const para = makeParagraphFrom([
      makeRun('a '),
      makeInsertion('b', 1, 'A'),
      makeRun(' c '),
      makeDeletion('d', 2, 'A'),
      makeRun(' e'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe('a  c d e');
  });

  test('annotated view still wraps insertions and deletions when enabled', () => {
    // Sanity check that the vanilla-view flip didn't break the annotated path.
    const para = makeParagraphFrom([
      makeRun('Price '),
      makeDeletion('$100', 1, 'Jane'),
      makeInsertion('$200', 2, 'Jane'),
      makeRun('.'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: true })[0])).toBe(
      'Price [-$100-]{by:Jane}[+$200+]{by:Jane}.'
    );
  });

  test('paragraph that is entirely an insertion renders empty in vanilla view', () => {
    const para = makeParagraphFrom([makeInsertion('only inserted text', 1, 'A')]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe('');
  });

  test('paragraph that is entirely a deletion still renders its text', () => {
    const para = makeParagraphFrom([makeDeletion('only deleted text', 1, 'A')]);
    const reviewer = makeReviewer([para]);
    expect(textOf(reviewer.getContent({ includeTrackedChanges: false })[0])).toBe(
      'only deleted text'
    );
  });
});

describe('vanilla view (anchor search)', () => {
  // findTextInParagraph drives addComment / proposeReplacement / proposeDeletion.
  // These tests use addComment as a thin proxy — a successful call means the
  // search resolved against the vanilla flatten.

  test('phrase straddling plain → deletion anchors successfully', () => {
    const para = makeParagraphFrom([
      makeRun('The cap is '),
      makeDeletion('$50k', 1, 'A'),
      makeRun(' per year.'),
    ]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'cap is $50k',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('phrase straddling deletion → plain anchors successfully', () => {
    const para = makeParagraphFrom([
      makeRun('Header. '),
      makeDeletion('Cap is $50k', 1, 'A'),
      makeRun(' per year.'),
    ]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: '$50k per year',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('phrase straddling plain → deletion → plain anchors successfully', () => {
    const para = makeParagraphFrom([
      makeRun('alpha '),
      makeDeletion('beta', 1, 'A'),
      makeRun(' gamma'),
    ]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'alpha beta gamma',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('phrase straddling plain → insertion fails (insertion text invisible)', () => {
    // Use a phrase where the trim-trailing-words LLM-truncation fallback
    // (textSearch.ts findMatch) cannot rescue the search by dropping enough
    // words to land in the surviving plain text. The insertion is in the
    // middle of the phrase, so any non-empty trim still references it.
    const para = makeParagraphFrom([
      makeRun('The cap is '),
      makeInsertion('$500k', 1, 'A'),
      makeRun(' per year.'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(() =>
      reviewer.addComment({
        paragraphIndex: 0,
        author: 'AI',
        text: 'note',
        search: 'is $500k per',
      })
    ).toThrow(TextNotFoundError);
  });

  test('phrase entirely inside a deletion anchors successfully', () => {
    const para = makeParagraphFrom([
      makeRun('keep '),
      makeDeletion('hello world goodbye', 1, 'A'),
      makeRun(' keep'),
    ]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'world',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('phrase entirely inside an insertion is not found', () => {
    const para = makeParagraphFrom([
      makeRun('keep '),
      makeInsertion('hello world goodbye', 1, 'A'),
      makeRun(' keep'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(() =>
      reviewer.addComment({ paragraphIndex: 0, author: 'AI', text: 'note', search: 'world' })
    ).toThrow(TextNotFoundError);
  });

  test('moveFrom text is searchable (vanilla-visible like deletion)', () => {
    const para = makeParagraphFrom([
      makeRun('keep '),
      makeMoveFrom('movefrom payload', 1, 'A'),
      makeRun(' keep'),
    ]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'movefrom payload',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('moveTo text is not searchable (vanilla-hidden like insertion)', () => {
    const para = makeParagraphFrom([
      makeRun('keep '),
      makeMoveTo('moveto payload', 1, 'A'),
      makeRun(' keep'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(() =>
      reviewer.addComment({
        paragraphIndex: 0,
        author: 'AI',
        text: 'note',
        search: 'moveto payload',
      })
    ).toThrow(TextNotFoundError);
  });

  test('hyperlink runs remain searchable', () => {
    const para = makeParagraphFrom([makeRun('see '), makeHyperlink('docs page'), makeRun(' end')]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'docs page',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('hyperlink inside a deletion is searchable (vanilla-visible)', () => {
    const deletionWithHyperlink: Deletion = {
      type: 'deletion',
      info: { id: 1, author: 'A', date: '2024-01-01T00:00:00Z' },
      content: [makeHyperlink('removed link text')],
    };
    const para = makeParagraphFrom([makeRun('See '), deletionWithHyperlink, makeRun(' done.')]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'removed link text',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('hyperlink inside an insertion is not searchable (vanilla-hidden)', () => {
    const insertionWithHyperlink: Insertion = {
      type: 'insertion',
      info: { id: 1, author: 'A', date: '2024-01-01T00:00:00Z' },
      content: [makeHyperlink('inserted link text')],
    };
    const para = makeParagraphFrom([makeRun('See '), insertionWithHyperlink, makeRun(' done.')]);
    const reviewer = makeReviewer([para]);
    expect(() =>
      reviewer.addComment({
        paragraphIndex: 0,
        author: 'AI',
        text: 'note',
        search: 'inserted link text',
      })
    ).toThrow(TextNotFoundError);
  });

  test('phrase that exists in plain AND inside an insertion resolves on the plain occurrence', () => {
    // Pre-fix: flattenRuns concatenated the insertion text too, so the second
    // occurrence flagged the search as ambiguous. Post-fix: only the plain
    // occurrence is in the vanilla haystack, so the anchor lands there.
    const para = makeParagraphFrom([
      makeRun('alpha target beta '),
      makeInsertion('target', 1, 'A'),
      makeRun(' gamma'),
    ]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'target',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('proposeDeletion can target text inside an existing deletion (vanilla-visible)', () => {
    // Defensive cross-cut: the search layer is shared with proposeDeletion.
    const para = makeParagraphFrom([
      makeRun('keep '),
      makeDeletion('targetable phrase', 1, 'Reviewer'),
      makeRun(' keep'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(() =>
      reviewer.proposeDeletion({
        paragraphIndex: 0,
        search: 'targetable phrase',
        author: 'AI',
      })
    ).not.toThrow();
  });
});
