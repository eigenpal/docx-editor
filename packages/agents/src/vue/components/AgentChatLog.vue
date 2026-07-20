<!--
  AgentChatLog — message list renderer (Vue twin of the React component).
  Auto-scrolls to bottom on new messages and renders a tool-call timeline
  per assistant turn.
-->
<template>
  <div
    :class="['ep-agent-chat-log', className]"
    :style="rootStyle"
    role="log"
    aria-live="polite"
    aria-atomic="false"
  >
    <slot v-if="isEmpty" name="empty" />
    <template v-for="m in messages" :key="m.id">
      <div :style="S.messageGroup" :data-role="m.role">
        <AgentTimeline
          v-if="m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0"
          :tool-calls="m.toolCalls"
          :streaming="m.status === 'streaming'"
          :humanize-name="humanizeToolName"
          :max-visible-calls="maxVisibleCalls"
          :working-label="workingLabel"
          :summary-label="summaryLabel"
          :earlier-label="earlierLabel"
        />
        <div v-if="m.text.length > 0" :style="m.role === 'user' ? S.userBubble : S.assistantBubble">
          {{ m.text }}
        </div>
      </div>
    </template>
    <div v-if="loading" :style="S.thinkingBubble" :aria-label="thinkingLabel">
      <span :style="{ ...S.dot, animationDelay: '0s' }" />
      <span :style="{ ...S.dot, animationDelay: '0.15s' }" />
      <span :style="{ ...S.dot, animationDelay: '0.3s' }" />
    </div>
    <div v-if="error" :style="S.errorBubble" role="alert">{{ error }}</div>
    <div ref="endEl" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import en from '../../../i18n/en.json';
import AgentTimeline from './AgentTimeline.vue';
import type { AgentMessage } from '../../agent-types';

export interface AgentChatLogProps {
  messages: AgentMessage[];
  loading?: boolean;
  error?: string | null;
  thinkingLabel?: string;
  workingLabel?: (count: number) => string;
  summaryLabel?: (count: number) => string;
  earlierLabel?: (count: number) => string;
  autoScroll?: boolean;
  humanizeToolName?: (name: string) => string;
  maxVisibleCalls?: number;
  className?: string;
}

const props = withDefaults(defineProps<AgentChatLogProps>(), {
  loading: false,
  error: null,
  autoScroll: true,
  thinkingLabel: () => en.agentPanel.thinking,
  humanizeToolName: undefined,
  workingLabel: undefined,
  summaryLabel: undefined,
  earlierLabel: undefined,
  maxVisibleCalls: 3,
  className: '',
});

const endEl = ref<HTMLDivElement | null>(null);

const isEmpty = computed(
  () => props.messages.length === 0 && !props.loading && !props.error
);

function scrollToEnd() {
  if (!props.autoScroll) return;
  const lastMsg = props.messages[props.messages.length - 1];
  const isLastStreaming = lastMsg?.status === 'streaming';
  endEl.value?.scrollIntoView({
    behavior: isLastStreaming || props.loading ? 'auto' : 'smooth',
    block: 'end',
  });
}

onMounted(() => {
  nextTick(scrollToEnd);
  ensureKeyframes();
});

// `flush: 'post'` runs the watcher after the DOM is updated, so the new
// bubble is in the layout before scrollToEnd measures — drops the
// `nextTick` dance and matches AgentPanel.vue's close-transition watcher.
watch(
  [
    () => props.messages.length,
    () => props.messages[props.messages.length - 1]?.toolCalls?.length ?? 0,
    () => props.loading,
    () => props.messages[props.messages.length - 1]?.status === 'streaming',
  ],
  scrollToEnd,
  { flush: 'post' }
);

const KEYFRAMES_STYLE_ID = 'ep-agent-chat-keyframes';
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = KEYFRAMES_STYLE_ID;
  el.textContent = `
@keyframes epAgentDot {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}
@keyframes epAgentSpin {
  to { transform: rotate(360deg); }
}
`;
  document.head.appendChild(el);
}

const rootStyle = {
  flex: 1,
  overflow: 'auto',
  padding: '16px 14px 8px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '10px',
};

const S = {
  messageGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    width: '100%',
  },
  userBubble: {
    background: '#0b57d0',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '20px 20px 4px 20px',
    fontSize: '13.5px',
    lineHeight: 1.5,
    alignSelf: 'flex-end',
    maxWidth: '88%',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontFamily: "'Google Sans', 'Google Sans Text', system-ui, -apple-system, sans-serif",
  },
  assistantBubble: {
    background: '#f0f4f9',
    color: '#1f1f1f',
    padding: '12px 16px',
    borderRadius: '20px 20px 20px 4px',
    fontSize: '13.5px',
    lineHeight: 1.55,
    alignSelf: 'flex-start',
    maxWidth: '92%',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontFamily: "'Google Sans', 'Google Sans Text', system-ui, -apple-system, sans-serif",
  },
  thinkingBubble: {
    background: '#f0f4f9',
    padding: '12px 16px',
    borderRadius: '20px 20px 20px 4px',
    alignSelf: 'flex-start',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#5f6368',
    display: 'inline-block',
    animation: 'epAgentDot 1.4s infinite ease-in-out',
  },
  errorBubble: {
    background: '#fce8e6',
    color: '#b3261e',
    padding: '10px 14px',
    borderRadius: '16px',
    fontSize: '12.5px',
    alignSelf: 'flex-start',
    maxWidth: '92%',
    whiteSpace: 'pre-wrap' as const,
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
  },
} as const;
</script>
