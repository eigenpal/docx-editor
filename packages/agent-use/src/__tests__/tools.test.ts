import { describe, test, expect } from 'bun:test';
import type { EditorBridge } from '../bridge';
import { agentTools, executeToolCall, getToolSchemas } from '../tools';
import type { ReviewComment, ReviewChange, ContentBlock, FoundMatch } from '../types';

// ============================================================================
// MOCK BRIDGE
// ============================================================================

function makeBridge(overrides: Partial<EditorBridge> = {}): EditorBridge {
  return {
    getContentAsText: () => '[p_a3f] Hello world\n[p_b07] Second paragraph',
    getContent: () =>
      [
        { type: 'paragraph', index: 0, paraId: 'p_a3f', text: 'Hello world' },
        { type: 'paragraph', index: 1, paraId: 'p_b07', text: 'Second paragraph' },
      ] as ContentBlock[],
    getComments: () => [],
    getChanges: () => [],
    findText: () => [],
    getSelection: () => null,
    addComment: () => 42,
    replyTo: () => 43,
    resolveComment: () => {},
    proposeChange: () => true,
    scrollTo: () => true,
    onContentChange: () => () => undefined,
    onSelectionChange: () => () => undefined,
    ...overrides,
  };
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

describe('agentTools', () => {
  test('has 10 built-in tools', () => {
    expect(agentTools).toHaveLength(10);
  });

  test('all tools have name, description, inputSchema, handler', () => {
    for (const tool of agentTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  test('tool names are unique', () => {
    const names = agentTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('exposes the documented surface', () => {
    const names = agentTools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_comment',
        'find_text',
        'read_changes',
        'read_comments',
        'read_document',
        'read_selection',
        'reply_comment',
        'resolve_comment',
        'scroll',
        'suggest_change',
      ].sort()
    );
  });
});

// ============================================================================
// getToolSchemas (OpenAI format)
// ============================================================================

describe('getToolSchemas', () => {
  test('returns OpenAI function calling format', () => {
    const schemas = getToolSchemas();
    expect(schemas.length).toBe(10);

    for (const schema of schemas) {
      expect(schema.type).toBe('function');
      expect(schema.function.name).toBeTruthy();
      expect(schema.function.description).toBeTruthy();
      expect(schema.function.parameters).toBeDefined();
    }
  });
});

// ============================================================================
// executeToolCall
// ============================================================================

describe('executeToolCall', () => {
  test('returns error for unknown tool', () => {
    const result = executeToolCall('nonexistent_tool', {}, makeBridge());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  test('catches handler exceptions', () => {
    const bridge = makeBridge({
      getContentAsText: () => {
        throw new Error('boom');
      },
    });
    const result = executeToolCall('read_document', {}, bridge);
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });
});

// ============================================================================
// read_document
// ============================================================================

describe('read_document', () => {
  test('returns paraId-tagged content as text', () => {
    const result = executeToolCall('read_document', {}, makeBridge());
    expect(result.success).toBe(true);
    expect(result.data).toContain('[p_a3f]');
    expect(result.data).toContain('Hello world');
  });

  test('strips tracked-change and comment annotations so search args match live text', () => {
    let capturedTracked: boolean | undefined;
    let capturedAnchors: boolean | undefined;
    const bridge = makeBridge({
      getContentAsText: (options) => {
        capturedTracked = options?.includeTrackedChanges;
        capturedAnchors = options?.includeCommentAnchors;
        return '[p_a3f] clean';
      },
    });
    executeToolCall('read_document', {}, bridge);
    expect(capturedTracked).toBe(false);
    expect(capturedAnchors).toBe(false);
  });
});

// ============================================================================
// read_selection
// ============================================================================

describe('read_selection', () => {
  test('returns selection info', () => {
    const bridge = makeBridge({
      getSelection: () => ({
        paraId: 'p_a3f',
        selectedText: 'world',
        paragraphText: 'Hello world',
        before: 'Hello ',
        after: '',
      }),
    });
    const result = executeToolCall('read_selection', {}, bridge);
    expect(result.success).toBe(true);
    expect((result.data as { paraId: string }).paraId).toBe('p_a3f');
  });

  test('returns error when nothing is selected', () => {
    const result = executeToolCall('read_selection', {}, makeBridge());
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// find_text
// ============================================================================

describe('find_text', () => {
  test('returns match handles with paraId and surrounding context', () => {
    const matches: FoundMatch[] = [
      { paraId: 'p_a3f', match: 'world', before: 'Hello ', after: '!' },
    ];
    const bridge = makeBridge({ findText: () => matches });
    const result = executeToolCall('find_text', { query: 'world' }, bridge);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(matches);
  });

  test('returns "no matches" when empty', () => {
    const result = executeToolCall('find_text', { query: 'zzz' }, makeBridge());
    expect(result.success).toBe(true);
    expect(result.data).toContain('No matches');
  });

  test('passes caseSensitive and limit through', () => {
    let captured: { caseSensitive?: boolean; limit?: number } | undefined;
    const bridge = makeBridge({
      findText: (_q, opts) => {
        captured = opts;
        return [];
      },
    });
    executeToolCall('find_text', { query: 'X', caseSensitive: true, limit: 5 }, bridge);
    expect(captured?.caseSensitive).toBe(true);
    expect(captured?.limit).toBe(5);
  });
});

// ============================================================================
// read_comments / read_changes
// ============================================================================

describe('read_comments', () => {
  test('formats comments with id and author', () => {
    const bridge = makeBridge({
      getComments: () =>
        [
          {
            id: 1,
            author: 'Alice',
            date: null,
            text: 'Fix this',
            anchoredText: 'hello',
            paragraphIndex: 3,
            replies: [],
            done: false,
          },
        ] as ReviewComment[],
    });
    const result = executeToolCall('read_comments', {}, bridge);
    expect(result.success).toBe(true);
    expect(result.data as string).toContain('Comment #1');
    expect(result.data as string).toContain('Alice');
  });
});

describe('read_changes', () => {
  test('formats tracked changes', () => {
    const bridge = makeBridge({
      getChanges: () =>
        [
          {
            id: 5,
            type: 'insertion',
            author: 'Bob',
            date: null,
            text: 'new text',
            context: '',
            paragraphIndex: 2,
          },
        ] as ReviewChange[],
    });
    const result = executeToolCall('read_changes', {}, bridge);
    expect(result.success).toBe(true);
    expect(result.data as string).toContain('Change #5');
    expect(result.data as string).toContain('insertion');
  });
});

// ============================================================================
// add_comment
// ============================================================================

describe('add_comment', () => {
  test('passes paraId through to the bridge', () => {
    let captured: string | undefined;
    const bridge = makeBridge({
      addComment: (opts) => {
        captured = opts.paraId;
        return 7;
      },
    });
    const result = executeToolCall('add_comment', { paraId: 'p_a3f', text: 'Needs work' }, bridge);
    expect(result.success).toBe(true);
    expect(captured).toBe('p_a3f');
    expect(result.data as string).toContain('p_a3f');
  });

  test('returns error when paragraph not found / search ambiguous', () => {
    const bridge = makeBridge({ addComment: () => null });
    const result = executeToolCall('add_comment', { paraId: 'missing', text: 'no' }, bridge);
    expect(result.success).toBe(false);
    expect(result.error).toContain('paraId');
  });
});

// ============================================================================
// suggest_change — replacement / deletion / insertion modes
// ============================================================================

describe('suggest_change', () => {
  test('replacement mode', () => {
    const bridge = makeBridge({ proposeChange: () => true });
    const result = executeToolCall(
      'suggest_change',
      { paraId: 'p_a3f', search: 'old', replaceWith: 'new' },
      bridge
    );
    expect(result.success).toBe(true);
    expect(result.data as string).toContain('Replacement');
  });

  test('deletion mode (replaceWith empty)', () => {
    const bridge = makeBridge({ proposeChange: () => true });
    const result = executeToolCall(
      'suggest_change',
      { paraId: 'p_a3f', search: 'remove me', replaceWith: '' },
      bridge
    );
    expect(result.success).toBe(true);
    expect(result.data as string).toContain('Deletion');
  });

  test('insertion mode (search empty)', () => {
    const bridge = makeBridge({ proposeChange: () => true });
    const result = executeToolCall(
      'suggest_change',
      { paraId: 'p_a3f', search: '', replaceWith: 'add this' },
      bridge
    );
    expect(result.success).toBe(true);
    expect(result.data as string).toContain('Insertion');
  });

  test('failure returns guidance error', () => {
    const bridge = makeBridge({ proposeChange: () => false });
    const result = executeToolCall(
      'suggest_change',
      { paraId: 'missing', search: 'x', replaceWith: 'y' },
      bridge
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('paraId');
  });
});

// ============================================================================
// reply_comment / resolve_comment
// ============================================================================

describe('reply_comment', () => {
  test('replies and returns id', () => {
    const bridge = makeBridge({ replyTo: () => 99 });
    const result = executeToolCall('reply_comment', { commentId: 1, text: 'Sure thing' }, bridge);
    expect(result.success).toBe(true);
    expect(result.data as string).toContain('99');
  });

  test('errors on missing parent comment', () => {
    const bridge = makeBridge({ replyTo: () => null });
    const result = executeToolCall('reply_comment', { commentId: 1, text: 'x' }, bridge);
    expect(result.success).toBe(false);
  });
});

describe('resolve_comment', () => {
  test('forwards to bridge.resolveComment', () => {
    let resolved: number | undefined;
    const bridge = makeBridge({
      resolveComment: (id) => {
        resolved = id;
      },
    });
    const result = executeToolCall('resolve_comment', { commentId: 5 }, bridge);
    expect(result.success).toBe(true);
    expect(resolved).toBe(5);
  });
});

// ============================================================================
// scroll
// ============================================================================

describe('scroll', () => {
  test('forwards paraId and reports success', () => {
    let scrolled: string | undefined;
    const bridge = makeBridge({
      scrollTo: (paraId) => {
        scrolled = paraId;
        return true;
      },
    });
    const result = executeToolCall('scroll', { paraId: 'p_a3f' }, bridge);
    expect(result.success).toBe(true);
    expect(scrolled).toBe('p_a3f');
  });

  test('errors when paraId missing', () => {
    const bridge = makeBridge({ scrollTo: () => false });
    const result = executeToolCall('scroll', { paraId: 'p_missing' }, bridge);
    expect(result.success).toBe(false);
  });
});
