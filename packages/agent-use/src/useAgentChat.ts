/**
 * useAgentChat — React hook that wires agent tools to a live DocxEditor.
 *
 * @example
 * ```tsx
 * import { useAgentChat } from '@eigenpal/docx-editor-agents/bridge';
 *
 * const { executeToolCall, toolSchemas } = useAgentChat({ editorRef, author: 'Assistant' });
 *
 * // Pass toolSchemas to your AI provider, execute tool calls on the client
 * const result = executeToolCall('add_comment', { paragraphIndex: 3, text: 'Fix this.' });
 * ```
 */

import { useCallback, useMemo } from 'react';
import { createEditorBridge, type EditorRefLike } from './bridge';
import { executeToolCall as execTool, getToolSchemas } from './tools';
import type { AgentToolResult } from './tools';

/** Computed once — tool definitions are static. */
const TOOL_SCHEMAS = getToolSchemas();

export interface UseAgentChatOptions {
  /** Reference to the DocxEditor (must match EditorRefLike interface). */
  editorRef: React.RefObject<EditorRefLike | null>;
  /** Default author name for comments and changes. Default: 'AI' */
  author?: string;
}

export interface UseAgentChatReturn {
  /** Execute a tool call through the bridge. */
  executeToolCall: (toolName: string, input: Record<string, unknown>) => AgentToolResult;
  /** Tool schemas in OpenAI function calling format. Pass to your AI provider. */
  toolSchemas: ReturnType<typeof getToolSchemas>;
}

/**
 * Hook that creates an EditorBridge and provides tool execution.
 */
export function useAgentChat(options: UseAgentChatOptions): UseAgentChatReturn {
  const { editorRef, author = 'AI' } = options;

  // Bridge is created once per author change and reused across tool calls
  const bridgeRef = useMemo(() => {
    return {
      get: () => (editorRef.current ? createEditorBridge(editorRef.current, author) : null),
    };
  }, [editorRef, author]);

  const executeToolCall = useCallback(
    (toolName: string, input: Record<string, unknown>): AgentToolResult => {
      const bridge = bridgeRef.get();
      if (!bridge) return { success: false, error: 'Editor not ready' };
      return execTool(toolName, input, bridge);
    },
    [bridgeRef]
  );

  return {
    executeToolCall,
    toolSchemas: TOOL_SCHEMAS,
  };
}
