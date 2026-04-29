import { describe, test, expect } from 'bun:test';
import type {
  Paragraph,
  Run,
  Table,
  Hyperlink,
  DocumentBody,
  Document,
  Insertion,
  Deletion,
  MoveFrom,
  MoveTo,
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

function makeMoveFrom(text: string, id: number, author: string): MoveFrom {
  return {
    type: 'moveFrom',
    info: { id, author, date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

function makeMoveTo(text: string, id: number, author: string): MoveTo {
  return {
    type: 'moveTo',
    info: { id, author, date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

function makeHyperlink(text: string, href = 'https://example.com'): Hyperlink {
  return { type: 'hyperlink', href, children: [makeRun(text)] } as Hyperlink;
}

function makeParagraphFrom(content: ParagraphContent[]): Paragraph {
  return { type: 'paragraph', content, formatting: {} } as Paragraph;
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

  test('shows vanilla document when tracked-change annotations are disabled', () => {
    // Vanilla view: deletion text is still in the doc until the suggestion
    // is accepted, so the agent sees it as plain text. Insertion text isn't
    // in the doc yet, so the agent must not see it.
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
    expect(textOf(content[0])).toBe('Price is $100.');
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

  // Regression: agents only see the vanilla document via read_document, so the
  // search phrase resolves against the same vanilla view. A phrase that
  // straddles a deletion (still in the doc until accepted) anchors fine; a
  // phrase that exists only inside an insertion (not in the doc yet) is
  // correctly reported as not found.
  test('anchors a phrase that includes deletion text', () => {
    const para: Paragraph = {
      type: 'paragraph',
      paraId: 'p_a',
      content: [
        makeRun('The liability cap is '),
        makeDeletion('$50k', 1, 'Reviewer'),
        makeInsertion('$500k', 2, 'Reviewer'),
        makeRun(' per year.'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
    const para: Paragraph = {
      type: 'paragraph',
      paraId: 'p_a',
      content: [
        makeRun('The liability cap is '),
        makeDeletion('$50k', 1, 'Reviewer'),
        makeInsertion('$500k', 2, 'Reviewer'),
        makeRun(' per year.'),
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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
      { id: 3, author: 'Carol', parentId: 1, content: [makeParagraph('Also')] },
    ];
    const reviewer = makeReviewer([para], comments);

    reviewer.removeComment(1);

    expect(reviewer.getComments()).toHaveLength(0);
    expect(reviewer.toDocument().package.document.comments).toHaveLength(0);
  });

  test('removing a reply leaves the parent and its range markers intact', () => {
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

    reviewer.removeComment(2);

    const remaining = reviewer.getComments();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(1);
    expect(remaining[0].replies).toHaveLength(0);
    expect(remaining[0].anchoredText).toBe('text');
  });

  test('only removes markers for the targeted comment', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        { type: 'commentRangeStart', id: 1 } as CommentRangeStart,
        makeRun('a '),
        { type: 'commentRangeStart', id: 2 } as CommentRangeStart,
        makeRun('b'),
        { type: 'commentRangeEnd', id: 2 } as CommentRangeEnd,
        makeRun(' c'),
        { type: 'commentRangeEnd', id: 1 } as CommentRangeEnd,
      ] as ParagraphContent[],
      formatting: {},
    } as Paragraph;
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

  test('finds text inside a deletion wrapper (still in the vanilla doc)', () => {
    const para: Paragraph = {
      type: 'paragraph',
      content: [
        makeRun('Before '),
        makeDeletion('inside', 1, 'Alice'),
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

  test('does not find text inside an insertion wrapper (not in the vanilla doc)', () => {
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
