/**
 * MCP server core. Transport-agnostic — accepts a JsonRpcRequest, returns
 * either a JsonRpcResponse or `null` (for notifications, which never reply).
 *
 * Wraps an EditorBridge: tools/list returns the bridge's tool schemas in MCP
 * shape; tools/call dispatches via executeToolCall and converts the
 * AgentToolResult into MCP CallToolResult content.
 */

import type { EditorBridge } from '../bridge';
import { agentTools, executeToolCall } from '../tools';
import {
  ErrorCode,
  isJsonRpcRequest,
  makeError,
  makeSuccess,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcMessage,
  type McpInitializeResult,
  type McpToolsListResult,
  type McpToolsCallParams,
  type McpToolsCallResult,
} from './protocol';

export interface McpServerOptions {
  /** Server name reported in `initialize` response. Default: `@eigenpal/docx-editor-agents`. */
  name?: string;
  /** Server version. Default: `0.0.0` (override at build time). */
  version?: string;
  /** MCP protocol version we claim to speak. Default: `2025-06-18`. */
  protocolVersion?: string;
}

// Latest stable spec at time of writing (https://spec.modelcontextprotocol.io).
// We claim 2025-06-18 because our wire shape — initialize / tools/list /
// tools/call with text-only content + isError envelope — is compatible.
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

export class McpServer {
  private readonly bridge: EditorBridge;
  private readonly opts: Required<McpServerOptions>;

  constructor(bridge: EditorBridge, options: McpServerOptions = {}) {
    this.bridge = bridge;
    this.opts = {
      name: options.name ?? '@eigenpal/docx-editor-agents',
      version: options.version ?? '0.0.0',
      protocolVersion: options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
    };
  }

  /**
   * Handle one inbound message. Returns the response to send back, or `null`
   * for notifications and other no-reply messages. Never throws.
   */
  handle(message: JsonRpcMessage): JsonRpcResponse | null {
    if (!isJsonRpcRequest(message)) return null; // notifications + responses ignored

    const req = message;
    try {
      switch (req.method) {
        case 'initialize':
          return makeSuccess(req.id, this.handleInitialize());
        case 'tools/list':
          return makeSuccess(req.id, this.handleToolsList());
        case 'tools/call':
          return this.handleToolsCall(req);
        case 'ping':
          return makeSuccess(req.id, {});
        default:
          return makeError(req.id, ErrorCode.MethodNotFound, `Method not found: ${req.method}`);
      }
    } catch (e) {
      return makeError(req.id, ErrorCode.InternalError, e instanceof Error ? e.message : String(e));
    }
  }

  private handleInitialize(): McpInitializeResult {
    // We reply with our preferred protocolVersion. Clients that pin a
    // specific version SHOULD validate this and fail at their SDK layer
    // if incompatible; in practice every MCP SDK accepts a version reply
    // newer-or-equal to its requested version.
    return {
      protocolVersion: this.opts.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: this.opts.name, version: this.opts.version },
    };
  }

  private handleToolsList(): McpToolsListResult {
    return {
      tools: agentTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  }

  private handleToolsCall(req: JsonRpcRequest): JsonRpcResponse {
    const params = req.params as Partial<McpToolsCallParams> | undefined;
    if (!params || typeof params.name !== 'string') {
      return makeError(req.id, ErrorCode.InvalidParams, 'tools/call requires a "name" string');
    }
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const result = executeToolCall(params.name, args, this.bridge);

    // MCP convention: tool errors come back as a successful JSON-RPC response
    // with `isError: true` in the content payload. Reserve JSON-RPC errors for
    // protocol-level problems.
    const callResult: McpToolsCallResult = result.success
      ? {
          content: [
            {
              type: 'text',
              text:
                typeof result.data === 'string'
                  ? result.data
                  : JSON.stringify(result.data, null, 2),
            },
          ],
        }
      : {
          isError: true,
          content: [{ type: 'text', text: result.error ?? 'Unknown tool error' }],
        };
    return makeSuccess(req.id, callResult);
  }
}
