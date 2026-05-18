<!--
  AgentComposer — pill input + send button (Vue twin of the React component).
  Standard Vue 3 v-model contract — `v-model="input"` binds the input value.
  Render a footer string via the `footnote` slot.
-->
<template>
  <form
    :class="['ep-agent-composer', className]"
    :style="S.composerWrap"
    @submit.prevent="handleSubmit"
  >
    <div :style="S.composerShell">
      <input
        :style="S.composerInput"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        @input="(e) => emit('update:modelValue', (e.target as HTMLInputElement).value)"
      />
      <button
        type="submit"
        :aria-label="sendLabel"
        :disabled="!canSend"
        :style="sendBtnStyle"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 19V5M5 12l7-7 7 7"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
    <div v-if="$slots.footnote" :style="S.footnote">
      <slot name="footnote" />
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import en from '../../../i18n/en.json';

export interface AgentComposerProps {
  modelValue: string;
  disabled?: boolean;
  placeholder?: string;
  sendLabel?: string;
  className?: string;
}

const props = withDefaults(defineProps<AgentComposerProps>(), {
  disabled: false,
  placeholder: () => en.agentPanel.composerPlaceholder,
  sendLabel: () => en.agentPanel.send,
  className: '',
});

const emit = defineEmits<{
  (e: 'update:modelValue', next: string): void;
  (e: 'submit'): void;
}>();

const canSend = computed(() => props.modelValue.trim().length > 0 && !props.disabled);

function handleSubmit() {
  if (!canSend.value) return;
  emit('submit');
}

const sendBtnStyle = computed(() => ({
  width: '36px',
  height: '36px',
  borderRadius: '50%',
  border: 'none',
  background: '#0b57d0',
  color: '#fff',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, opacity 0.15s, transform 0.15s',
  opacity: canSend.value ? 1 : 0.35,
  cursor: canSend.value ? 'pointer' : 'not-allowed',
}));

const S = {
  composerWrap: {
    padding: '8px 12px 14px',
    background: '#fff',
    flex: '0 0 auto',
  },
  composerShell: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 6px 6px 18px',
    background: '#fff',
    border: '1px solid #c4c7c5',
    borderRadius: '28px',
    boxShadow: '0 1px 2px rgba(60,64,67,0.04)',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
  },
  composerInput: {
    flex: 1,
    padding: '8px 0',
    fontSize: '14px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    color: '#1f1f1f',
  },
  footnote: {
    fontSize: '11px',
    color: '#5f6368',
    textAlign: 'center' as const,
    marginTop: '10px',
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
  },
} as const;
</script>
