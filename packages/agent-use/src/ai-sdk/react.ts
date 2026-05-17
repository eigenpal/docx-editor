/**
 * Vercel AI SDK adapter (React side) — opt-in.
 *
 * Use this if you're driving the chat with `useChat` from
 * `@ai-sdk/react`. The library's `<AgentChatLog>` consumes a flat
 * `AgentMessage[]` shape; AI SDK's `useChat` produces `UIMessage[]`
 * with structured `parts`. `toAgentMessages()` is the bridge.
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
 */

export type { AgentMessage, AgentToolCall } from '../agent-types';
export { toAgentMessages, type AiSdkUIMessage } from './shared';
