import { describe, test, expect } from 'bun:test';
import type {
  Paragraph,
  Run,
  Table,
  Document,
  DocumentBody,
  ParagraphContent,
} from '@eigenpal/docx-core/headless';
import { createEditorBridge, type EditorRefLike } from '../bridge';

// ============================================================================
// HELPERS
// ============================================================================

function makeRun(text: string): Run {
  return { type: 'run', content: [{ type: 'text', text }] } as Run;
}

function makeParagraph(text: string): Paragraph {
  return {
    type: 'paragraph',
    content: [makeRun(text)] as ParagraphContent[],
    formatting: {},
  } as Paragraph;
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

function makeDoc(content: (Paragraph | Table)[]): Document {
  return {
    package: {
      document: { content } as DocumentBody,
    },
  } as Document;
}

function makeMockRef(content: (Paragraph | Table)[]): EditorRefLike {
  const doc = makeDoc(content);
  const addedComments: Array<{
    id: number;
    author: string;
    date?: string;
    parentId?: number;
    content: unknown[];
    done?: boolean;
  }> = [];
  let replacementCalled = false;
  let scrolledTo: number | undefined;

  return {
    getDocument: () => doc,
    getEditorRef: () => ({ getDocument: () => doc }),
    addComment: (opts) => {
      const id = Date.now();
      addedComments.push({
        id,
        author: opts.author,
        content: [{ content: [{ content: [{ text: opts.text }] }] }],
      });
      return id;
    },
    replyToComment: (commentId, text, author) => {
      const id = Date.now() + 1;
      addedComments.push({
        id,
        author,
        parentId: commentId,
        content: [{ content: [{ content: [{ text }] }] }],
      });
      return id;
    },
    resolveComment: () => {},
    proposeReplacement: () => {
      replacementCalled = true;
      return true;
    },
    scrollToIndex: (idx) => {
      scrolledTo = idx;
    },
    getComments: () => addedComments,
    // Expose internal state for assertions
    get _replacementCalled() {
      return replacementCalled;
    },
    get _scrolledTo() {
      return scrolledTo;
    },
  } as EditorRefLike & { _replacementCalled: boolean; _scrolledTo: number | undefined };
}

// ============================================================================
// createEditorBridge
// ============================================================================

describe('createEditorBridge', () => {
  test('getContentAsText returns indexed text', () => {
    const ref = makeMockRef([makeParagraph('Hello'), makeParagraph('World')]);
    const bridge = createEditorBridge(ref, 'TestAgent');

    const text = bridge.getContentAsText();
    expect(text).toContain('[0]');
    expect(text).toContain('Hello');
    expect(text).toContain('[1]');
    expect(text).toContain('World');
  });

  test('getContent returns structured blocks', () => {
    const ref = makeMockRef([makeParagraph('First'), makeParagraph('Second')]);
    const bridge = createEditorBridge(ref);

    const blocks = bridge.getContent();
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].index).toBe(0);
  });

  test('getContent handles tables', () => {
    const ref = makeMockRef([
      makeParagraph('Before'),
      makeTable([['A', 'B']]),
      makeParagraph('After'),
    ]);
    const bridge = createEditorBridge(ref);
    const blocks = bridge.getContent();

    const types = blocks.map((b) => b.type);
    expect(types).toContain('paragraph');
    expect(types).toContain('table');
  });

  test('addComment calls ref and returns id', () => {
    const ref = makeMockRef([makeParagraph('Hello')]);
    const bridge = createEditorBridge(ref, 'Agent');

    const id = bridge.addComment({ paragraphIndex: 0, text: 'Nice paragraph' });
    expect(id).not.toBeNull();
    expect(typeof id).toBe('number');
  });

  test('addComment uses default author', () => {
    let capturedAuthor = '';
    const ref = makeMockRef([makeParagraph('Hello')]);
    const origAdd = ref.addComment.bind(ref);
    ref.addComment = (opts) => {
      capturedAuthor = opts.author;
      return origAdd(opts);
    };

    const bridge = createEditorBridge(ref, 'Claude');
    bridge.addComment({ paragraphIndex: 0, text: 'Test' });
    expect(capturedAuthor).toBe('Claude');
  });

  test('addComment allows author override', () => {
    let capturedAuthor = '';
    const ref = makeMockRef([makeParagraph('Hello')]);
    ref.addComment = (opts) => {
      capturedAuthor = opts.author;
      return 1;
    };

    const bridge = createEditorBridge(ref, 'DefaultAuthor');
    bridge.addComment({ paragraphIndex: 0, text: 'Test', author: 'CustomAuthor' });
    expect(capturedAuthor).toBe('CustomAuthor');
  });

  test('replace calls proposeReplacement on ref', () => {
    const ref = makeMockRef([makeParagraph('Hello world')]) as EditorRefLike & {
      _replacementCalled: boolean;
    };
    const bridge = createEditorBridge(ref, 'Agent');

    const ok = bridge.replace({
      paragraphIndex: 0,
      search: 'Hello',
      replaceWith: 'Hi',
    });
    expect(ok).toBe(true);
    expect(ref._replacementCalled).toBe(true);
  });

  test('scrollTo calls scrollToIndex on ref', () => {
    const ref = makeMockRef([makeParagraph('Hello')]) as EditorRefLike & {
      _scrolledTo: number | undefined;
    };
    const bridge = createEditorBridge(ref);

    bridge.scrollTo(5);
    expect(ref._scrolledTo).toBe(5);
  });

  test('getContentAsText with range', () => {
    const ref = makeMockRef([
      makeParagraph('Para 0'),
      makeParagraph('Para 1'),
      makeParagraph('Para 2'),
    ]);
    const bridge = createEditorBridge(ref);

    const text = bridge.getContentAsText({ fromIndex: 1, toIndex: 1 });
    expect(text).toContain('Para 1');
    expect(text).not.toContain('Para 0');
    expect(text).not.toContain('Para 2');
  });

  test('returns empty data when ref has no document', () => {
    const ref: EditorRefLike = {
      getDocument: () => null,
      getEditorRef: () => null,
      addComment: () => null,
      replyToComment: () => null,
      resolveComment: () => {},
      proposeReplacement: () => false,
      scrollToIndex: () => {},
      getComments: () => [],
    };
    const bridge = createEditorBridge(ref);

    expect(bridge.getContentAsText()).toBe('');
    expect(bridge.getContent()).toEqual([]);
    expect(bridge.getComments()).toEqual([]);
    expect(bridge.getChanges()).toEqual([]);
  });
});
