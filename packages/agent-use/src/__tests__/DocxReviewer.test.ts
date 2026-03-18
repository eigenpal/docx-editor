import { describe, test, expect } from 'bun:test';
import type {
  Paragraph,
  Run,
  Table,
  DocumentBody,
  Document,
  Insertion,
  Deletion,
  Comment,
  CommentRangeStart,
  CommentRangeEnd,
  ParagraphContent,
} from '@eigenpal/docx-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import { TextNotFoundError, ChangeNotFoundError, CommentNotFoundError } from '../errors';

// ============================================================================
// HELPERS — build minimal document structures for testing
// ============================================================================

function makeRun(text: string): Run {
  return { type: 'run', content: [{ type: 'text', text }] } as Run;
}

function makeParagraph(text: string, styleId?: string): Paragraph {
  return {
    type: 'paragraph',
    content: [makeRun(text)] as ParagraphContent[],
    formatting: styleId ? { styleId } : {},
  } as Paragraph;
}

function makeInsertion(text: string, id: number, author: string): Insertion {
  return {
    type: 'insertion',
    info: { id, author, date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

function makeDeletion(text: string, id: number, author: string): Deletion {
  return {
    type: 'deletion',
    info: { id, author, date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

function makeTable(cells: string[][]): Table {
  return {
    type: 'table',
    rows: cells.map((row) => ({
      cells: row.map((text) => ({
        content: [makeParagraph(text)],
      })),
    })),
  } as unknown as Table;
}

function makeDoc(content: (Paragraph | Table)[], comments?: Comment[]): Document {
  return {
    package: {
      document: {
        content,
        comments,
      } as DocumentBody,
    },
  } as Document;
}

function makeReviewer(content: (Paragraph | Table)[], comments?: Comment[]): DocxReviewer {
  return new DocxReviewer(makeDoc(content, comments));
}

/** Helper to access .text on ContentBlock (narrowing past TableBlock) */
function textOf(block: import('../types').ContentBlock): string {
  if ('text' in block) return block.text;
  throw new Error(`Block type ${block.type} has no text`);
}

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
    expect(content[1]).toEqual({
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeRun('Price is '),
        makeDeletion('$100', 1, 'Jane'),
        makeInsertion('$200', 2, 'Jane'),
        makeRun('.'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
    const reviewer = makeReviewer([para]);
    const content = reviewer.getContent();
    expect(textOf(content[0])).toBe('Price is [-$100-]{by:Jane}[+$200+]{by:Jane}.');
  });

  test('hides tracked changes when disabled', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeRun('Price is '),
        makeDeletion('$100', 1, 'Jane'),
        makeInsertion('$200', 2, 'Jane'),
        makeRun('.'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
    const reviewer = makeReviewer([para]);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Price is $200.');
  });

  test('annotates comments inline', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeRun('The '),
        { type: 'commentRangeStart', id: 3 } as CommentRangeStart,
        makeRun('liability cap'),
        { type: 'commentRangeEnd', id: 3 } as CommentRangeEnd,
        makeRun(' is too low.'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeRun('Text '),
        makeInsertion('added', 1, 'Alice'),
        makeDeletion('removed', 2, 'Bob'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [makeInsertion('a', 1, 'Alice'), makeInsertion('b', 2, 'Bob')] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
    const reviewer = makeReviewer([para]);
    expect(reviewer.getChanges({ author: 'Alice' })).toHaveLength(1);
  });

  test('filters by type', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeInsertion('a', 1, 'Alice'),
        makeDeletion('b', 2, 'Alice'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
    const reviewer = makeReviewer([para]);
    expect(reviewer.getChanges({ type: 'deletion' })).toHaveLength(1);
  });
});

// ============================================================================
// getComments
// ============================================================================

describe('getComments', () => {
  test('returns comments with anchored text', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
        makeRun('important clause'),
        { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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

  test('nests replies', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
        makeRun('text'),
        { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
        makeRun('text'),
        { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [makeRun('Hello '), makeInsertion('world', 1, 'Alice')] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
    const reviewer = makeReviewer([para]);
    reviewer.acceptChange(1);
    expect(reviewer.getChanges()).toHaveLength(0);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Hello world');
  });

  test('removes deletion text', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [makeRun('Keep '), makeDeletion('remove', 1, 'Alice')] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [makeRun('Hello '), makeInsertion('world', 1, 'Alice')] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
    const reviewer = makeReviewer([para]);
    reviewer.rejectChange(1);
    expect(reviewer.getChanges()).toHaveLength(0);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Hello ');
  });

  test('keeps deletion text', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [makeRun('Keep '), makeDeletion('this', 1, 'Alice')] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
    const reviewer = makeReviewer([para]);
    reviewer.rejectChange(1);
    expect(reviewer.getChanges()).toHaveLength(0);
    const content = reviewer.getContent({ includeTrackedChanges: false });
    expect(textOf(content[0])).toBe('Keep this');
  });
});

describe('acceptAll / rejectAll', () => {
  test('acceptAll processes all changes', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeInsertion('a', 1, 'Alice'),
        makeDeletion('b', 2, 'Bob'),
        makeInsertion('c', 3, 'Alice'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeRun('Text with '),
        makeInsertion('new stuff', 1, 'Alice'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
// textSearch
// ============================================================================

describe('textSearch', () => {
  test('finds text spanning multiple runs', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [makeRun('Hello '), makeRun('world')] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [makeRun('The \u201Cliability cap\u201D is $50k.')] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeRun('Requests with invalid types return HTTP 422. Each request is logged.'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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

  test('finds text inside tracked change wrappers', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeRun('Before '),
        makeInsertion('inside', 1, 'Alice'),
        makeRun(' after'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
    const reviewer = makeReviewer([para]);
    reviewer.addComment({
      paragraphIndex: 0,
      author: 'AI',
      text: 'note',
      search: 'inside',
    });
    expect(reviewer.getComments()).toHaveLength(1);
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
    const reviewer = makeReviewer([makeParagraph('The \u201Cliability cap\u201D is too low.')]);
    const text = reviewer.getContentAsText();
    // Plain text — no \" or \u201C escaping
    expect(text).toContain('\u201Cliability cap\u201D');
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
