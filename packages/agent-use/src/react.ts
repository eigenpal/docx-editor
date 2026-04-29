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
