/**
 * MCP wire protocol (subset) — JSON-RPC 2.0 framing + the message types we
 * actually implement. Zero dependencies. Pure functions; everything is unit-
 * testable without a transport.
 *
 * This is NOT a full MCP SDK. We implement only what the server needs:
 *   - initialize / initialized
 *   - tools/list
 *   - tools/call
 *   - notifications/cancelled (no-op, accepted)
 *
 * Spec reference: https://spec.modelcontextprotocol.io
 */

// ── JSON-RPC 2.0 ──────────────────────────────────────────────────────────

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Standard JSON-RPC error codes. We only ever emit JSON-RPC errors for
 * protocol-level problems; tool execution failures use MCP's `isError`
 * envelope inside a successful response, per spec. */
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// ── MCP message shapes ─────────────────────────────────────────────────────

export interface McpInitializeParams {
  protocolVersion: string;
  capabilities?: Record<string, unknown>;
  clientInfo?: { name: string; version?: string };
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: { tools?: Record<string, unknown> };
  serverInfo: { name: string; version: string };
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolsListResult {
  tools: McpToolDescriptor[];
}

export interface McpToolsCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpContent {
  type: 'text';
  text: string;
}

export interface McpToolsCallResult {
  content: McpContent[];
  isError?: boolean;
}

// ── Type guards ────────────────────────────────────────────────────────────

export function isJsonRpcRequest(m: unknown): m is JsonRpcRequest {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as Record<string, unknown>).jsonrpc === '2.0' &&
    typeof (m as Record<string, unknown>).method === 'string' &&
    'id' in m
  );
}

export function isJsonRpcNotification(m: unknown): m is JsonRpcNotification {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as Record<string, unknown>).jsonrpc === '2.0' &&
    typeof (m as Record<string, unknown>).method === 'string' &&
    !('id' in m)
  );
}

// ── Encoders ───────────────────────────────────────────────────────────────

export function makeSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function makeError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

// ── Frame parsing (newline-delimited JSON) ─────────────────────────────────

export interface ParseResult {
  /** Parsed messages. */
  messages: JsonRpcMessage[];
  /** Lines that failed to parse — caller should send a ParseError per line if it had a discernible id. */
  parseErrors: string[];
  /** Remaining buffer (no trailing newline yet). */
  rest: string;
}

/**
 * Parse newline-delimited JSON-RPC frames out of a buffer. Returns parsed
 * messages plus any leftover bytes. Tolerates blank lines.
 */
export function parseFrames(buffer: string): ParseResult {
  const messages: JsonRpcMessage[] = [];
  const parseErrors: string[] = [];

  // Split on '\n'. The last element is the trailing partial; everything before
  // it is a complete line (possibly empty).
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';

  for (const raw of parts) {
    const line = raw.trim();
    if (!line) continue;
    try {
      messages.push(JSON.parse(line) as JsonRpcMessage);
    } catch {
      parseErrors.push(line);
    }
  }
  return { messages, parseErrors, rest };
}

/** Encode a JSON-RPC message as a single newline-terminated frame. */
export function encodeFrame(message: JsonRpcMessage): string {
  return JSON.stringify(message) + '\n';
}
