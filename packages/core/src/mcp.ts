/**
 * `@docx-editor.dev/core/mcp` — MCP tool registry.
 *
 * Kept as a registry rather than folded into the command union because the
 * product here is the runtime JSON Schema plus the LLM-facing prose per tool.
 * A TypeScript union produces neither: it vanishes at compile time, and
 * `tools/list` needs real schemas and real descriptions at runtime.
 *
 * CONTRACT ONLY.
 */

import type { JSONSchema } from './types';

const NOT_IMPLEMENTED = 'contract-only stub: no implementation';

export interface McpToolDefinition {
  readonly name: string;
  readonly displayName?: string;
  /** LLM-facing prose. This is the part that makes the tool usable. */
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly handler: (args: unknown, context: McpContext) => Promise<unknown>;
}

export interface McpContext {
  readonly author?: string;
  readonly [key: string]: unknown;
}

export declare const coreTools: readonly McpToolDefinition[];

export function executeToolCall(
  _name: string,
  _args: unknown,
  _context: McpContext
): Promise<unknown> {
  throw new Error(NOT_IMPLEMENTED);
}
