/**
 * useAgentBridge — Vue composable that wires agent tools to a live
 * DocxEditor. Vue twin of the React `useAgentChat` hook.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue';
 * import { useAgentBridge } from '@eigenpal/docx-editor-agents/vue';
 * import type { EditorRefLike } from '@eigenpal/docx-editor-agents/vue';
 *
 * const editorRef = ref<EditorRefLike | null>(null);
 * const { executeToolCall, toolSchemas } = useAgentBridge({
 *   editorRef,
 *   author: 'Assistant',
 * });
 * </script>
 * ```
 */

import { computed, unref, type MaybeRef, type Ref } from 'vue';
import { createEditorBridge, type EditorRefLike } from '../../bridge';
import { executeToolCall as execTool, getToolSchemas } from '../../tools';
import type { AgentToolResult } from '../../tools';

const TOOL_SCHEMAS = getToolSchemas();

export interface UseAgentBridgeOptions {
  /** Vue ref pointing at the DocxEditor instance (must match `EditorRefLike`). */
  editorRef: Ref<EditorRefLike | null | undefined>;
  /**
   * Default author for comments and tracked changes. Accepts a plain
   * string or a `Ref<string>`/computed — bridge rebuilds when the value
   * changes (matches React's `useMemo([editorRef, author])` shape).
   * Defaults to `'AI'`.
   */
  author?: MaybeRef<string>;
}

export interface UseAgentBridgeReturn {
  executeToolCall: (toolName: string, input: Record<string, unknown>) => AgentToolResult;
  toolSchemas: ReturnType<typeof getToolSchemas>;
}

export function useAgentBridge(options: UseAgentBridgeOptions): UseAgentBridgeReturn {
  const { editorRef, author = 'AI' } = options;

  // computed re-runs when editorRef.value or unref(author) changes — same
  // semantics as React's useMemo([editorRef, author]).
  const bridge = computed(() =>
    editorRef.value ? createEditorBridge(editorRef.value, unref(author)) : null
  );

  function executeToolCall(toolName: string, input: Record<string, unknown>): AgentToolResult {
    const b = bridge.value;
    if (!b) return { success: false, error: 'Editor not ready' };
    return execTool(toolName, input, b);
  }

  return {
    executeToolCall,
    toolSchemas: TOOL_SCHEMAS,
  };
}
