<!--
  AgentSuggestionChip — round-cornered button used to surface canned prompts
  inside the agent panel. Vue twin of the React component.
-->
<template>
  <button type="button" :style="chipStyle" :disabled="disabled" @click="emit('click')">
    {{ label }}
  </button>
</template>

<script setup lang="ts">
export interface AgentSuggestionChipProps {
  label: string;
  disabled?: boolean;
}

defineProps<AgentSuggestionChipProps>();
const emit = defineEmits<{ (e: 'click'): void }>();

const chipStyle = {
  textAlign: 'left' as const,
  background: '#fff',
  border: '1px solid #dadce0',
  borderRadius: '18px',
  padding: '10px 14px',
  fontSize: '13px',
  color: '#1f1f1f',
  cursor: 'pointer',
  fontFamily: "'Google Sans Text', system-ui, sans-serif",
  lineHeight: 1.4,
  transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
  width: '100%',
};
</script>
