import { describe, test, expect } from 'bun:test';
import type {
  Comment,
  CommentRangeStart,
  CommentRangeEnd,
} from '@eigenpal/docx-editor-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import {
  makeRun,
  makeParagraph,
  makeInsertion,
  makeDeletion,
  makeParagraphFrom,
  makeTable,
  makeDoc,
  makeReviewer,
  textOf,
} from './_helpers';

// ============================================================================
// getContent
// ============================================================================

describe('getContent', () => {
  test('returns paragraphs with full text', () => {
    const reviewer = makeReviewer([
      makeParagraph('Hello world'),
      makeParagraph('Second paragraph'),
    ]);
    const content = reviewer.getContent();
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'paragraph', index: 0, text: 'Hello world' });
    expect(content[1]).toEqual({ type: 'paragraph', index: 1, text: 'Second paragraph' });
  });

  test('detects headings', () => {
    const reviewer = makeReviewer([
      makeParagraph('Title', 'Heading1'),
      makeParagraph('Subtitle', 'Heading2'),
      makeParagraph('Body text'),
    ]);
    const content = reviewer.getContent();
    expect(content[0]).toEqual({ type: 'heading', index: 0, level: 1, text: 'Title' });
    expect(content[1]).toEqual({ type: 'heading', index: 1, level: 2, text: 'Subtitle' });
    expect(content[2].type).toBe('paragraph');
  });

  test('extracts tables', () => {
    const reviewer = makeReviewer([
      makeParagraph('Before table'),
      makeTable([
        ['H1', 'H2'],
        ['A', 'B'],
      ]),
    ]);
    const content = reviewer.getContent();
    expect(content).toHaveLength(2);
    expect(content[1]).toMatchObject({
      type: 'table',
      index: 1,
      rows: [
        ['H1', 'H2'],
        ['A', 'B'],
      ],
    });
  });

  test('chunked reading with fromIndex/toIndex', () => {
    const reviewer = makeReviewer([
      makeParagraph('Para 0'),
      makeParagraph('Para 1'),
      makeParagraph('Para 2'),
      makeParagraph('Para 3'),
    ]);
    const content = reviewer.getContent({ fromIndex: 1, toIndex: 2 });
    expect(content).toHaveLength(2);
    expect(textOf(content[0])).toBe('Para 1');
    expect(textOf(content[1])).toBe('Para 2');
  });

  test('annotates tracked changes inline', () => {
    const para = makeParagraphFrom([
      makeRun('Price is '),
      makeDeletion('$100', 1, 'Jane'),
      makeInsertion('$200', 2, 'Jane'),
      makeRun('.'),
    ]);
    const reviewer = makeReviewer([para]);
    const content = reviewer.getContent();
    expect(textOf(content[0])).toBe('Price is [-$100-]{by:Jane}[+$200+]{by:Jane}.');
  });

  test('shows vanilla document when tracked-change annotations are disabled', () => {
    // Vanilla view: deletion text is still in the doc until the suggestion
    // is accepted, so the agent sees it as plain text. Insertion text isn't
    // in the doc yet, so the agent must not see it.
    const para = makeParagraphFrom([
      makeRun('Price is '),
      makeDeletion('$100', 1, 'Jane'),
      makeInsertion('$200', 2, 'Jane'),
      makeRun('.'),
    ]);
    const reviewer = makeReviewer([para]);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Price is $100.');
  });

  test('annotates comments inline', () => {
    const para = makeParagraphFrom([
      makeRun('The '),
      { type: 'commentRangeStart', id: 3 } as CommentRangeStart,
      makeRun('liability cap'),
      { type: 'commentRangeEnd', id: 3 } as CommentRangeEnd,
      makeRun(' is too low.'),
    ]);
    const reviewer = makeReviewer([para]);
    const content = reviewer.getContent();
    expect(textOf(content[0])).toBe('The [comment:3]liability cap[/comment] is too low.');
  });
});

// ============================================================================
// getChanges
// ============================================================================

describe('getChanges', () => {
  test('collects insertions and deletions', () => {
    const para = makeParagraphFrom([
      makeRun('Text '),
      makeInsertion('added', 1, 'Alice'),
      makeDeletion('removed', 2, 'Bob'),
    ]);
    const reviewer = makeReviewer([para]);
    const changes = reviewer.getChanges();
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ id: 1, type: 'insertion', author: 'Alice', text: 'added' });
    expect(changes[1]).toMatchObject({ id: 2, type: 'deletion', author: 'Bob', text: 'removed' });
  });

  test('returns empty for clean document', () => {
    const reviewer = makeReviewer([makeParagraph('Clean text')]);
    expect(reviewer.getChanges()).toHaveLength(0);
  });

  test('filters by author', () => {
    const para = makeParagraphFrom([makeInsertion('a', 1, 'Alice'), makeInsertion('b', 2, 'Bob')]);
    const reviewer = makeReviewer([para]);
    expect(reviewer.getChanges({ author: 'Alice' })).toHaveLength(1);
  });

  test('filters by type', () => {
    const para = makeParagraphFrom([makeInsertion('a', 1, 'Alice'), makeDeletion('b', 2, 'Alice')]);
    const reviewer = makeReviewer([para]);
    expect(reviewer.getChanges({ type: 'deletion' })).toHaveLength(1);
  });
});

// ============================================================================
// getComments
// ============================================================================

describe('getComments', () => {
  test('returns comments with anchored text', () => {
    const para = makeParagraphFrom([
      { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
      makeRun('important clause'),
      { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
    ]);
    const comment: Comment = {
      id: 1,
      author: 'Bob',
      date: '2024-01-01',
      content: [makeParagraph('Review this')],
    };
    const reviewer = makeReviewer([para], [comment]);
    const comments = reviewer.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: 1,
      author: 'Bob',
      text: 'Review this',
      anchoredText: 'important clause',
    });
  });

  test('returns empty for no comments', () => {
    const reviewer = makeReviewer([makeParagraph('No comments')]);
    expect(reviewer.getComments()).toHaveLength(0);
  });

  test('anchoredText follows the vanilla view: shows deletion, hides insertion', () => {
    // The comment range wraps a phrase that contains a tracked deletion AND a
    // tracked insertion. The agent should see deletion text in anchoredText
    // (still in the doc) but never insertion text (not in the doc yet).
    const para = makeParagraphFrom([
      { type: 'commentRangeStart', id: 7 } as CommentRangeStart,
      makeRun('cap is '),
      makeDeletion('$50k', 1, 'Reviewer'),
      makeInsertion('$500k', 2, 'Reviewer'),
      makeRun(' per year'),
      { type: 'commentRangeEnd', id: 7 } as CommentRangeEnd,
    ]);
    const comment: Comment = {
      id: 7,
      author: 'Bob',
      date: '2024-01-01',
      content: [makeParagraph('Confirm cap')],
    };
    const reviewer = makeReviewer([para], [comment]);
    const [c] = reviewer.getComments();
    expect(c.anchoredText).toContain('$50k');
    expect(c.anchoredText).not.toContain('$500k');
  });

  test('nests replies', () => {
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
    const result = reviewer.getComments();
    expect(result).toHaveLength(1);
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].replies[0]).toMatchObject({ author: 'Alice', text: 'Answer' });
  });
});

// ============================================================================
// getContentAsText
// ============================================================================

describe('getContentAsText', () => {
  test('formats paragraphs as plain text with indices', () => {
    const reviewer = makeReviewer([
      makeParagraph('First paragraph.'),
      makeParagraph('Second paragraph.'),
    ]);
    const text = reviewer.getContentAsText();
    expect(text).toContain('[0] First paragraph.');
    expect(text).toContain('[1] Second paragraph.');
  });

  test('shows table cell paragraphs with indices', () => {
    const doc = makeDoc([]);
    doc.package.document.content = [
      makeParagraph('Before table.'),
      makeTable([
        ['Cell A', 'Cell B'],
        ['Cell C', 'Cell D'],
      ]),
      makeParagraph('After table.'),
    ];
    const reviewer = new DocxReviewer(doc);
    const text = reviewer.getContentAsText();
    expect(text).toContain('[0] Before table.');
    expect(text).toContain('[1] (table, row 1, col 1) Cell A');
    expect(text).toContain('[2] (table, row 1, col 2) Cell B');
    expect(text).toContain('[3] (table, row 2, col 1) Cell C');
    expect(text).toContain('[4] (table, row 2, col 2) Cell D');
    expect(text).toContain('[5] After table.');
  });

  test('can comment on table cell paragraph by index', () => {
    const doc = makeDoc([]);
    doc.package.document.content = [
      makeParagraph('Before.'),
      makeTable([
        ['Cell A', 'Cell B'],
        ['Cell C', 'Cell D'],
      ]),
    ];
    const reviewer = new DocxReviewer(doc);
    // Comment on Cell C (row 2, col 1 = index 3)
    reviewer.addComment(3, 'Fix this cell.');
    const comments = reviewer.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0].paragraphIndex).toBe(3);
  });

  test('preserves smart quotes without JSON escaping', () => {
    const reviewer = makeReviewer([makeParagraph('The “liability cap” is too low.')]);
    const text = reviewer.getContentAsText();
    // Plain text — no \" or “ escaping
    expect(text).toContain('“liability cap”');
    expect(text).not.toContain('\\u201C');
  });
});

// ============================================================================
// Simplified API
// ============================================================================

describe('simplified API', () => {
  test('addComment(index, text) — Word-like shorthand', () => {
    const reviewer = new DocxReviewer(makeDoc([makeParagraph('Hello world')]), 'Reviewer');
    reviewer.addComment(0, 'Nice paragraph.');
    const comments = reviewer.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0].author).toBe('Reviewer');
    expect(comments[0].text).toBe('Nice paragraph.');
  });

  test('replace(index, search, replaceWith) — Word-like shorthand', () => {
    const reviewer = new DocxReviewer(makeDoc([makeParagraph('The cap is $50k.')]), 'Reviewer');
    reviewer.replace(0, '$50k', '$500k');
    const changes = reviewer.getChanges();
    expect(changes.some((c) => c.type === 'deletion' && c.text === '$50k')).toBe(true);
    expect(changes.some((c) => c.type === 'insertion' && c.text === '$500k')).toBe(true);
  });

  test('default author used in applyReview batch', () => {
    const reviewer = new DocxReviewer(makeDoc([makeParagraph('Hello world')]), 'Bot');
    reviewer.applyReview({
      comments: [{ paragraphIndex: 0, text: 'Test' }],
    });
    expect(reviewer.getComments()[0].author).toBe('Bot');
  });
});

// ============================================================================
// toDocument
// ============================================================================

describe('toDocument', () => {
  test('returns modified document', () => {
    const reviewer = makeReviewer([makeParagraph('Original')]);
    reviewer.addComment(0, 'Comment');
    const doc = reviewer.toDocument();
    expect(doc.package.document.comments).toHaveLength(1);
  });

  test('does not mutate original document', () => {
    const original = makeDoc([makeParagraph('Original')]);
    const reviewer = new DocxReviewer(original);
    reviewer.addComment(0, 'Comment');
    // Original should be untouched
    expect(original.package.document.comments).toBeUndefined();
  });
});
