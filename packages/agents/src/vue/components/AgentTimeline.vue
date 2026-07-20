<!--
  AgentTimeline — collapsible list of an assistant turn's tool calls
  (Vue twin of the React AgentTimeline). Auto-collapses on done; click
  the summary row to re-expand.
-->
<template>
  <div v-if="toolCalls.length > 0" :style="S.timelineWrap" data-testid="agent-timeline">
    <button
      type="button"
      :aria-expanded="expanded"
      :style="S.timelineHeader"
      data-testid="agent-timeline-toggle"
      @click="userToggled = !expanded"
    >
      <span :style="S.timelineSummary">
        <span v-if="streaming" :style="spinnerStyle()" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#dadce0" stroke-width="3" fill="none" />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="#0b57d0"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <span v-else :style="{ marginRight: '6px', display: 'inline-flex' }" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="#1e8e3e"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        {{ summary }}
      </span>
      <span :style="chevronStyle" aria-hidden="true">▾</span>
    </button>
    <ol v-if="expanded" :style="S.timelineList">
      <li
        v-if="hiddenEarlier > 0"
        :style="S.timelineMore"
        data-testid="agent-timeline-earlier"
      >
        {{ resolvedEarlierLabel(hiddenEarlier) }}
      </li>
      <li v-for="call in visibleCalls" :key="call.id" :style="S.timelineItem">
        <span v-if="call.status === 'running'" :style="spinnerStyle(true)" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#dadce0" stroke-width="3" fill="none" />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="#0b57d0"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <span
          v-else
          :style="{
            ...S.timelineDot,
            background: call.status === 'error' ? '#d93025' : '#1e8e3e',
          }"
          aria-hidden="true"
        />
        <span :style="S.timelineCall">
          <span :style="S.timelineCallName">{{ humanize(call.name) }}</span>
          <span v-if="call.error" :style="S.timelineError">{{ call.error }}</span>
        </span>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import en from '../../../i18n/en.json';
import { formatMessage } from '../../i18n/format-message';
import { defaultHumanizeToolName, type AgentToolCall } from '../../agent-types';

export interface AgentTimelineProps {
  toolCalls: AgentToolCall[];
  streaming?: boolean;
  maxVisibleCalls?: number;
  humanizeName?: (name: string) => string;
  workingLabel?: (count: number) => string;
  summaryLabel?: (count: number) => string;
  earlierLabel?: (count: number) => string;
}

const props = withDefaults(defineProps<AgentTimelineProps>(), {
  streaming: false,
  maxVisibleCalls: 3,
  humanizeName: undefined,
  workingLabel: undefined,
  summaryLabel: undefined,
  earlierLabel: undefined,
});

const userToggled = ref<boolean | null>(null);
const expanded = computed(() => (userToggled.value !== null ? userToggled.value : !!props.streaming));

const humanize = (n: string) => (props.humanizeName ?? defaultHumanizeToolName)(n);

const resolvedEarlierLabel = (count: number) =>
  (props.earlierLabel ?? ((c: number) => formatMessage(en.agentPanel.timeline.earlier, { count: c })))(
    count
  );

const summary = computed(() => {
  const count = props.toolCalls.length;
  if (props.streaming) {
    return (
      props.workingLabel ?? ((c: number) => formatMessage(en.agentPanel.timeline.working, { count: c }))
    )(count);
  }
  return (
    props.summaryLabel ?? ((c: number) => formatMessage(en.agentPanel.timeline.summary, { count: c }))
  )(count);
});

const visibleCalls = computed(() => props.toolCalls.slice(-props.maxVisibleCalls));
const hiddenEarlier = computed(() => Math.max(0, props.toolCalls.length - visibleCalls.value.length));

const chevronStyle = computed(() => ({
  fontSize: '12px',
  color: '#5f6368',
  transition: 'transform 0.15s ease',
  marginLeft: '8px',
  display: 'inline-block',
  transform: expanded.value ? 'rotate(180deg)' : 'rotate(0deg)',
}));

function spinnerStyle(compact = false) {
  return {
    marginRight: compact ? 0 : '6px',
    display: 'inline-flex',
    animation: 'epAgentSpin 0.8s linear infinite',
    flexShrink: 0,
  };
}

const S = {
  timelineWrap: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    background: '#fff',
    border: '1px solid #e1e3e6',
    borderRadius: '12px',
    overflow: 'hidden',
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
  },
  timelineHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12.5px',
    color: '#1f1f1f',
    fontFamily: 'inherit',
  },
  timelineSummary: {
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: 500,
  },
  timelineList: {
    listStyle: 'none',
    margin: 0,
    padding: '4px 12px 10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    borderTop: '1px solid #ececf0',
  },
  timelineItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#444746',
  },
  timelineDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  timelineCall: {
    display: 'inline-flex',
    flexDirection: 'column' as const,
    minWidth: 0,
  },
  timelineCallName: {
    color: '#1f1f1f',
  },
  timelineError: {
    color: '#d93025',
    fontSize: '11px',
  },
  timelineMore: {
    fontSize: '11px',
    color: '#5f6368',
    fontStyle: 'italic',
    paddingLeft: '14px',
  },
} as const;
</script>
