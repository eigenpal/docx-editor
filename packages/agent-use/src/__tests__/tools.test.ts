import { describe, test, expect } from 'bun:test';
import type { EditorBridge } from '../bridge';
import { agentTools, executeToolCall, getToolSchemas } from '../tools';
import type { ReviewComment, ReviewChange, ContentBlock } from '../types';

// ============================================================================
// MOCK BRIDGE
// ============================================================================

function makeBridge(overrides: Partial<EditorBridge> = {}): EditorBridge {
  return {
    getContentAsText: () => '[0] Hello world\n[1] Second paragraph',
    getContent: () =>
      [
        { type: 'paragraph', index: 0, text: 'Hello world' },
        { type: 'paragraph', index: 1, text: 'Second paragraph' },
      ] as ContentBlock[],
    getComments: () => [],
    getChanges: () => [],
    addComment: () => 42,
    replyTo: () => 43,
    resolveComment: () => {},
    replace: () => true,
    scrollTo: () => {},
    ...overrides,
  };
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

describe('agentTools', () => {
  test('has 6 built-in tools', () => {
    expect(agentTools).toHaveLength(6);
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
});

// ============================================================================
// getToolSchemas (OpenAI format)
// ============================================================================

describe('getToolSchemas', () => {
  test('returns OpenAI function calling format', () => {
    const schemas = getToolSchemas();
    expect(schemas.length).toBe(6);

    for (const schema of schemas) {
      expect(schema.type).toBe('function');
      expect(schema.function.name).toBeTruthy();
      expect(schema.function.description).toBeTruthy();
      expect(schema.function.parameters).toBeDefined();
    }
  });

  test('includes read_document tool', () => {
    const schemas = getToolSchemas();
    const readDoc = schemas.find((s) => s.function.name === 'read_document');
    expect(readDoc).toBeDefined();
    expect(readDoc!.function.parameters).toHaveProperty('properties');
  });
});

// ============================================================================
// executeToolCall
// ============================================================================

describe('executeToolCall', () => {
  test('returns error for unknown tool', () => {
    const bridge = makeBridge();
    const result = executeToolCall('nonexistent_tool', {}, bridge);
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
  test('returns document content as text', () => {
    const bridge = makeBridge();
    const result = executeToolCall('read_document', {}, bridge);
    expect(result.success).toBe(true);
    expect(result.data).toContain('[0] Hello world');
    expect(result.data).toContain('[1] Second paragraph');
  });

  test('passes fromIndex and toIndex', () => {
    let capturedFrom: number | undefined;
    let capturedTo: number | undefined;
    const bridge = makeBridge({
      getContentAsText: (options) => {
        capturedFrom = options?.fromIndex;
        capturedTo = options?.toIndex;
        return '[5] Some text';
      },
    });
    executeToolCall('read_document', { fromIndex: 5, toIndex: 10 }, bridge);
    expect(capturedFrom).toBe(5);
    expect(capturedTo).toBe(10);
  });
});

// ============================================================================
// read_comments
// ============================================================================

describe('read_comments', () => {
  test('returns "no comments" when empty', () => {
    const bridge = makeBridge();
    const result = executeToolCall('read_comments', {}, bridge);
    expect(result.success).toBe(true);
    expect(result.data).toContain('No comments');
  });

  test('formats comments with id, paragraph, author', () => {
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
    expect(result.data as string).toContain('paragraph 3');
    expect(result.data as string).toContain('Alice');
    expect(result.data as string).toContain('Fix this');
  });
});

// ============================================================================
// read_changes
// ============================================================================

describe('read_changes', () => {
  test('returns "no tracked changes" when empty', () => {
    const bridge = makeBridge();
    const result = executeToolCall('read_changes', {}, bridge);
    expect(result.success).toBe(true);
    expect(result.data).toContain('No tracked changes');
  });

  test('formats changes with id, type, author', () => {
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
    expect(result.data as string).toContain('Bob');
  });
});

// ============================================================================
// add_comment
// ============================================================================

describe('add_comment', () => {
  test('adds comment and returns success with id', () => {
    const bridge = makeBridge({ addComment: () => 42 });
    const result = executeToolCall(
      'add_comment',
      { paragraphIndex: 3, text: 'Needs work' },
      bridge
    );
    expect(result.success).toBe(true);
    expect(result.data as string).toContain('42');
    expect(result.data as string).toContain('paragraph 3');
  });

  test('passes search parameter', () => {
    let capturedSearch: string | undefined;
    const bridge = makeBridge({
      addComment: (opts) => {
        capturedSearch = opts.search;
        return 1;
      },
    });
    executeToolCall(
      'add_comment',
      { paragraphIndex: 0, text: 'Fix', search: 'hello world' },
      bridge
    );
    expect(capturedSearch).toBe('hello world');
  });

  test('returns error when paragraph not found', () => {
    const bridge = makeBridge({ addComment: () => null });
    const result = executeToolCall('add_comment', { paragraphIndex: 999, text: 'Nope' }, bridge);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

// ============================================================================
// suggest_replacement
// ============================================================================

describe('suggest_replacement', () => {
  test('creates tracked change and returns success', () => {
    const bridge = makeBridge({ replace: () => true });
    const result = executeToolCall(
      'suggest_replacement',
      { paragraphIndex: 1, search: 'old text', replaceWith: 'new text' },
      bridge
    );
    expect(result.success).toBe(true);
    expect(result.data as string).toContain('old text');
    expect(result.data as string).toContain('new text');
  });

  test('returns error when search text not found', () => {
    const bridge = makeBridge({ replace: () => false });
    const result = executeToolCall(
      'suggest_replacement',
      { paragraphIndex: 0, search: 'nonexistent', replaceWith: 'replacement' },
      bridge
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

// ============================================================================
// scroll_to
// ============================================================================

describe('scroll_to', () => {
  test('calls scrollTo and returns success', () => {
    let scrolledTo: number | undefined;
    const bridge = makeBridge({
      scrollTo: (idx) => {
        scrolledTo = idx;
      },
    });
    const result = executeToolCall('scroll_to', { paragraphIndex: 7 }, bridge);
    expect(result.success).toBe(true);
    expect(scrolledTo).toBe(7);
  });
});
