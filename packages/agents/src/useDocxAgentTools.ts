/**
 * useDocxAgentTools — wires the toolkit to a live DocxEditor for BYO chat
 * frameworks.
 *
 * Returns three things consumers need to plug an agent into the editor:
 *
 *  - `tools` — schemas in OpenAI function-calling format. Pass to `streamText({ tools })`,
 *    OpenAI's `tools` field, Anthropic's `tools`, or any provider that accepts
 *    that shape.
 *  - `executeToolCall` — the executor. Hand to AI SDK's `onToolCall`, or call
 *    yourself when you wire up tool calls manually.
 *  - `getContext` — snapshot of `{selection, currentPage, paragraphCount}` for
 *    system-prompt injection. Pass through `prepareRequestBody` (AI SDK) or
 *    inline into your own request body so the agent always knows what the
 *    user is looking at without an extra tool round-trip.
 *
 * Custom tools merge with the built-ins via the `tools` option. Names collide
 * → consumer wins (your override replaces the built-in by name).
 *
 * @example
 * ```tsx
 * const { tools, executeToolCall, getContext } = useDocxAgentTools({
 *   editorRef,
 *   author: 'Assistant',
 *   tools: {
 *     fetch_clause: {
 *       name: 'fetch_clause',
 *       description: 'Fetch a clause template by name.',
 *       inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
 *       handler: async (input) => ({ success: true, data: await fetchTemplate(input.name) }),
 *     },
 *   },
 * });
 * ```
 */

import { useCallback, useMemo } from 'react';
import { createEditorBridge, type EditorRefLike } from './bridge';
import { agentTools, executeToolCall as execBuiltin, getToolSchemas } from './tools';
import type { AgentToolDefinition, AgentToolResult } from './tools';
import type { AgentContextSnapshot } from './types';

export type { AgentContextSnapshot };

export interface UseDocxAgentToolsOptions {
  /** Reference to the DocxEditor (must match EditorRefLike). */
  editorRef: React.RefObject<EditorRefLike | null>;
  /** Default author name for comments / tracked changes. Default: 'AI'. */
  author?: string;
  /**
   * Optional consumer-defined tools to merge with the built-ins. Keyed by
   * tool name. A tool with the same name as a built-in **replaces** it.
   * Pass a stable reference (memoized or module-level) to avoid rebuilding
   * the tool list on every render.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: Record<string, AgentToolDefinition<any>>;
  /**
   * Allow-list of built-in tool names to expose. When provided, only the
   * named tools are returned (custom tools from `tools` always pass).
   * Useful for read-only or scope-restricted agents:
   *
   * @example include: ['read_document', 'find_text', 'add_comment']
   */
  include?: readonly string[];
  /**
   * Block-list of built-in tool names to hide. Applied after `include`.
   * Use for agents that should not write tracked changes:
   *
   * @example exclude: ['suggest_change', 'apply_formatting', 'set_paragraph_style']
   */
  exclude?: readonly string[];
}

export interface UseDocxAgentToolsReturn {
  /** Tool schemas in OpenAI function calling format — pass to your AI provider. */
  tools: ReturnType<typeof getToolSchemas>;
  /** Execute a tool call by name. Pass to AI SDK's `onToolCall`. */
  executeToolCall: (name: string, args: Record<string, unknown>) => AgentToolResult;
  /** Snapshot of the user's current view for system-prompt injection. */
  getContext: () => AgentContextSnapshot;
}

export function useDocxAgentTools(options: UseDocxAgentToolsOptions): UseDocxAgentToolsReturn {
  const { editorRef, author = 'AI', tools: customTools, include, exclude } = options;
  const hasCustomTools = !!customTools && Object.keys(customTools).length > 0;

  // Allow-list / block-list filter for built-in tools. Custom tools are
  // never filtered — the consumer added them, they want them.
  const filterBuiltin = useCallback(
    (name: string) => {
      if (include && !include.includes(name)) return false;
      if (exclude && exclude.includes(name)) return false;
      return true;
    },
    [include, exclude]
  );

  const toolSchemas = useMemo(() => {
    const filteredBuiltins =
      include || exclude ? agentTools.filter((t) => filterBuiltin(t.name)) : agentTools;
    if (!hasCustomTools) {
      return filteredBuiltins.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }
    const merged = new Map<string, AgentToolDefinition<Record<string, unknown>>>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filteredBuiltins.map((t) => [t.name, t as AgentToolDefinition<any>])
    );
    for (const [name, def] of Object.entries(customTools!)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      merged.set(name, def as AgentToolDefinition<any>);
    }
    return Array.from(merged.values()).map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }, [customTools, hasCustomTools, include, exclude, filterBuiltin]);

  const executeToolCall = useCallback(
    (name: string, args: Record<string, unknown>): AgentToolResult => {
      const ref = editorRef.current;
      if (!ref) return { success: false, error: 'Editor not ready.' };
      const bridge = createEditorBridge(ref, author);

      // Custom tool? Run its handler directly.
      const custom = customTools?.[name];
      if (custom) {
        try {
          return custom.handler(args, bridge);
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
      // Built-in — refuse if the consumer filtered it out, so an LLM that
      // hallucinates a tool name can't bypass the allow/block lists.
      if (!filterBuiltin(name)) {
        return { success: false, error: `Tool '${name}' is not enabled.` };
      }
      return execBuiltin(name, args, bridge);
    },
    [editorRef, author, customTools, filterBuiltin]
  );

  const getContext = useCallback((): AgentContextSnapshot => {
    const ref = editorRef.current;
    if (!ref) return { selection: null, currentPage: 0, totalPages: 0 };
    const bridge = createEditorBridge(ref, author);
    return {
      selection: bridge.getSelection(),
      currentPage: bridge.getCurrentPage(),
      totalPages: bridge.getTotalPages(),
    };
  }, [editorRef, author]);

  return { tools: toolSchemas, executeToolCall, getContext };
}
