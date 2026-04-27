/**
 * Agent tool type definitions.
 */

import type { EditorBridge } from '../bridge';

export interface AgentToolDefinition<TInput = Record<string, unknown>> {
  /** Tool name (used in tool_use blocks) */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: Record<string, unknown>;
  /** Handler — receives parsed input + bridge, returns result */
  handler: (input: TInput, bridge: EditorBridge) => AgentToolResult;
}

export interface AgentToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
