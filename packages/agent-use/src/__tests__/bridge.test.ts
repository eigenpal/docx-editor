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
  let proposeChangeCalled = false;
  let scrolledTo: string | undefined;
  let nextId = 1;
  const contentListeners = new Set<(d: unknown) => void>();
  const selectionListeners = new Set<(s: unknown) => void>();

  return {
    getDocument: () => doc,
    getEditorRef: () => ({ getDocument: () => doc }),
    addComment: (opts) => {
      const id = nextId++;
      addedComments.push({
        id,
        author: opts.author,
        content: [{ content: [{ content: [{ text: opts.text }] }] }],
      });
      return id;
    },
    replyToComment: (commentId, text, author) => {
      const id = nextId++;
      addedComments.push({
        id,
        author,
        parentId: commentId,
        content: [{ content: [{ content: [{ text }] }] }],
      });
      return id;
    },
    resolveComment: () => {},
    proposeChange: () => {
      proposeChangeCalled = true;
      return true;
    },
    scrollToParaId: (paraId) => {
      scrolledTo = paraId;
      return true;
    },
    findInDocument: () => [],
    getSelectionInfo: () => null,
    getComments: () => addedComments,
    applyFormatting: () => true,
    setParagraphStyle: () => true,
    getPageContent: () => null,
    getTotalPages: () => 0,
    getCurrentPage: () => 0,
    onContentChange: (listener) => {
      contentListeners.add(listener);
      return () => contentListeners.delete(listener);
    },
    onSelectionChange: (listener) => {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    // Expose internal state for assertions
    get _proposeChangeCalled() {
      return proposeChangeCalled;
    },
    get _scrolledTo() {
      return scrolledTo;
    },
    _emitContent: () => contentListeners.forEach((l) => l({})),
    _emitSelection: () => selectionListeners.forEach((l) => l({})),
    _contentListenerCount: () => contentListeners.size,
  } as EditorRefLike & {
    _proposeChangeCalled: boolean;
    _scrolledTo: string | undefined;
    _emitContent: () => void;
    _emitSelection: () => void;
    _contentListenerCount: () => number;
  };
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

  test('addComment forwards paraId and returns id', () => {
    let capturedParaId: string | undefined;
    const ref = makeMockRef([makeParagraph('Hello')]);
    const origAdd = ref.addComment.bind(ref);
    ref.addComment = (opts) => {
      capturedParaId = opts.paraId;
      return origAdd(opts);
    };
    const bridge = createEditorBridge(ref, 'Agent');

    const id = bridge.addComment({ paraId: 'p_a3f', text: 'Nice paragraph' });
    expect(id).not.toBeNull();
    expect(capturedParaId).toBe('p_a3f');
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
    bridge.addComment({ paraId: 'p_a3f', text: 'Test' });
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
    bridge.addComment({ paraId: 'p_a3f', text: 'Test', author: 'CustomAuthor' });
    expect(capturedAuthor).toBe('CustomAuthor');
  });

  test('proposeChange forwards paraId/search/replaceWith', () => {
    const ref = makeMockRef([makeParagraph('Hello world')]) as EditorRefLike & {
      _proposeChangeCalled: boolean;
    };
    const bridge = createEditorBridge(ref, 'Agent');

    const ok = bridge.proposeChange({
      paraId: 'p_a3f',
      search: 'Hello',
      replaceWith: 'Hi',
    });
    expect(ok).toBe(true);
    expect(ref._proposeChangeCalled).toBe(true);
  });

  test('scrollTo forwards paraId', () => {
    const ref = makeMockRef([makeParagraph('Hello')]) as EditorRefLike & {
      _scrolledTo: string | undefined;
    };
    const bridge = createEditorBridge(ref);

    bridge.scrollTo('p_a3f');
    expect(ref._scrolledTo).toBe('p_a3f');
  });

  test('findText forwards through to ref.findInDocument', () => {
    const ref = makeMockRef([makeParagraph('Hello world')]);
    ref.findInDocument = () => [{ paraId: 'p_a3f', match: 'world', before: 'Hello ', after: '' }];
    const bridge = createEditorBridge(ref);
    const matches = bridge.findText('world');
    expect(matches).toHaveLength(1);
    expect(matches[0].paraId).toBe('p_a3f');
  });

  test('getSelection returns null when nothing selected', () => {
    const ref = makeMockRef([makeParagraph('Hello')]);
    const bridge = createEditorBridge(ref);
    expect(bridge.getSelection()).toBeNull();
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

  test('onContentChange fires listeners with comment / change snapshots, returns unsubscribe', () => {
    const ref = makeMockRef([makeParagraph('Hello')]) as EditorRefLike & {
      _emitContent: () => void;
      _contentListenerCount: () => number;
    };
    const bridge = createEditorBridge(ref);

    const events: Array<{ commentCount: number; changeCount: number }> = [];
    const unsubscribe = bridge.onContentChange((e) =>
      events.push({ commentCount: e.commentCount, changeCount: e.changeCount })
    );

    expect(ref._contentListenerCount()).toBe(1);
    ref._emitContent();
    ref._emitContent();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ commentCount: 0, changeCount: 0 });

    unsubscribe();
    expect(ref._contentListenerCount()).toBe(0);
    ref._emitContent();
    expect(events).toHaveLength(2); // unchanged after unsubscribe
  });

  test('onSelectionChange forwards selection info from the ref', () => {
    const ref = makeMockRef([makeParagraph('Hi')]) as EditorRefLike & {
      _emitSelection: () => void;
    };
    ref.getSelectionInfo = () => ({
      paraId: 'p_a3f',
      selectedText: 'Hi',
      paragraphText: 'Hi',
      before: '',
      after: '',
    });
    const bridge = createEditorBridge(ref);

    const seen: Array<{ paraId: string | null } | null> = [];
    bridge.onSelectionChange((e) => seen.push(e));
    ref._emitSelection();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.paraId).toBe('p_a3f');
  });

  test('replyTo forwards commentId, text, and resolved author', () => {
    const captures: Array<{ commentId: number; text: string; author: string }> = [];
    const ref = makeMockRef([makeParagraph('Hello')]);
    ref.replyToComment = (id, text, author) => {
      captures.push({ commentId: id, text, author });
      return 42;
    };
    const bridge = createEditorBridge(ref, 'DefaultAgent');

    bridge.replyTo(7, { text: 'Sure thing' });
    expect(captures.at(-1)).toEqual({ commentId: 7, text: 'Sure thing', author: 'DefaultAgent' });

    bridge.replyTo(7, { text: 'Override', author: 'OtherAgent' });
    expect(captures.at(-1)).toEqual({ commentId: 7, text: 'Override', author: 'OtherAgent' });
  });

  test('replyTo returns null when the ref reports the parent missing', () => {
    const ref = makeMockRef([makeParagraph('Hello')]);
    ref.replyToComment = () => null;
    const bridge = createEditorBridge(ref);
    expect(bridge.replyTo(999, { text: 'no parent' })).toBeNull();
  });

  test('resolveComment forwards id', () => {
    let resolved: number | undefined;
    const ref = makeMockRef([makeParagraph('Hello')]);
    ref.resolveComment = (id) => {
      resolved = id;
    };
    const bridge = createEditorBridge(ref);
    bridge.resolveComment(13);
    expect(resolved).toBe(13);
  });

  test('proposeChange resolves author from default and override', () => {
    const captures: Array<{ paraId: string; author: string }> = [];
    const ref = makeMockRef([makeParagraph('Hello world')]);
    ref.proposeChange = (opts) => {
      captures.push({ paraId: opts.paraId, author: opts.author });
      return true;
    };
    const bridge = createEditorBridge(ref, 'DefaultAgent');

    bridge.proposeChange({ paraId: 'p_a3f', search: 'Hello', replaceWith: 'Hi' });
    expect(captures.at(-1)).toEqual({ paraId: 'p_a3f', author: 'DefaultAgent' });

    bridge.proposeChange({
      paraId: 'p_a3f',
      search: 'Hello',
      replaceWith: 'Hi',
      author: 'OverrideAgent',
    });
    expect(captures.at(-1)).toEqual({ paraId: 'p_a3f', author: 'OverrideAgent' });
  });

  test('proposeChange returns false when ref reports failure', () => {
    const ref = makeMockRef([makeParagraph('Hello')]);
    ref.proposeChange = () => false;
    const bridge = createEditorBridge(ref);
    expect(bridge.proposeChange({ paraId: 'p_missing', search: 'x', replaceWith: 'y' })).toBe(
      false
    );
  });

  test('scrollTo returns false when paraId is missing', () => {
    const ref = makeMockRef([makeParagraph('Hello')]);
    ref.scrollToParaId = () => false;
    const bridge = createEditorBridge(ref);
    expect(bridge.scrollTo('p_missing')).toBe(false);
  });

  test('findText forwards options through unchanged', () => {
    let captured: { caseSensitive?: boolean; limit?: number } | undefined;
    const ref = makeMockRef([makeParagraph('Hello')]);
    ref.findInDocument = (_q, opts) => {
      captured = opts;
      return [];
    };
    const bridge = createEditorBridge(ref);
    bridge.findText('hi', { caseSensitive: true, limit: 3 });
    expect(captured).toEqual({ caseSensitive: true, limit: 3 });
  });

  test('getSelection returns the SelectionInfo object verbatim', () => {
    const sel = {
      paraId: 'p_a3f',
      selectedText: 'world',
      paragraphText: 'Hello world',
      before: 'Hello ',
      after: '',
    };
    const ref = makeMockRef([makeParagraph('Hello world')]);
    ref.getSelectionInfo = () => sel;
    const bridge = createEditorBridge(ref);
    expect(bridge.getSelection()).toEqual(sel);
  });

  test('onContentChange listener errors are caught (other listeners still fire)', () => {
    const ref = makeMockRef([makeParagraph('Hello')]) as EditorRefLike & {
      _emitContent: () => void;
    };
    const bridge = createEditorBridge(ref);

    let secondFired = false;
    bridge.onContentChange(() => {
      throw new Error('first listener boom');
    });
    bridge.onContentChange(() => {
      secondFired = true;
    });

    // Swallow the synchronous console.error from the bridge fan-out.
    const origErr = console.error;
    console.error = () => {};
    try {
      ref._emitContent();
    } finally {
      console.error = origErr;
    }
    expect(secondFired).toBe(true);
  });

  test('onSelectionChange unsubscribe removes only the matched listener', () => {
    const ref = makeMockRef([makeParagraph('Hello')]) as EditorRefLike & {
      _emitSelection: () => void;
    };
    const bridge = createEditorBridge(ref);

    let aFired = 0;
    let bFired = 0;
    const offA = bridge.onSelectionChange(() => {
      aFired++;
    });
    bridge.onSelectionChange(() => {
      bFired++;
    });

    ref._emitSelection();
    expect(aFired).toBe(1);
    expect(bFired).toBe(1);

    offA();
    ref._emitSelection();
    expect(aFired).toBe(1); // unchanged
    expect(bFired).toBe(2);
  });

  test('returns empty data when ref has no document', () => {
    const ref: EditorRefLike = {
      getDocument: () => null,
      getEditorRef: () => null,
      addComment: () => null,
      replyToComment: () => null,
      resolveComment: () => {},
      proposeChange: () => false,
      scrollToParaId: () => false,
      findInDocument: () => [],
      getSelectionInfo: () => null,
      getComments: () => [],
      applyFormatting: () => false,
      setParagraphStyle: () => false,
      getPageContent: () => null,
      getTotalPages: () => 0,
      getCurrentPage: () => 0,
      onContentChange: () => () => undefined,
      onSelectionChange: () => () => undefined,
    };
    const bridge = createEditorBridge(ref);

    expect(bridge.getContentAsText()).toBe('');
    expect(bridge.getContent()).toEqual([]);
    expect(bridge.getComments()).toEqual([]);
    expect(bridge.getChanges()).toEqual([]);
  });
});
