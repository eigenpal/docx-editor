import { describe, test, expect } from 'bun:test';
import type {
  Document,
  DocumentBody,
  Paragraph,
  ParagraphContent,
  Run,
  Table,
  Hyperlink,
  Insertion,
  Deletion,
  MoveFrom,
  MoveTo,
} from '@eigenpal/docx-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import { createReviewerBridge } from '../reviewerBridge';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRun(text: string): Run {
  return { type: 'run', content: [{ type: 'text', text }] } as Run;
}

function makeParagraph(text: string, paraId?: string): Paragraph {
  return {
    type: 'paragraph',
    content: [makeRun(text)] as ParagraphContent[],
    formatting: {},
    paraId,
  } as Paragraph;
}

function makeTable(cells: string[][]): Table {
  return {
    type: 'table',
    rows: cells.map((row) => ({
      cells: row.map((text) => ({ content: [makeParagraph(text)] })),
    })),
  } as unknown as Table;
}

function makeReviewer(content: (Paragraph | Table)[]): DocxReviewer {
  const doc = {
    package: {
      document: { content, comments: [] } as DocumentBody,
    },
  } as Document;
  return new DocxReviewer(doc, 'TestAgent');
}

function makeInsertion(text: string, id: number): Insertion {
  return {
    type: 'insertion',
    info: { id, author: 'A', date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

function makeDeletion(text: string, id: number): Deletion {
  return {
    type: 'deletion',
    info: { id, author: 'A', date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

function makeMoveFrom(text: string, id: number): MoveFrom {
  return {
    type: 'moveFrom',
    info: { id, author: 'A', date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

function makeMoveTo(text: string, id: number): MoveTo {
  return {
    type: 'moveTo',
    info: { id, author: 'A', date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

function makeMixedParagraph(content: ParagraphContent[], paraId: string): Paragraph {
  return { type: 'paragraph', content, formatting: {}, paraId } as Paragraph;
}

function makeHyperlink(text: string): Hyperlink {
  return {
    type: 'hyperlink',
    href: 'https://example.com',
    children: [makeRun(text)],
  } as Hyperlink;
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('createReviewerBridge — read paths', () => {
  test('getContentAsText delegates to the reviewer', () => {
    const reviewer = makeReviewer([makeParagraph('First', 'p_a'), makeParagraph('Second', 'p_b')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.getContentAsText()).toContain('First');
    expect(bridge.getContentAsText()).toContain('Second');
  });

  test('getContent emits paraIds when present', () => {
    const reviewer = makeReviewer([makeParagraph('First', 'p_a'), makeParagraph('Second', 'p_b')]);
    const bridge = createReviewerBridge(reviewer);
    const blocks = bridge.getContent();
    // Both blocks should be paragraph type (only paragraph/heading/list-item carry paraId).
    if (blocks[0].type !== 'table') expect(blocks[0].paraId).toBe('p_a');
    if (blocks[1].type !== 'table') expect(blocks[1].paraId).toBe('p_b');
  });

  test('getSelection returns null in headless mode', () => {
    const reviewer = makeReviewer([makeParagraph('Hello', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.getSelection()).toBeNull();
  });
});

describe('createReviewerBridge — findText', () => {
  test('returns paraId-anchored handles for unique substrings', () => {
    const reviewer = makeReviewer([
      makeParagraph('The quick brown fox jumps over the lazy dog.', 'p_a'),
      makeParagraph('Nothing relevant here.', 'p_b'),
    ]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('quick brown fox');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('p_a');
    expect(matches[0].match).toBe('quick brown fox');
    expect(matches[0].before).toContain('The');
    expect(matches[0].after).toContain('jumps');
  });

  test('skips paragraphs without paraIds', () => {
    const reviewer = makeReviewer([makeParagraph('orphan paragraph')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('orphan')).toEqual([]);
  });

  test('skips ambiguous matches inside a single paragraph', () => {
    const reviewer = makeReviewer([
      makeParagraph('the the the the', 'p_a'),
      makeParagraph('only one here', 'p_b'),
    ]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('the');
    // p_a is ambiguous → skipped; p_b doesn't contain "the" → not in results.
    expect(matches.find((m) => m.paraId === 'p_a')).toBeUndefined();
  });

  test('case-insensitive by default; case-sensitive when asked', () => {
    const reviewer = makeReviewer([makeParagraph('Hello WORLD', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('world')).toHaveLength(1);
    expect(bridge.findText('world', { caseSensitive: true })).toHaveLength(0);
  });

  test('limit caps result count', () => {
    const reviewer = makeReviewer(
      Array.from({ length: 10 }, (_, i) => makeParagraph(`uniq${i} marker`, `p_${i}`))
    );
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('marker', { limit: 3 })).toHaveLength(3);
  });

  test('empty query returns no matches', () => {
    const reviewer = makeReviewer([makeParagraph('whatever', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('')).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// findText vanilla-view alignment
//
// findText must surface the same text the agent reads via read_document and
// can anchor via addComment. Pre-fix, findText skipped ALL tracked changes
// (both insertions and deletions). Post-fix, deletions/moveFrom are visible
// and matchable so an agent that picks a phrase containing deletion text can
// successfully locate it.
// ────────────────────────────────────────────────────────────────────────────

describe('createReviewerBridge — findText (vanilla view)', () => {
  test('finds a phrase that includes deletion text', () => {
    const reviewer = makeReviewer([
      makeMixedParagraph(
        [makeRun('cap is '), makeDeletion('$50k', 1), makeRun(' per year')],
        'p_a'
      ),
    ]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('cap is $50k per year');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('p_a');
  });

  test('does not find a phrase that exists only inside an insertion', () => {
    const reviewer = makeReviewer([
      makeMixedParagraph(
        [makeRun('cap is '), makeInsertion('$500k', 1), makeRun(' per year')],
        'p_a'
      ),
    ]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('$500k')).toHaveLength(0);
  });

  test('does not find a phrase that straddles plain → insertion', () => {
    // Vanilla haystack drops the insertion, so the phrase is broken.
    const reviewer = makeReviewer([
      makeMixedParagraph(
        [makeRun('cap is '), makeInsertion('$500k', 1), makeRun(' per year')],
        'p_a'
      ),
    ]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('cap is $500k')).toHaveLength(0);
  });

  test('finds a phrase entirely inside a deletion', () => {
    const reviewer = makeReviewer([
      makeMixedParagraph(
        [makeRun('start '), makeDeletion('hidden gem text', 1), makeRun(' end')],
        'p_a'
      ),
    ]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('hidden gem');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('p_a');
  });

  test('moveFrom text is findable (vanilla-visible)', () => {
    const reviewer = makeReviewer([
      makeMixedParagraph(
        [makeRun('here is '), makeMoveFrom('movefrom payload', 1), makeRun(' end')],
        'p_a'
      ),
    ]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('movefrom payload')).toHaveLength(1);
  });

  test('moveTo text is not findable (vanilla-hidden)', () => {
    const reviewer = makeReviewer([
      makeMixedParagraph(
        [makeRun('here is '), makeMoveTo('moveto payload', 1), makeRun(' end')],
        'p_a'
      ),
    ]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('moveto payload')).toHaveLength(0);
  });

  test('finds top-level hyperlink text', () => {
    const reviewer = makeReviewer([
      makeMixedParagraph([makeRun('see '), makeHyperlink('docs portal'), makeRun('.')], 'p_a'),
    ]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('docs portal');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('p_a');
  });

  test('finds hyperlink text inside a deletion (vanilla-visible)', () => {
    const deletionWithHyperlink: Deletion = {
      type: 'deletion',
      info: { id: 1, author: 'A', date: '2024-01-01T00:00:00Z' },
      content: [makeHyperlink('removed link payload')],
    };
    const reviewer = makeReviewer([
      makeMixedParagraph([makeRun('start '), deletionWithHyperlink, makeRun(' end')], 'p_a'),
    ]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('removed link payload')).toHaveLength(1);
  });

  test('does not find hyperlink text inside an insertion (vanilla-hidden)', () => {
    const insertionWithHyperlink: Insertion = {
      type: 'insertion',
      info: { id: 1, author: 'A', date: '2024-01-01T00:00:00Z' },
      content: [makeHyperlink('inserted link payload')],
    };
    const reviewer = makeReviewer([
      makeMixedParagraph([makeRun('start '), insertionWithHyperlink, makeRun(' end')], 'p_a'),
    ]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('inserted link payload')).toHaveLength(0);
  });

  test('cross-cut: any phrase findText returns is anchorable via addComment', () => {
    // Top-level invariant of the agent surface — keep find/anchor in sync.
    const reviewer = makeReviewer([
      makeMixedParagraph([makeRun('alpha '), makeDeletion('beta', 1), makeRun(' gamma')], 'p_a'),
    ]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('alpha beta gamma');
    expect(matches).toHaveLength(1);
    const id = bridge.addComment({
      paraId: matches[0].paraId,
      text: 'note',
      search: matches[0].match,
    });
    expect(typeof id).toBe('number');
  });
});

describe('createReviewerBridge — addComment', () => {
  test('adds a comment on a paraId paragraph and returns id', () => {
    const reviewer = makeReviewer([makeParagraph('Pay $50k.', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    const id = bridge.addComment({
      paraId: 'p_a',
      text: 'Cap is too low.',
      author: 'AI',
    });
    expect(id).not.toBeNull();
    expect(typeof id).toBe('number');
    const comments = reviewer.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toContain('Cap is too low');
  });

  test('returns null when the paraId does not exist', () => {
    const reviewer = makeReviewer([makeParagraph('Hello', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.addComment({ paraId: 'p_missing', text: 'no', author: 'AI' })).toBeNull();
  });

  test('returns null when search text is missing', () => {
    const reviewer = makeReviewer([makeParagraph('Pay $50k.', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(
      bridge.addComment({
        paraId: 'p_a',
        text: 'note',
        search: 'NOT IN PARAGRAPH',
        author: 'AI',
      })
    ).toBeNull();
  });
});

describe('createReviewerBridge — proposeChange (3 modes)', () => {
  test('replacement mode → tracked change recorded', () => {
    const reviewer = makeReviewer([makeParagraph('Pay $50k within 30 days.', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    const ok = bridge.proposeChange({
      paraId: 'p_a',
      search: '$50k',
      replaceWith: '$500k',
      author: 'AI',
    });
    expect(ok).toBe(true);
    const changes = reviewer.getChanges();
    expect(changes.length).toBeGreaterThan(0);
  });

  test('deletion mode → tracked deletion recorded', () => {
    const reviewer = makeReviewer([makeParagraph('Important: this clause is unnecessary.', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    const ok = bridge.proposeChange({
      paraId: 'p_a',
      search: 'this clause is unnecessary',
      replaceWith: '',
      author: 'AI',
    });
    expect(ok).toBe(true);
    const changes = reviewer.getChanges();
    expect(changes.find((c) => c.type === 'deletion')).toBeDefined();
  });

  test('insertion mode → tracked insertion at paragraph end', () => {
    const reviewer = makeReviewer([makeParagraph('Original text.', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    const ok = bridge.proposeChange({
      paraId: 'p_a',
      search: '',
      replaceWith: ' Appended note.',
      author: 'AI',
    });
    expect(ok).toBe(true);
    const changes = reviewer.getChanges();
    expect(changes.find((c) => c.type === 'insertion')).toBeDefined();
  });

  test('returns false on unknown paraId', () => {
    const reviewer = makeReviewer([makeParagraph('Hello', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(
      bridge.proposeChange({
        paraId: 'p_missing',
        search: 'x',
        replaceWith: 'y',
        author: 'AI',
      })
    ).toBe(false);
  });

  test('returns false when both search and replaceWith are empty', () => {
    const reviewer = makeReviewer([makeParagraph('Hello', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.proposeChange({ paraId: 'p_a', search: '', replaceWith: '', author: 'AI' })).toBe(
      false
    );
  });
});

describe('createReviewerBridge — comments lifecycle', () => {
  test('replyTo adds a threaded reply', () => {
    const reviewer = makeReviewer([makeParagraph('First.', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    const parentId = bridge.addComment({
      paraId: 'p_a',
      text: 'Top-level',
      author: 'AI',
    });
    expect(parentId).not.toBeNull();
    const replyId = bridge.replyTo(parentId!, { text: 'Acknowledged.', author: 'AI' });
    expect(replyId).not.toBeNull();
    const comment = reviewer.getComments().find((c) => c.id === parentId);
    expect(comment?.replies).toHaveLength(1);
  });

  test('resolveComment marks the comment as done', () => {
    const reviewer = makeReviewer([makeParagraph('First.', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    const id = bridge.addComment({ paraId: 'p_a', text: 'Note', author: 'AI' });
    bridge.resolveComment(id!);
    const comment = reviewer.getComments().find((c) => c.id === id);
    expect(comment?.done).toBe(true);
  });
});

describe('createReviewerBridge — scrollTo & selection', () => {
  test('scrollTo returns true for a known paraId, false for unknown', () => {
    const reviewer = makeReviewer([makeParagraph('Hello', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.scrollTo('p_a')).toBe(true);
    expect(bridge.scrollTo('p_missing')).toBe(false);
  });
});

describe('createReviewerBridge — events', () => {
  test('onContentChange fires after addComment, payload includes counts', () => {
    const reviewer = makeReviewer([makeParagraph('Hello', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    const events: Array<{ commentCount: number; changeCount: number }> = [];
    bridge.onContentChange((e) =>
      events.push({ commentCount: e.commentCount, changeCount: e.changeCount })
    );
    bridge.addComment({ paraId: 'p_a', text: 'Note', author: 'AI' });
    expect(events).toHaveLength(1);
    expect(events[0].commentCount).toBe(1);
  });

  test('onContentChange unsubscribe stops further events', () => {
    const reviewer = makeReviewer([makeParagraph('Hello', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    let count = 0;
    const off = bridge.onContentChange(() => {
      count++;
    });
    bridge.addComment({ paraId: 'p_a', text: 'Note', author: 'AI' });
    off();
    bridge.addComment({ paraId: 'p_a', text: 'Note 2', author: 'AI' });
    expect(count).toBe(1);
  });

  test('onSelectionChange listeners never fire in headless mode', () => {
    const reviewer = makeReviewer([makeParagraph('Hello', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    let fired = false;
    bridge.onSelectionChange(() => {
      fired = true;
    });
    bridge.addComment({ paraId: 'p_a', text: 'Note', author: 'AI' });
    expect(fired).toBe(false);
  });
});

describe('createReviewerBridge — table indexing', () => {
  test('top-level paragraphs after a table remain addressable by paraId', () => {
    const before = makeParagraph('Before', 'p_before');
    const table = makeTable([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    const after = makeParagraph('After', 'p_after');
    const reviewer = makeReviewer([before, table, after]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.scrollTo('p_before')).toBe(true);
    expect(bridge.scrollTo('p_after')).toBe(true);
    // Mutating after a table should still work.
    expect(bridge.addComment({ paraId: 'p_after', text: 'OK', author: 'AI' })).not.toBeNull();
  });
});
