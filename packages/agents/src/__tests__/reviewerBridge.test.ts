import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
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
  StyleDefinitions,
} from '@eigenpal/docx-editor-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import { createReviewerBridge } from '../reviewerBridge';
import { CommentNotFoundError } from '../errors';

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

function makeReviewer(content: (Paragraph | Table)[], styles?: StyleDefinitions): DocxReviewer {
  const doc = {
    package: {
      document: { content, comments: [] } as DocumentBody,
      styles,
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

function reviewerParagraph(reviewer: DocxReviewer, index = 0): Paragraph {
  return reviewer.toDocument().package.document.content[index] as Paragraph;
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

  test('anchors paraId-less paragraphs by ordinal index (matches buildParaIdMap)', () => {
    const reviewer = makeReviewer([makeParagraph('orphan paragraph')]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('orphan');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('0');
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

describe('createReviewerBridge — applyFormatting', () => {
  test('applies character formatting to a whole paragraph', () => {
    const paragraph = makeParagraph('Format me.', 'p_a');
    const reviewer = makeReviewer([paragraph]);
    const bridge = createReviewerBridge(reviewer);

    const ok = bridge.applyFormatting({
      paraId: 'p_a',
      marks: {
        bold: true,
        italic: true,
        color: { rgb: 'FF0000' },
        fontSize: 14,
        fontFamily: { ascii: 'Aptos' },
      },
    });

    expect(ok).toBe(true);
    const run = reviewerParagraph(reviewer).content[0] as Run;
    expect(run.formatting?.bold).toBe(true);
    expect(run.formatting?.italic).toBe(true);
    expect(run.formatting?.color?.rgb).toBe('FF0000');
    expect(run.formatting?.fontSize).toBe(28);
    expect(run.formatting?.fontFamily?.hAnsi).toBe('Aptos');
  });

  test('formats only a unique phrase by splitting runs', () => {
    const paragraph = makeParagraph('Alpha Beta Gamma', 'p_a');
    const reviewer = makeReviewer([paragraph]);
    const bridge = createReviewerBridge(reviewer);

    const ok = bridge.applyFormatting({
      paraId: 'p_a',
      search: 'Beta',
      marks: { underline: { style: 'double' }, highlight: 'yellow' },
    });

    expect(ok).toBe(true);
    const updated = reviewerParagraph(reviewer);
    expect(
      updated.content.map((item) =>
        item.type === 'run' && item.content[0].type === 'text' ? item.content[0].text : ''
      )
    ).toEqual(['Alpha ', 'Beta', ' Gamma']);
    const target = updated.content[1] as Run;
    expect(target.formatting?.underline?.style).toBe('double');
    expect(target.formatting?.highlight).toBe('yellow');
    expect((updated.content[0] as Run).formatting?.underline).toBeUndefined();
  });

  test('returns false for ambiguous or missing search text', () => {
    const reviewer = makeReviewer([makeParagraph('Repeat Repeat', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);

    expect(bridge.applyFormatting({ paraId: 'p_a', search: 'Repeat', marks: { bold: true } })).toBe(
      false
    );
    expect(
      bridge.applyFormatting({ paraId: 'p_a', search: 'Missing', marks: { bold: true } })
    ).toBe(false);
  });

  test('clears requested marks without removing unrelated formatting', () => {
    const paragraph = makeParagraph('Format me.', 'p_a');
    const run = paragraph.content[0] as Run;
    run.formatting = { bold: true, italic: true, underline: { style: 'single' } };
    const reviewer = makeReviewer([paragraph]);
    const bridge = createReviewerBridge(reviewer);

    const ok = bridge.applyFormatting({
      paraId: 'p_a',
      marks: { bold: false, underline: false },
    });

    expect(ok).toBe(true);
    const updated = reviewerParagraph(reviewer).content[0] as Run;
    expect(updated.formatting?.bold).toBeUndefined();
    expect(updated.formatting?.underline).toBeUndefined();
    expect(updated.formatting?.italic).toBe(true);
  });
});

describe('createReviewerBridge — setParagraphStyle', () => {
  test('sets a defined paragraph style', () => {
    const paragraph = makeParagraph('Heading text', 'p_a');
    const styles: StyleDefinitions = {
      styles: [{ styleId: 'Heading1', type: 'paragraph', name: 'Heading 1' }],
    };
    const reviewer = makeReviewer([paragraph], styles);
    const bridge = createReviewerBridge(reviewer);

    expect(bridge.setParagraphStyle({ paraId: 'p_a', styleId: 'Heading1' })).toBe(true);
    expect(reviewerParagraph(reviewer).formatting?.styleId).toBe('Heading1');
  });

  test('returns false for unknown paraId or undefined styleId', () => {
    const paragraph = makeParagraph('Text', 'p_a');
    const styles: StyleDefinitions = {
      styles: [{ styleId: 'Heading1', type: 'paragraph', name: 'Heading 1' }],
    };
    const reviewer = makeReviewer([paragraph], styles);
    const bridge = createReviewerBridge(reviewer);

    expect(bridge.setParagraphStyle({ paraId: 'missing', styleId: 'Heading1' })).toBe(false);
    expect(bridge.setParagraphStyle({ paraId: 'p_a', styleId: 'NoSuchStyle' })).toBe(false);
    expect(reviewerParagraph(reviewer).formatting?.styleId).toBeUndefined();
  });
});

describe('createReviewerBridge — insertBreak', () => {
  test('sectionNextPage / sectionContinuous set the section start on the target', () => {
    const reviewer = makeReviewer([makeParagraph('First', 'p_a'), makeParagraph('Second', 'p_b')]);
    const bridge = createReviewerBridge(reviewer);

    expect(bridge.insertBreak({ paraId: 'p_a', type: 'sectionNextPage' })).toBe(true);
    expect(reviewerParagraph(reviewer, 0).sectionProperties?.sectionStart).toBe('nextPage');

    expect(bridge.insertBreak({ paraId: 'p_b', type: 'sectionContinuous' })).toBe(true);
    expect(reviewerParagraph(reviewer, 1).sectionProperties?.sectionStart).toBe('continuous');
  });

  test('page break inserts a break-run paragraph after the target', () => {
    const reviewer = makeReviewer([makeParagraph('First', 'p_a'), makeParagraph('Second', 'p_b')]);
    const bridge = createReviewerBridge(reviewer);

    expect(bridge.insertBreak({ paraId: 'p_a', type: 'page' })).toBe(true);

    const content = reviewer.toDocument().package.document.content;
    expect(content).toHaveLength(3);
    const inserted = content[1] as Paragraph;
    const run = inserted.content[0] as Run;
    expect(run.content[0]).toEqual({ type: 'break', breakType: 'page' });
    // Second paragraph still resolvable after the inserted block (cache rebuilt):
    // content is now [p_a, pageBreak, p_b], so p_b sits at index 2.
    expect(bridge.insertBreak({ paraId: 'p_b', type: 'sectionNextPage' })).toBe(true);
    expect((content[2] as Paragraph).sectionProperties?.sectionStart).toBe('nextPage');
  });

  test('returns false for an unknown paraId', () => {
    const reviewer = makeReviewer([makeParagraph('First', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.insertBreak({ paraId: 'missing', type: 'page' })).toBe(false);
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

  test('resolveComment throws CommentNotFoundError for an unknown id', () => {
    const reviewer = makeReviewer([makeParagraph('First.', 'p_a')]);
    const bridge = createReviewerBridge(reviewer);
    // No comment with id 9999 exists — a miss must be a loud failure, not a
    // silent no-op that reports success (regression guard for fail-quiet resolve).
    expect(() => bridge.resolveComment(9999)).toThrow(CommentNotFoundError);
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

// `read_document` (formatContentForLLM) labels a paragraph with no w14:paraId by
// its ordinal index — `[0]`, `[1]`, … — and Word does not always emit paraIds.
// The bridge map must therefore resolve those ordinal-string ids, or every id
// read_document hands the agent for a paraId-less doc is rejected by the mutate
// tools. `find_text` mirrors the same convention: it emits `String(index)` for a
// paraId-less paragraph, so a phrase it surfaces is anchorable by the mutate tools
// on a doc with no paraIds (its index counting matches buildParaIdMap exactly).
describe('createReviewerBridge — paraId-less paragraphs addressable by ordinal index', () => {
  test('addComment resolves the ordinal-index id read_document shows', () => {
    const reviewer = makeReviewer([makeParagraph('first'), makeParagraph('second')]);
    const bridge = createReviewerBridge(reviewer);
    const id = bridge.addComment({ paraId: '1', text: 'on the second', author: 'AI' });
    expect(id).not.toBeNull();
    const comments = reviewer.getComments();
    expect(comments).toHaveLength(1);
    expect(comments[0].paragraphIndex).toBe(1);
  });

  test('proposeChange resolves an ordinal-index id', () => {
    const reviewer = makeReviewer([makeParagraph('alpha'), makeParagraph('beta')]);
    const bridge = createReviewerBridge(reviewer);
    const ok = bridge.proposeChange({
      paraId: '0',
      search: '',
      replaceWith: ' [ins]',
      author: 'AI',
    });
    expect(ok).toBe(true);
    expect(reviewer.getChanges()).toHaveLength(1);
  });

  test('a real paraId still wins; the paraId-less sibling is reached by ordinal', () => {
    const reviewer = makeReviewer([makeParagraph('has id', 'p_x'), makeParagraph('no id')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.addComment({ paraId: 'p_x', text: 'a', author: 'AI' })).not.toBeNull();
    expect(bridge.addComment({ paraId: '1', text: 'b', author: 'AI' })).not.toBeNull();
    expect(reviewer.getComments()).toHaveLength(2);
  });

  test('the ordinal index counts across a table, matching read_document', () => {
    // before(0), table(cells advance the index), after — `after` is index
    // 1 + (#cell-paragraphs). 2x2 table = 4 cell paragraphs → after is [5].
    const before = makeParagraph('before');
    const table = makeTable([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    const after = makeParagraph('after');
    const reviewer = makeReviewer([before, table, after]);
    const bridge = createReviewerBridge(reviewer);
    const id = bridge.addComment({ paraId: '5', text: 'on after', author: 'AI' });
    expect(id).not.toBeNull();
    expect(reviewer.getComments()[0].paragraphIndex).toBe(5);
  });

  test('applyFormatting resolves an ordinal-index id (all map consumers, not just comments)', () => {
    const reviewer = makeReviewer([makeParagraph('format me')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.applyFormatting({ paraId: '0', marks: { bold: true } })).toBe(true);
  });

  test('a genuinely unknown id still returns null', () => {
    const reviewer = makeReviewer([makeParagraph('only')]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.addComment({ paraId: '99', text: 'x', author: 'AI' })).toBeNull();
  });

  test('find_text → addComment round-trips on a paraId-less doc', () => {
    // The end-to-end invariant: a phrase find_text surfaces must be anchorable
    // by the mutate tools even when the paragraph carries no w14:paraId.
    const reviewer = makeReviewer([makeParagraph('alpha'), makeParagraph('unique beta phrase')]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('unique beta phrase');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('1');
    const id = bridge.addComment({
      paraId: matches[0].paraId,
      text: 'note',
      search: matches[0].match,
    });
    expect(typeof id).toBe('number');
    expect(reviewer.getComments()[0].paragraphIndex).toBe(1);
  });

  test('find_text ordinal index counts across a table, matching buildParaIdMap', () => {
    // before(0), 2x2 table (4 cell paragraphs advance the index), after → [5].
    const before = makeParagraph('before');
    const table = makeTable([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    const after = makeParagraph('locate me after the table');
    const reviewer = makeReviewer([before, table, after]);
    const bridge = createReviewerBridge(reviewer);
    const matches = bridge.findText('locate me after the table');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('5');
    // …and the emitted id resolves through the mutate path.
    expect(
      bridge.addComment({ paraId: matches[0].paraId, text: 'x', author: 'AI' })
    ).not.toBeNull();
  });

  test('find_text prefers a real paraId over the ordinal when present', () => {
    const reviewer = makeReviewer([
      makeParagraph('no id here'),
      makeParagraph('tagged text', 'p_z'),
    ]);
    const bridge = createReviewerBridge(reviewer);
    expect(bridge.findText('no id here')[0].paraId).toBe('0');
    expect(bridge.findText('tagged text')[0].paraId).toBe('p_z');
  });
});

// A table cell holds paragraphs (`w:tbl > w:tr > w:tc > w:p`). Those paragraphs
// are part of the document-wide paragraph index space that `getParagraphAtIndex`
// and `forEachParagraph` already walk — so once the bridge's paraId map and
// `findText` enumerate them, every cell paragraph becomes addressable by the same
// find_text → suggest_change / add_comment loop as a body paragraph.
describe('createReviewerBridge — table cell paragraphs are addressable', () => {
  // makeTable (above) leaves cell paragraphs paraId-less; this variant tags them,
  // mirroring a Word-authored table where each cell paragraph carries a w14:paraId.
  function makeTableWithParaIds(cells: { text: string; paraId?: string }[][]): Table {
    return {
      type: 'table',
      rows: cells.map((row) => ({
        cells: row.map((c) => ({ content: [makeParagraph(c.text, c.paraId)] })),
      })),
    } as unknown as Table;
  }

  test('find_text locates a phrase inside a table cell, returning the cell paragraph paraId', () => {
    const before = makeParagraph('Before the table', 'p_before');
    const table = makeTableWithParaIds([
      [
        { text: 'Licensor retains inputs', paraId: 'cell_ip' },
        { text: 'COV documentation obligations', paraId: 'cell_doc' },
      ],
    ]);
    const after = makeParagraph('After the table', 'p_after');
    const reviewer = makeReviewer([before, table, after]);
    const bridge = createReviewerBridge(reviewer);

    const matches = bridge.findText('Licensor retains inputs');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('cell_ip');
  });

  test('suggest_change (replace) authors a tracked change inside a table cell, addressed by paraId', () => {
    const table = makeTableWithParaIds([[{ text: 'Licensor retains inputs', paraId: 'cell_ip' }]]);
    const reviewer = makeReviewer([makeParagraph('Body', 'p0'), table]);
    const bridge = createReviewerBridge(reviewer);

    const ok = bridge.proposeChange({
      paraId: 'cell_ip',
      search: 'Licensor retains inputs',
      replaceWith: 'The licensor retains the inputs',
      author: 'AI',
    });
    expect(ok).toBe(true);

    const changes = reviewer.getChanges();
    expect(changes.some((c) => c.type === 'deletion' && c.text === 'Licensor retains inputs')).toBe(
      true
    );
    expect(
      changes.some((c) => c.type === 'insertion' && c.text === 'The licensor retains the inputs')
    ).toBe(true);
  });

  test('add_comment anchors to a unique phrase inside a table cell', () => {
    const table = makeTableWithParaIds([[{ text: 'Publicly available', paraId: 'cell_row' }]]);
    const reviewer = makeReviewer([table]);
    const bridge = createReviewerBridge(reviewer);

    const id = bridge.addComment({
      paraId: 'cell_row',
      text: 'Is this row label right?',
      search: 'Publicly available',
      author: 'AI',
    });
    expect(typeof id).toBe('number');
    expect(reviewer.getComments()).toHaveLength(1);
  });

  test('a paraId-less cell paragraph is addressable by the ordinal index read_document shows', () => {
    // before(0), cell A1(1), cell B1(2), after(3). The doc-wide index counts INTO
    // the table, matching getParagraphAtIndex / formatContentForLLM exactly.
    const before = makeParagraph('before');
    const table = makeTable([['apple cell', 'banana cell']]);
    const after = makeParagraph('after');
    const reviewer = makeReviewer([before, table, after]);
    const bridge = createReviewerBridge(reviewer);

    const matches = bridge.findText('banana cell');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('2');

    const ok = bridge.proposeChange({
      paraId: '2',
      search: 'banana cell',
      replaceWith: 'cherry cell',
      author: 'AI',
    });
    expect(ok).toBe(true);
    expect(reviewer.getChanges().some((c) => c.type === 'deletion')).toBe(true);
  });

  test('find_text → suggest_change end-to-end on a cell with a real paraId', () => {
    const table = makeTableWithParaIds([
      [{ text: 'first cell phrase', paraId: 'c1' }],
      [{ text: 'public availability transfers no copyright', paraId: 'c2' }],
    ]);
    const reviewer = makeReviewer([makeParagraph('intro', 'p_intro'), table]);
    const bridge = createReviewerBridge(reviewer);

    const matches = bridge.findText('public availability transfers no copyright');
    expect(matches).toHaveLength(1);
    const ok = bridge.proposeChange({
      paraId: matches[0].paraId,
      search: matches[0].match,
      replaceWith: 'public availability does not transfer copyright',
      author: 'AI',
    });
    expect(ok).toBe(true);
    expect(reviewer.getChanges()).toHaveLength(2); // deletion + insertion
  });

  test('body editing is unaffected — a body paraId still resolves with a table present', () => {
    const before = makeParagraph('edit this body phrase', 'p_body');
    const table = makeTableWithParaIds([[{ text: 'cell', paraId: 'cell_a' }]]);
    const reviewer = makeReviewer([before, table]);
    const bridge = createReviewerBridge(reviewer);

    const ok = bridge.proposeChange({
      paraId: 'p_body',
      search: 'body phrase',
      replaceWith: 'body text',
      author: 'AI',
    });
    expect(ok).toBe(true);
    expect(
      reviewer.getChanges().some((c) => c.type === 'deletion' && c.text === 'body phrase')
    ).toBe(true);
  });
});

// End-to-end against a real DOCX: the in-cell change must survive serialization
// (save → reopen), accept/reject must resolve it inside the cell, and the
// surrounding table geometry (rows × cols) must stay intact.
describe('createReviewerBridge — table cell authoring round-trips through a real DOCX', () => {
  const WITH_TABLES = path.resolve(__dirname, '../../../../e2e/fixtures/with-tables.docx');
  function bufOf(p: string): ArrayBuffer {
    const b = readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  function tableOf(r: DocxReviewer): Table {
    return r.toDocument().package.document.content.find((b): b is Table => b.type === 'table')!;
  }
  // Plain run text of a cell. Every cell this test reads is untouched or
  // post-accept/reject (plain runs); the pending tracked change is asserted via
  // getChanges, not read here, so a run-only walk is sufficient.
  function cellText(t: Table, row: number, col: number): string {
    return t.rows[row].cells[col].content
      .filter((b): b is Paragraph => b.type === 'paragraph')
      .map((p) => {
        let s = '';
        for (const it of p.content) {
          if (it.type === 'run') {
            for (const c of it.content) {
              if (c.type === 'text') s += c.text;
            }
          }
        }
        return s;
      })
      .join('\n');
  }

  // with-tables.docx: para[0] "Document with tables:", a 3×3 grid of cells A1..C3,
  // then "End of document." Cell B2 is the doc-wide paragraph at ordinal index 5
  // (cells carry no w14:paraId, so find_text surfaces "5").
  test('replace B2 → reparse keeps the table intact; accept applies / reject reverts in-cell', async () => {
    const r = await DocxReviewer.fromBuffer(bufOf(WITH_TABLES), 'AI');
    const bridge = createReviewerBridge(r);

    const matches = bridge.findText('B2');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('5');

    const tableBefore = tableOf(r);
    const rowsBefore = tableBefore.rows.length;
    const colsBefore = tableBefore.rows[0].cells.length;
    expect(cellText(tableBefore, 1, 1)).toBe('B2');

    const ok = bridge.proposeChange({
      paraId: matches[0].paraId,
      search: 'B2',
      replaceWith: 'B2 EDITED',
      author: 'AI',
    });
    expect(ok).toBe(true);
    const changes = r.getChanges();
    expect(changes.some((c) => c.type === 'deletion' && c.text === 'B2')).toBe(true);
    expect(changes.some((c) => c.type === 'insertion' && c.text === 'B2 EDITED')).toBe(true);

    // Save → reopen: the change survives and the table geometry is unchanged.
    const buf = await r.toBuffer();
    const rt = await DocxReviewer.fromBuffer(buf, 'AI');
    const tableRt = tableOf(rt);
    expect(tableRt.rows.length).toBe(rowsBefore);
    expect(tableRt.rows.every((row) => row.cells.length === colsBefore)).toBe(true);
    expect(rt.getChanges().some((c) => c.text === 'B2 EDITED')).toBe(true);
    expect(cellText(tableRt, 0, 0)).toBe('A1');
    expect(cellText(tableRt, 2, 2)).toBe('C3');

    // Accept: the cell reads the replacement, table still 3×3.
    const acc = await DocxReviewer.fromBuffer(buf, 'AI');
    acc.acceptAll();
    const accTable = tableOf(acc);
    expect(accTable.rows.length).toBe(rowsBefore);
    expect(cellText(accTable, 1, 1)).toBe('B2 EDITED');

    // Reject: the cell reverts to its original text.
    const rej = await DocxReviewer.fromBuffer(buf, 'AI');
    rej.rejectAll();
    expect(cellText(tableOf(rej), 1, 1)).toBe('B2');
  });
});
