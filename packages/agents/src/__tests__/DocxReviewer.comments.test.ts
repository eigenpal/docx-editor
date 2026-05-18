import { describe, test, expect } from 'bun:test';
import type {
  Paragraph,
  Comment,
  CommentRangeStart,
  CommentRangeEnd,
} from '@eigenpal/docx-editor-core/headless';
import { TextNotFoundError, CommentNotFoundError } from '../errors';
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
// addComment
// ============================================================================

describe('addComment', () => {
  test('adds comment to whole paragraph', () => {
    const reviewer = makeReviewer([makeParagraph('Liability cap is $50k.')]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'Too low.',
    });
    expect(id).toBe(1);
    const comments = reviewer.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ author: 'AI', text: 'Too low.' });
  });

  test('adds comment to specific text within paragraph', () => {
    const reviewer = makeReviewer([makeParagraph('The liability cap is $50k per year.')]);
    reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'Increase this.',
      search: '$50k',
    });
    const comments = reviewer.getComments();
    expect(comments[0].anchoredText).toContain('$50k');
  });

  test('throws on invalid paragraph index', () => {
    const reviewer = makeReviewer([makeParagraph('Only one paragraph')]);
    expect(() => reviewer.addComment({ paragraphIndex: 5, author: 'AI', text: 'note' })).toThrow();
  });

  test('throws TextNotFoundError when search text not in paragraph', () => {
    const reviewer = makeReviewer([makeParagraph('Some text here')]);
    expect(() =>
      reviewer.addComment({ paragraphIndex: 0, author: 'AI', text: 'note', search: 'nonexistent' })
    ).toThrow(TextNotFoundError);
  });

  // Regression: agents only see the vanilla document via read_document, so the
  // search phrase resolves against the same vanilla view. A phrase that
  // straddles a deletion (still in the doc until accepted) anchors fine; a
  // phrase that exists only inside an insertion (not in the doc yet) is
  // correctly reported as not found.
  test('anchors a phrase that includes deletion text', () => {
    const para = makeParagraphFrom([
      makeRun('The liability cap is '),
      makeDeletion('$50k', 1, 'Reviewer'),
      makeInsertion('$500k', 2, 'Reviewer'),
      makeRun(' per year.'),
    ]);
    const reviewer = makeReviewer([para]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'Confirm cap',
      search: 'cap is $50k per year',
    });
    expect(id).toBeGreaterThan(0);
  });

  test('rejects a phrase that exists only inside an insertion', () => {
    const para = makeParagraphFrom([
      makeRun('The liability cap is '),
      makeDeletion('$50k', 1, 'Reviewer'),
      makeInsertion('$500k', 2, 'Reviewer'),
      makeRun(' per year.'),
    ]);
    const reviewer = makeReviewer([para]);
    expect(() =>
      reviewer.addComment({
        paragraphIndex: 0,
        author: 'AI',
        text: 'Confirm cap',
        search: '$500k per year',
      })
    ).toThrow(TextNotFoundError);
  });
});

// ============================================================================
// replyTo
// ============================================================================

describe('replyTo', () => {
  test('adds reply to existing comment', () => {
    const comment: Comment = {
      id: 1,
      author: 'Bob',
      content: [makeParagraph('Check this')],
    };
    const para = makeParagraphFrom([
      { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
      makeRun('text'),
      { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
    ]);
    const reviewer = makeReviewer([para], [comment]);
    reviewer.replyTo(1, { author: 'AI', text: 'Agreed.' });
    const comments = reviewer.getComments();
    expect(comments[0].replies).toHaveLength(1);
  });

  test('throws CommentNotFoundError for invalid ID', () => {
    const reviewer = makeReviewer([makeParagraph('text')]);
    expect(() => reviewer.replyTo(999, { author: 'AI', text: 'reply' })).toThrow(
      CommentNotFoundError
    );
  });
});

// ============================================================================
// removeComment
// ============================================================================

describe('removeComment', () => {
  test('removes a whole-paragraph comment and its range markers', () => {
    const reviewer = makeReviewer([makeParagraph('Liability cap is $50k.')]);
    const id = reviewer.addComment(0, 'Too low.');
    expect(reviewer.getComments()).toHaveLength(1);

    reviewer.removeComment(id);

    expect(reviewer.getComments()).toHaveLength(0);
    const para = reviewer.toDocument().package.document.content[0] as Paragraph;
    const markers = para.content.filter(
      (c) => c.type === 'commentRangeStart' || c.type === 'commentRangeEnd'
    );
    expect(markers).toHaveLength(0);
  });

  test('removes an anchored comment and keeps surrounding runs', () => {
    const reviewer = makeReviewer([makeParagraph('The liability cap is $50k per year.')]);
    const id = reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'Increase this.',
      search: '$50k',
    });

    reviewer.removeComment(id);

    expect(reviewer.getComments()).toHaveLength(0);
    const content = reviewer.getContent();
    expect(textOf(content[0])).toBe('The liability cap is $50k per year.');
  });

  test('removing a top-level comment also removes its replies', () => {
    const para = makeParagraphFrom([
      { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
      makeRun('text'),
      { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
    ]);
    const comments: Comment[] = [
      { id: 1, author: 'Bob', content: [makeParagraph('Question')] },
      { id: 2, author: 'Alice', parentId: 1, content: [makeParagraph('Answer')] },
      { id: 3, author: 'Carol', parentId: 1, content: [makeParagraph('Also')] },
    ];
    const reviewer = makeReviewer([para], comments);

    reviewer.removeComment(1);

    expect(reviewer.getComments()).toHaveLength(0);
    expect(reviewer.toDocument().package.document.comments).toHaveLength(0);
  });

  test('removing a reply leaves the parent and its range markers intact', () => {
    const para = makeParagraphFrom([
      { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
      makeRun('text'),
      { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
    ]);
    const comments: Comment[] = [
      { id: 1, author: 'Bob', content: [makeParagraph('Question')] },
      { id: 2, author: 'Alice', parentId: 1, content: [makeParagraph('Answer')] },
    ];
    const reviewer = makeReviewer([para], comments);

    reviewer.removeComment(2);

    const remaining = reviewer.getComments();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(1);
    expect(remaining[0].replies).toHaveLength(0);
    expect(remaining[0].anchoredText).toBe('text');
  });

  test('only removes markers for the targeted comment', () => {
    const para = makeParagraphFrom([
      { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
      makeRun('a '),
      { type: 'commentRangeStart', id: 2 } as CommentRangeStart,
      makeRun('b'),
      { type: 'commentRangeEnd', id: 2 } as CommentRangeEnd,
      makeRun(' c'),
      { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
    ]);
    const comments: Comment[] = [
      { id: 1, author: 'Bob', content: [makeParagraph('outer')] },
      { id: 2, author: 'Alice', content: [makeParagraph('inner')] },
    ];
    const reviewer = makeReviewer([para], comments);

    reviewer.removeComment(1);

    const remaining = reviewer.getComments();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(2);
    expect(remaining[0].anchoredText).toBe('b');
  });

  test('throws CommentNotFoundError for unknown ID', () => {
    const reviewer = makeReviewer([makeParagraph('text')]);
    expect(() => reviewer.removeComment(999)).toThrow(CommentNotFoundError);
  });
});
