/**
 * Stdio transport for the MCP server. Reads newline-delimited JSON-RPC from
 * an input stream, dispatches via McpServer, writes responses to an output
 * stream. Pure stream handling — no Node-only assumptions beyond "Readable
 * has .on('data') and Writable has .write".
 *
 * For real Node usage:
 *   import { runStdioServer } from '@eigenpal/docx-editor-agents/mcp';
 *   runStdioServer(bridge);
 *
 * For tests, pass any EventEmitter-shaped Readable + a function-shaped
 * Writable; see __tests__/mcp/stdio.test.ts.
 */

import { StringDecoder } from 'node:string_decoder';
import { McpServer, type McpServerOptions } from './server';
import type { EditorBridge } from '../bridge';
import { encodeFrame, parseFrames, ErrorCode, makeError, type JsonRpcMessage } from './protocol';

/** Hard cap on the in-memory frame buffer. Prevents a malformed peer from
 * exhausting memory by sending bytes without ever emitting a newline. 1 MiB
 * is ~10x the largest reasonable JSON-RPC frame for tools/list. */
const MAX_BUFFER_BYTES = 1024 * 1024;

/** Minimal duck-typed input stream — anything with `on('data', cb)` works. */
export interface InputStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/** Minimal duck-typed output stream — anything with a `write(string) => bool` works. */
export interface OutputStream {
  write(chunk: string): boolean | void;
}

export interface StdioServerOptions extends McpServerOptions {
  input?: InputStream;
  output?: OutputStream;
  /** Called with diagnostic strings (e.g. parse errors). Default: stderr. */
  log?: (msg: string) => void;
}

export interface StdioServerHandle {
  /** Underlying server (for tests / introspection). */
  server: McpServer;
  /** Manually feed a raw chunk (used by tests; the live transport calls this internally). */
  feed: (chunk: string | Buffer) => void;
  /** Stop accepting input and reject further writes. Idempotent. */
  close: () => void;
}

/**
 * Wire an EditorBridge to a JSON-RPC stdio loop. Returns immediately; reading
 * happens via the stream listeners. Designed to be testable: pass in fake
 * streams, call `feed(...)` directly, then assert on what was written.
 */
export function runStdioServer(
  bridge: EditorBridge,
  options: StdioServerOptions = {}
): StdioServerHandle {
  const server = new McpServer(bridge, options);

  // Resolve default streams lazily so the module is browser-safe; unused
  // imports of the namespace don't reach for `process` until you actually
  // call this function.
  const input =
    options.input ??
    (typeof process !== 'undefined' && process.stdin
      ? (process.stdin as unknown as InputStream)
      : null);
  const output =
    options.output ??
    (typeof process !== 'undefined' && process.stdout
      ? (process.stdout as unknown as OutputStream)
      : null);
  const log =
    options.log ??
    ((msg: string) => {
      if (typeof process !== 'undefined' && process.stderr) {
        (process.stderr as { write: (s: string) => void }).write(msg + '\n');
      }
    });

  if (!input || !output) {
    throw new Error(
      'runStdioServer: no input/output stream available. Pass options.input and options.output, or run inside a Node process with stdin/stdout.'
    );
  }

  // Pin the narrowed type for closures.
  const out = output;

  // StringDecoder preserves multi-byte UTF-8 codepoints across chunk boundaries,
  // so emoji / CJK / accented characters that straddle a chunk boundary don't
  // decode to U+FFFD. (Buffer.toString('utf8') decodes per-call, breaking them.)
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let closed = false;

  function dispatch(message: JsonRpcMessage): void {
    const reply = server.handle(message);
    if (reply !== null) out.write(encodeFrame(reply));
  }

  function feed(chunk: string | Buffer): void {
    if (closed) return;
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);

    // Cap buffer length to prevent a peer that never emits a newline from
    // growing it indefinitely. On overflow, drop the buffer and emit a
    // ParseError so the peer learns its frame was rejected.
    if (buffer.length > MAX_BUFFER_BYTES) {
      buffer = '';
      log(`MCP buffer overflow (>${MAX_BUFFER_BYTES} bytes without newline) — dropped`);
      out.write(encodeFrame(makeError(null, ErrorCode.ParseError, 'Frame too large')));
      return;
    }

    const { messages, parseErrors, rest } = parseFrames(buffer);
    buffer = rest;
    for (const m of messages) dispatch(m);
    for (const bad of parseErrors) {
      log(`MCP parse error: ${bad}`);
      // JSON-RPC says we can't reply to an unparseable id, so emit a generic
      // ParseError with id: null per spec.
      out.write(encodeFrame(makeError(null, ErrorCode.ParseError, 'Parse error', bad)));
    }
  }

  input.on('data', feed);
  input.on('end', () => {
    closed = true;
  });
  input.on('error', (err) => {
    log(`MCP input error: ${err.message}`);
    closed = true;
  });

  return {
    server,
    feed,
    close() {
      closed = true;
    },
  };
}
