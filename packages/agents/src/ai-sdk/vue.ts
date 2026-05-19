/**
 * @eigenpal/docx-editor-agents/ai-sdk/vue
 *
 * Vercel AI SDK adapter (Vue side). Opt-in.
 *
 * Use this if you're driving the chat with `useChat` from `@ai-sdk/vue`.
 * The Vue `<AgentChatLog>` consumes a flat `AgentMessage[]` shape;
 * AI SDK's `useChat` produces `UIMessage[]` with structured `parts`.
 * `toAgentMessages()` is the bridge.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { computed } from 'vue';
 * import { useChat } from '@ai-sdk/vue';
 * import { toAgentMessages } from '@eigenpal/docx-editor-agents/ai-sdk/vue';
 * import { AgentChatLog } from '@eigenpal/docx-editor-agents/vue';
 *
 * const chat = useChat({ ... });
 * const messages = computed(() => toAgentMessages(chat.messages.value, chat.status.value));
 * </script>
 *
 * <template>
 *   <AgentChatLog :messages="messages" />
 * </template>
 * ```
 *
 * @packageDocumentation
 * @public
 */

export type { AgentMessage, AgentToolCall } from '../agent-types';
export { toAgentMessages, type AiSdkUIMessage } from './shared';
