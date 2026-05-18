import { describe, test, expect } from 'bun:test';
import {
  parseFrames,
  encodeFrame,
  makeSuccess,
  makeError,
  isJsonRpcRequest,
  isJsonRpcNotification,
  ErrorCode,
} from '../mcp/protocol';

describe('MCP protocol — parseFrames', () => {
  test('parses one complete frame', () => {
    const buf = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n';
    const r = parseFrames(buf);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(r.parseErrors).toEqual([]);
    expect(r.rest).toBe('');
  });

  test('parses multiple frames in a single buffer', () => {
    const buf =
      '{"jsonrpc":"2.0","id":1,"method":"a"}\n' + '{"jsonrpc":"2.0","id":2,"method":"b"}\n';
    const r = parseFrames(buf);
    expect(r.messages).toHaveLength(2);
    expect(r.messages[1]).toEqual({ jsonrpc: '2.0', id: 2, method: 'b' });
  });

  test('keeps trailing partial in rest', () => {
    const buf = '{"jsonrpc":"2.0","id":1,"method":"a"}\n{"jsonrpc":"2.0","id":2,"meth';
    const r = parseFrames(buf);
    expect(r.messages).toHaveLength(1);
    expect(r.rest).toContain('"meth');
  });

  test('emits parse errors for malformed lines without crashing', () => {
    const buf =
      '{"jsonrpc":"2.0","id":1,"method":"a"}\n' +
      'this-is-not-json\n' +
      '{"jsonrpc":"2.0","id":2,"method":"b"}\n';
    const r = parseFrames(buf);
    expect(r.messages).toHaveLength(2);
    expect(r.parseErrors).toEqual(['this-is-not-json']);
  });

  test('skips blank lines and tolerates leading/trailing whitespace', () => {
    const buf = '\n\n   \n{"jsonrpc":"2.0","id":1,"method":"a"}\n   \n';
    const r = parseFrames(buf);
    expect(r.messages).toHaveLength(1);
    expect(r.parseErrors).toEqual([]);
  });

  test('empty buffer returns no messages', () => {
    const r = parseFrames('');
    expect(r.messages).toEqual([]);
    expect(r.rest).toBe('');
  });
});

describe('MCP protocol — encodeFrame', () => {
  test('appends a single newline', () => {
    const f = encodeFrame(makeSuccess(1, { ok: true }));
    expect(f.endsWith('\n')).toBe(true);
    expect(f.split('\n')).toHaveLength(2); // body + trailing empty
  });

  test('round-trips parse(encode(x))', () => {
    const original = makeSuccess(42, { hello: 'world' });
    const r = parseFrames(encodeFrame(original));
    expect(r.messages[0]).toEqual(original);
  });
});

describe('MCP protocol — encoders', () => {
  test('makeSuccess shape', () => {
    expect(makeSuccess(1, { x: 1 })).toEqual({ jsonrpc: '2.0', id: 1, result: { x: 1 } });
  });

  test('makeError shape (no data)', () => {
    expect(makeError(1, ErrorCode.MethodNotFound, 'no')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: ErrorCode.MethodNotFound, message: 'no' },
    });
  });

  test('makeError shape (with data)', () => {
    expect(makeError(1, ErrorCode.InvalidParams, 'bad', { hint: 'foo' })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: ErrorCode.InvalidParams, message: 'bad', data: { hint: 'foo' } },
    });
  });

  test('makeError tolerates id: null', () => {
    expect(makeError(null, ErrorCode.ParseError, 'x').id).toBeNull();
  });
});

describe('MCP protocol — type guards', () => {
  test('isJsonRpcRequest accepts request, rejects notification', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'x' })).toBe(true);
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'x' })).toBe(false);
    expect(isJsonRpcRequest(null)).toBe(false);
    expect(isJsonRpcRequest({ jsonrpc: '1.0', id: 1, method: 'x' })).toBe(false);
  });

  test('isJsonRpcNotification accepts notification, rejects request', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'x' })).toBe(true);
    expect(isJsonRpcNotification({ jsonrpc: '2.0', id: 1, method: 'x' })).toBe(false);
    expect(isJsonRpcNotification({})).toBe(false);
  });

  test('id: null counts as a request (a valid edge case in JSON-RPC)', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: null, method: 'x' })).toBe(true);
  });
});

describe('MCP protocol — error code surface', () => {
  test('exposes the standard JSON-RPC codes', () => {
    expect(ErrorCode.ParseError).toBe(-32700);
    expect(ErrorCode.InvalidRequest).toBe(-32600);
    expect(ErrorCode.MethodNotFound).toBe(-32601);
    expect(ErrorCode.InvalidParams).toBe(-32602);
    expect(ErrorCode.InternalError).toBe(-32603);
  });
});
