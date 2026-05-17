/**
 * Vue entry — components and composables that need Vue peer deps.
 *
 * Parity with the React adapter: same prop/event names where possible.
 * Where React passes `ReactNode` props (`icon`, `emptyState`, `footnote`),
 * the Vue components use idiomatic named slots — see each component's
 * JSDoc for the slot list. `AgentComposer` follows the standard Vue 3
 * v-model contract (`modelValue` / `update:modelValue`).
 *
 * Editor i18n: `<DocxEditor :i18n="..."` does NOT translate agent UI
 * strings — these components own their own English defaults from
 * `packages/agent-use/i18n/en.json`. Wire your `t()` results to the
 * `*Label` / `labels` props for translation:
 *
 * ```vue
 * <AgentPanel :title="t('agentPanel.defaultTitle')" :close-label="t('agentPanel.close')" />
 * ```
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue';
 * import {
 *   AgentPanel,
 *   AgentChatLog,
 *   AgentComposer,
 *   useAgentBridge,
 * } from '@eigenpal/docx-editor-agents/vue';
 *
 * const input = ref('');
 * const messages = ref([]);
 * const loading = ref(false);
 * const closed = ref(false);
 *
 * function send() {
 *   // ... post `input.value` to your transport, push reply onto messages
 * }
 * </script>
 *
 * <template>
 *   <AgentPanel :closed="closed" @close="closed = true">
 *     <AgentChatLog :messages="messages" :loading="loading" />
 *     <AgentComposer v-model="input" @submit="send" />
 *   </AgentPanel>
 * </template>
 * ```
 */

export { default as AgentPanel } from './vue/components/AgentPanel.vue';
export type { AgentPanelProps } from './vue/components/AgentPanel.vue';

export { default as AgentChatLog } from './vue/components/AgentChatLog.vue';
export type { AgentChatLogProps } from './vue/components/AgentChatLog.vue';

export { default as AgentComposer } from './vue/components/AgentComposer.vue';
export type { AgentComposerProps } from './vue/components/AgentComposer.vue';

export { default as AgentSuggestionChip } from './vue/components/AgentSuggestionChip.vue';
export type { AgentSuggestionChipProps } from './vue/components/AgentSuggestionChip.vue';

export { default as AgentTimeline } from './vue/components/AgentTimeline.vue';
export type { AgentTimelineProps } from './vue/components/AgentTimeline.vue';

export { default as AIContextMenu } from './vue/components/AIContextMenu.vue';
export type { AIContextMenuProps } from './vue/components/AIContextMenu.vue';

export { default as AIResponsePreview } from './vue/components/AIResponsePreview.vue';
export type { AIResponsePreviewProps } from './vue/components/AIResponsePreview.vue';

export type { AgentMessage, AgentToolCall } from './vue/types';

export { useAgentBridge } from './vue/composables/useAgentBridge';
export type { UseAgentBridgeOptions, UseAgentBridgeReturn } from './vue/composables/useAgentBridge';

export type { EditorRefLike } from './bridge';
export type { AgentToolDefinition, AgentToolResult } from './tools';
export { getToolDisplayName } from './tools';
