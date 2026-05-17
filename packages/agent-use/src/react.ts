/**
 * React entry — hooks and types that need React peer deps.
 *
 * @example
 * ```tsx
 * import { useDocxAgentTools } from '@eigenpal/docx-editor-agents/react';
 *
 * const { tools, executeToolCall, getContext } = useDocxAgentTools({
 *   editorRef,
 *   author: 'Assistant',
 * });
 * ```
 */

export { useAgentChat } from './useAgentChat';
export type { UseAgentChatOptions, UseAgentChatReturn } from './useAgentChat';

export { useDocxAgentTools } from './useDocxAgentTools';
export type {
  UseDocxAgentToolsOptions,
  UseDocxAgentToolsReturn,
  AgentContextSnapshot,
} from './useDocxAgentTools';

export type { AgentToolDefinition, AgentToolResult } from './tools';
export { getToolDisplayName } from './tools';
export type { EditorRefLike } from './bridge';

// UI components — migrated from @eigenpal/docx-editor-react in 1.0
// (canonical home is now agent-use; React adapter still re-exports them
// with @deprecated for one minor and removes in the same train).
export { AgentPanel } from './react/components/AgentPanel';
export type { AgentPanelProps } from './react/components/AgentPanel';
export {
  AgentChatLog,
  AgentComposer,
  AgentSuggestionChip,
  AgentTimeline,
} from './react/components/AgentChat';
export type {
  AgentChatLogProps,
  AgentComposerProps,
  AgentSuggestionChipProps,
  AgentTimelineProps,
  AgentMessage,
  AgentToolCall,
} from './react/components/AgentChat';
