import { describe, test, expect } from 'bun:test';
import { McpServer } from '../mcp/server';
import { ErrorCode, type JsonRpcSuccess, type JsonRpcError } from '../mcp/protocol';
import type { EditorBridge } from '../bridge';
import type { McpToolsCallResult, McpToolsListResult, McpInitializeResult } from '../mcp/protocol';

function makeBridge(overrides: Partial<EditorBridge> = {}): EditorBridge {
  return {
    getContentAsText: () => '[p_a3f] Hello',
    getContent: () => [{ type: 'paragraph', index: 0, paraId: 'p_a3f', text: 'Hello' }],
    getComments: () => [],
    getChanges: () => [],
    findText: () => [],
    getSelection: () => null,
    addComment: () => 1,
    replyTo: () => 2,
    resolveComment: () => {},
    proposeChange: () => true,
    scrollTo: () => true,
    onContentChange: () => () => undefined,
    onSelectionChange: () => () => undefined,
    ...overrides,
  };
}

describe('McpServer.handle — initialize', () => {
  test('replies with protocol version, capabilities.tools, and serverInfo', () => {
    const server = new McpServer(makeBridge(), { name: 'test', version: '1.2.3' });
    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    });
    expect(reply).not.toBeNull();
    const result = (reply as JsonRpcSuccess).result as McpInitializeResult;
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo).toEqual({ name: 'test', version: '1.2.3' });
  });

  test('uses default name/version/protocolVersion when options omitted', () => {
    const server = new McpServer(makeBridge());
    const reply = server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const result = (reply as JsonRpcSuccess).result as McpInitializeResult;
    expect(result.serverInfo.name).toBe('@eigenpal/docx-editor-agents');
    expect(result.serverInfo.version).toBe('0.0.0');
    expect(result.protocolVersion).toBe('2025-06-18');
  });
});

describe('McpServer.handle — tools/list', () => {
  test('returns the full tool catalog in MCP shape', () => {
    const server = new McpServer(makeBridge());
    const reply = server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const result = (reply as JsonRpcSuccess).result as McpToolsListResult;
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBe(10);
    for (const tool of result.tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.inputSchema).toBe('object');
    }
    const names = result.tools.map((t) => t.name).sort();
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

describe('McpServer.handle — tools/call success', () => {
  test('add_comment returns a CallToolResult with isError absent', () => {
    let capturedParaId: string | undefined;
    let capturedText: string | undefined;
    const server = new McpServer(
      makeBridge({
        addComment: (opts) => {
          capturedParaId = opts.paraId;
          capturedText = opts.text;
          return 99;
        },
      })
    );
    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'add_comment', arguments: { paraId: 'p_a3f', text: 'Hi' } },
    });
    const result = (reply as JsonRpcSuccess).result as McpToolsCallResult;
    expect(capturedParaId).toBe('p_a3f');
    expect(capturedText).toBe('Hi');
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('99');
  });

  test('read_document content is plain string text (no JSON-stringification)', () => {
    const server = new McpServer(makeBridge());
    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'read_document', arguments: {} },
    });
    const result = (reply as JsonRpcSuccess).result as McpToolsCallResult;
    expect(result.content[0].text).toContain('[p_a3f]');
  });

  test('find_text returns JSON-stringified array (object data path)', () => {
    const server = new McpServer(
      makeBridge({
        findText: () => [{ paraId: 'p_a3f', match: 'world', before: 'Hello ', after: '' }],
      })
    );
    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'find_text', arguments: { query: 'world' } },
    });
    const result = (reply as JsonRpcSuccess).result as McpToolsCallResult;
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].paraId).toBe('p_a3f');
  });
});

describe('McpServer.handle — tools/call error envelope', () => {
  test('tool failure → success JSON-RPC + isError content (per MCP spec)', () => {
    const server = new McpServer(makeBridge({ addComment: () => null }));
    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'add_comment', arguments: { paraId: 'missing', text: 'x' } },
    });
    expect((reply as JsonRpcSuccess).result).toBeDefined();
    const result = (reply as JsonRpcSuccess).result as McpToolsCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('paraId');
  });

  test('handler throws → caught and surfaced as isError', () => {
    const server = new McpServer(
      makeBridge({
        getContentAsText: () => {
          throw new Error('storage offline');
        },
      })
    );
    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'read_document', arguments: {} },
    });
    const result = (reply as JsonRpcSuccess).result as McpToolsCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('storage offline');
  });

  test('unknown tool name → isError text from executeToolCall', () => {
    const server = new McpServer(makeBridge());
    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'no_such_tool', arguments: {} },
    });
    const result = (reply as JsonRpcSuccess).result as McpToolsCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  test('missing tool name → JSON-RPC InvalidParams error', () => {
    const server = new McpServer(makeBridge());
    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { arguments: {} },
    });
    expect((reply as JsonRpcError).error?.code).toBe(ErrorCode.InvalidParams);
  });
});

describe('McpServer.handle — protocol-level paths', () => {
  test('unknown method → MethodNotFound', () => {
    const server = new McpServer(makeBridge());
    const reply = server.handle({ jsonrpc: '2.0', id: 1, method: 'unknown/op' });
    expect((reply as JsonRpcError).error?.code).toBe(ErrorCode.MethodNotFound);
  });

  test('ping → empty success', () => {
    const server = new McpServer(makeBridge());
    const reply = server.handle({ jsonrpc: '2.0', id: 7, method: 'ping' });
    expect((reply as JsonRpcSuccess).result).toEqual({});
  });

  test('notifications (no id) are ignored, returning null', () => {
    const server = new McpServer(makeBridge());
    expect(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  test('responses (no method) are ignored', () => {
    const server = new McpServer(makeBridge());
    // Type-cheat: we want to feed a non-request shape to confirm null fallthrough.
    expect(server.handle({ jsonrpc: '2.0', id: 1, result: {} } as never)).toBeNull();
  });
});

describe('McpServer + bridge contract — every tool round-trips', () => {
  test('all 10 tools dispatch without throwing and return a content payload', () => {
    const server = new McpServer(makeBridge());
    const cases: Array<{ name: string; args: Record<string, unknown> }> = [
      { name: 'read_document', args: {} },
      { name: 'read_selection', args: {} },
      { name: 'find_text', args: { query: 'hello' } },
      { name: 'read_comments', args: {} },
      { name: 'read_changes', args: {} },
      { name: 'add_comment', args: { paraId: 'p', text: 't' } },
      { name: 'suggest_change', args: { paraId: 'p', search: 'a', replaceWith: 'b' } },
      { name: 'reply_comment', args: { commentId: 1, text: 't' } },
      { name: 'resolve_comment', args: { commentId: 1 } },
      { name: 'scroll', args: { paraId: 'p' } },
    ];

    for (const c of cases) {
      const reply = server.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: c.name, arguments: c.args },
      });
      const result = (reply as JsonRpcSuccess).result as McpToolsCallResult;
      expect(result.content[0].type).toBe('text');
      expect(typeof result.content[0].text).toBe('string');
    }
  });
});
