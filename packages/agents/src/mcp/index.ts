/**
 * Model Context Protocol (MCP) server for the docx editor agent bridge.
 *
 * Two transports, same core:
 *   - stdio: classic MCP transport. Use `runStdioServer(bridge)` from a Node
 *     subprocess that Claude Desktop / Cursor / any MCP-aware client will
 *     spawn. Newline-delimited JSON-RPC.
 *   - direct: call `new McpServer(bridge).handle(message)` if you have your
 *     own transport (websocket, postMessage, http long-poll, etc.).
 *
 * The server is transport-agnostic and zero-dep. The stdio module reaches
 * for `process.stdin` / `process.stdout` only when you call `runStdioServer`
 * without explicit streams.
 */

export { McpServer, type McpServerOptions } from './server';
export { runStdioServer, type StdioServerOptions, type StdioServerHandle } from './stdio';
export {
  ErrorCode,
  encodeFrame,
  parseFrames,
  makeSuccess,
  makeError,
  isJsonRpcRequest,
  isJsonRpcNotification,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type JsonRpcResponse,
  type JsonRpcSuccess,
  type JsonRpcError,
  type JsonRpcMessage,
  type McpInitializeResult,
  type McpToolDescriptor,
  type McpToolsListResult,
  type McpToolsCallParams,
  type McpToolsCallResult,
  type McpContent,
} from './protocol';
