/**
 * Agent tool type definitions.
 */

import type { EditorBridge } from '../bridge';

/**
 * Definition of an agent tool — name, JSON-schema input, handler.
 * Use this to build custom tools alongside the built-in `agentTools`.
 *
 * @public
 */
export interface AgentToolDefinition<TInput = Record<string, unknown>> {
  /** Tool name (used in tool_use blocks) */
  name: string;
  /**
   * Friendly UI label for the tool. Shown in the agent panel's timeline
   * (e.g. "Reading document"). Falls back to a sentence-case version of
   * `name` if omitted, so consumer-defined tools render readably without
   * specifying this.
   */
  displayName?: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: Record<string, unknown>;
  /** Handler — receives parsed input + bridge, returns result */
  handler: (input: TInput, bridge: EditorBridge) => AgentToolResult;
}

/**
 * Result returned by a tool handler. `success: false` carries an `error`
 * message; `success: true` may carry tool-specific `data`.
 *
 * @public
 */
export interface AgentToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
