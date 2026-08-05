/**
 * `@docx-editor.dev/core/contracts/mcp` — the MCP tool registry shape.
 *
 * A runtime registry rather than a compile-time union, because `tools/list` needs real JSON
 * Schemas and real LLM-facing prose at runtime. Contract only: the implementations live in a
 * host.
 *
 * Kept as a registry rather than folded into the command union because the
 * product here is the runtime JSON Schema plus the LLM-facing prose per tool.
 * A TypeScript union produces neither: it vanishes at compile time, and
 * `tools/list` needs real schemas and real descriptions at runtime.
 *
 * CONTRACT ONLY — declarations, not an implementation.
 *
 * @packageDocumentation
 * @public
 */

import type { JSONSchema } from './types';

const NOT_IMPLEMENTED = 'contract-only stub: no implementation';

/**
 * One MCP tool: what an LLM sees in `tools/list`, and what runs when it is called.
 *
 * A runtime record rather than a TypeScript union member, because `tools/list` needs a real
 * JSON Schema and real prose at runtime — both of which a compile-time union erases.
 */
export interface McpToolDefinition {
  readonly name: string;
  readonly displayName?: string;
  /** LLM-facing prose. This is the part that makes the tool usable. */
  readonly description: string;
  /** Validated against the caller's arguments before {@link McpToolDefinition.handler} runs. */
  readonly inputSchema: JSONSchema;
  readonly handler: (args: unknown, context: McpContext) => Promise<unknown>;
}

/**
 * Ambient state a tool call runs against.
 *
 * Open-ended by design: a host attaches whatever its own tools need, and `author` is named
 * explicitly only because the built-in comment and revision tools all require one.
 */
export interface McpContext {
  readonly author?: string;
  readonly [key: string]: unknown;
}

/**
 * The tools this package defines.
 *
 * CONTRACT ONLY — declared, not implemented here. A host supplies the registry.
 */
export declare const coreTools: readonly McpToolDefinition[];

/**
 * Dispatch one `tools/call` by name.
 *
 * CONTRACT ONLY — this stub always throws. It exists so hosts and adapters can type against the
 * dispatch signature before an implementation is wired in.
 *
 * @throws Always, in this contract-only module.
 */
export function executeToolCall(
  _name: string,
  _args: unknown,
  _context: McpContext
): Promise<unknown> {
  throw new Error(NOT_IMPLEMENTED);
}
