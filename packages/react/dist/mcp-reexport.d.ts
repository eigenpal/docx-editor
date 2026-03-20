import { M as McpToolDefinition, e as McpSession, J as JsonSchema } from './types-igZ1x_e4.js';
import './agentApi-BVHzyk2l.js';

/**
 * Core MCP Tools
 *
 * Built-in MCP tools for document operations that are always available.
 * These provide basic document manipulation without requiring plugins.
 */

/**
 * Load a DOCX document from base64
 */
declare const loadDocumentTool: McpToolDefinition;
/**
 * Save a document to base64
 */
declare const saveDocumentTool: McpToolDefinition;
/**
 * Close a document
 */
declare const closeDocumentTool: McpToolDefinition;
/**
 * Get document information
 */
declare const getDocumentInfoTool: McpToolDefinition;
/**
 * Get document plain text
 */
declare const getDocumentTextTool: McpToolDefinition;
/**
 * Insert text at a position
 */
declare const insertTextTool: McpToolDefinition;
/**
 * Replace text in a range
 */
declare const replaceTextTool: McpToolDefinition;
/**
 * Delete text in a range
 */
declare const deleteTextTool: McpToolDefinition;
/**
 * Apply text formatting
 */
declare const formatTextTool: McpToolDefinition;
/**
 * Apply paragraph style
 */
declare const applyStyleTool: McpToolDefinition;
declare const coreMcpTools: McpToolDefinition[];

/**
 * MCP Server
 *
 * Model Context Protocol server that exposes document editing tools to AI clients.
 * Discovers and registers tools from the plugin system plus core built-in tools.
 *
 * @example
 * ```ts
 * import { createMcpServer, startStdioServer } from '@eigenpal/docx-editor/mcp';
 * import { pluginRegistry, docxtemplaterPlugin } from '@eigenpal/docx-editor/core-plugins';
 *
 * // Register plugins
 * pluginRegistry.register(docxtemplaterPlugin);
 *
 * // Start MCP server
 * startStdioServer();
 * ```
 */

/**
 * MCP Server configuration
 */
interface McpServerConfig {
  /** Server name */
  name?: string;
  /** Server version */
  version?: string;
  /** Include core tools (default: true) */
  includeCoreTools?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom tools to add */
  additionalTools?: McpToolDefinition[];
}
/**
 * MCP Server instance
 */
interface McpServer {
  /** All registered tools */
  tools: Map<string, McpToolDefinition>;
  /** Active session */
  session: McpSession;
  /** Handle a tool call */
  handleToolCall(toolName: string, input: unknown): Promise<unknown>;
  /** List available tools */
  listTools(): McpToolInfo[];
  /** Get server info */
  getInfo(): {
    name: string;
    version: string;
    toolCount: number;
  };
}
/**
 * Tool info for listing
 */
interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  category?: string;
}
/**
 * Create an MCP server instance
 *
 * @param config - Server configuration
 * @returns MCP server instance
 */
declare function createMcpServer(config?: McpServerConfig): McpServer;
/**
 * JSON-RPC request
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}
/**
 * JSON-RPC response
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
/**
 * Handle a JSON-RPC request
 */
declare function handleJsonRpcRequest(
  server: McpServer,
  request: JsonRpcRequest
): Promise<JsonRpcResponse>;
/**
 * Start the MCP server with stdio transport
 *
 * Reads JSON-RPC requests from stdin, writes responses to stdout.
 * This is the standard way to run an MCP server for Claude Desktop.
 */
declare function startStdioServer(config?: McpServerConfig): Promise<void>;

export {
  type McpServer,
  type McpServerConfig,
  type McpToolInfo,
  applyStyleTool,
  closeDocumentTool,
  coreMcpTools,
  createMcpServer,
  deleteTextTool,
  formatTextTool,
  getDocumentInfoTool,
  getDocumentTextTool,
  handleJsonRpcRequest,
  insertTextTool,
  loadDocumentTool,
  replaceTextTool,
  saveDocumentTool,
  startStdioServer,
};
