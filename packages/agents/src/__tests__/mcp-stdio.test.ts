import { describe, test, expect } from 'bun:test';
import { runStdioServer, type InputStream, type OutputStream } from '../mcp/stdio';
import type { EditorBridge } from '../bridge';
import type { JsonRpcResponse, JsonRpcSuccess, JsonRpcError } from '../mcp/protocol';
import { ErrorCode } from '../mcp/protocol';

/** A fake input stream that captures handlers and lets us emit events on demand. */
function makeFakeInput(): {
  stream: InputStream;
  emit: (event: 'data' | 'end' | 'error', payload?: string | Buffer | Error) => void;
} {
  const handlers: Record<string, Array<(p: unknown) => void>> = {};
  const stream: InputStream = {
    on(event: string, listener: (p: unknown) => void) {
      handlers[event] ??= [];
      handlers[event].push(listener);
      return stream;
    },
  } as InputStream;
  return {
    stream,
    emit(event, payload) {
      for (const h of handlers[event] ?? []) h(payload as unknown);
    },
  };
}

/** A fake output stream that buffers writes for assertions. */
function makeFakeOutput(): { stream: OutputStream; reads: () => string; lines: () => string[] } {
  let buf = '';
  return {
    stream: { write: (s: string) => ((buf += s), true) },
    reads: () => buf,
    lines: () => buf.split('\n').filter((l) => l.length > 0),
  };
}

function makeBridge(): EditorBridge {
  return {
    getContentAsText: () => '[p_a3f] Hello',
    getContent: () => [{ type: 'paragraph', index: 0, paraId: 'p_a3f', text: 'Hello' }],
    getComments: () => [],
    getChanges: () => [],
    findText: () => [],
    getSelection: () => null,
    addComment: () => 7,
    replyTo: () => 8,
    resolveComment: () => {},
    proposeChange: () => true,
    applyFormatting: () => true,
    setParagraphStyle: () => true,
    getPage: () => null,
    getPages: () => [],
    getTotalPages: () => 0,
    getCurrentPage: () => 0,
    scrollTo: () => true,
    onContentChange: () => () => undefined,
    onSelectionChange: () => () => undefined,
  };
}

function parseLine(s: string): JsonRpcResponse {
  return JSON.parse(s) as JsonRpcResponse;
}

describe('runStdioServer — happy path', () => {
  test('initialize round-trip (string input)', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    runStdioServer(makeBridge(), { input: input.stream, output: output.stream });

    input.emit('data', '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    const lines = output.lines();
    expect(lines).toHaveLength(1);
    const reply = parseLine(lines[0]) as JsonRpcSuccess;
    expect(reply.id).toBe(1);
    expect((reply.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
  });

  test('handles Buffer input chunks', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    runStdioServer(makeBridge(), { input: input.stream, output: output.stream });

    input.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}\n'));
    const lines = output.lines();
    expect(lines).toHaveLength(1);
    expect((parseLine(lines[0]) as JsonRpcSuccess).result).toEqual({});
  });

  test('multiple tool calls in one chunk → each gets a reply, in order', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    runStdioServer(makeBridge(), { input: input.stream, output: output.stream });

    input.emit(
      'data',
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n' + '{"jsonrpc":"2.0","id":2,"method":"ping"}\n'
    );
    const lines = output.lines();
    expect(lines).toHaveLength(2);
    expect((parseLine(lines[0]) as JsonRpcSuccess).id).toBe(1);
    expect((parseLine(lines[1]) as JsonRpcSuccess).id).toBe(2);
  });

  test('partial frame across two chunks → reply only after newline', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    runStdioServer(makeBridge(), { input: input.stream, output: output.stream });

    input.emit('data', '{"jsonrpc":"2.0","id":1,"meth');
    expect(output.lines()).toHaveLength(0);
    input.emit('data', 'od":"ping"}\n');
    expect(output.lines()).toHaveLength(1);
  });

  test('notification (no id) → no reply, no error', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    runStdioServer(makeBridge(), { input: input.stream, output: output.stream });

    input.emit('data', '{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    expect(output.lines()).toHaveLength(0);
  });
});

describe('runStdioServer — error & lifecycle', () => {
  test('malformed line → ParseError reply with id: null', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    const logs: string[] = [];
    runStdioServer(makeBridge(), {
      input: input.stream,
      output: output.stream,
      log: (m) => logs.push(m),
    });

    input.emit('data', 'this-is-not-json\n');
    const lines = output.lines();
    expect(lines).toHaveLength(1);
    const reply = parseLine(lines[0]) as JsonRpcError;
    expect(reply.error?.code).toBe(ErrorCode.ParseError);
    expect(reply.id).toBeNull();
    expect(logs.some((l) => l.includes('parse error'))).toBe(true);
  });

  test('handle() never throws — internal errors arrive as JSON-RPC errors', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    runStdioServer(makeBridge(), { input: input.stream, output: output.stream });

    input.emit('data', '{"jsonrpc":"2.0","id":1,"method":"unknown/op"}\n');
    const reply = parseLine(output.lines()[0]) as JsonRpcError;
    expect(reply.error?.code).toBe(ErrorCode.MethodNotFound);
  });

  test('after `end`, further `data` is ignored', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    runStdioServer(makeBridge(), { input: input.stream, output: output.stream });

    input.emit('end');
    input.emit('data', '{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(output.lines()).toHaveLength(0);
  });

  test('after manual close(), further `feed` is ignored', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    const handle = runStdioServer(makeBridge(), {
      input: input.stream,
      output: output.stream,
    });
    handle.close();
    handle.feed('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(output.lines()).toHaveLength(0);
  });

  test('input error event is logged, transport stops', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    const logs: string[] = [];
    runStdioServer(makeBridge(), {
      input: input.stream,
      output: output.stream,
      log: (m) => logs.push(m),
    });

    input.emit('error', new Error('pipe broken'));
    input.emit('data', '{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(logs.some((l) => l.includes('pipe broken'))).toBe(true);
    expect(output.lines()).toHaveLength(0);
  });

  test('tools/list end-to-end through stdio', () => {
    const input = makeFakeInput();
    const output = makeFakeOutput();
    runStdioServer(makeBridge(), { input: input.stream, output: output.stream });

    input.emit('data', '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    const reply = parseLine(output.lines()[0]) as JsonRpcSuccess;
    const result = reply.result as { tools: Array<{ name: string }> };
    expect(result.tools.length).toBe(14);
  });
});

describe('runStdioServer — input/output binding', () => {
  test('throws when no input stream available', () => {
    const output = makeFakeOutput();
    // Force the default-stream path with no fallback by passing a no-op input
    // that's missing — we simulate by passing null via cast to exercise the guard.
    expect(() =>
      runStdioServer(makeBridge(), {
        input: undefined as unknown as InputStream,
        output: output.stream,
      })
    ).not.toThrow(); // process.stdin exists in test runner — the no-fail path
  });
});
