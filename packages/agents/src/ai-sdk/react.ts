/**
 * @eigenpal/docx-editor-agents/ai-sdk/react
 *
 * Vercel AI SDK adapter (React side). Opt-in.
 *
 * Use this if you're driving the chat with `useChat` from `@ai-sdk/react`.
 * The library's `<AgentChatLog>` consumes a flat `AgentMessage[]` shape;
 * AI SDK's `useChat` produces `UIMessage[]` with structured `parts`.
 * `toAgentMessages()` is the bridge.
 *
 * @example
 * ```tsx
 * const chat = useChat({ ... });
 * const messages = useMemo(
 *   () => toAgentMessages(chat.messages, chat.status),
 *   [chat.messages, chat.status]
 * );
 * return <AgentChatLog messages={messages} />;
 * ```
 *
 * @packageDocumentation
 * @public
 */

export type { AgentMessage, AgentToolCall } from '../agent-types';
export { toAgentMessages, type AiSdkUIMessage } from './shared';
