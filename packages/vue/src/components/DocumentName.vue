<template>
  <div class="doc-name">
    <input
      v-if="editable"
      class="doc-name__input"
      :value="displayName"
      @input="handleInput"
      @blur="handleBlur"
      placeholder="Untitled document"
    />
    <span v-else class="doc-name__text">{{ displayName || 'Untitled document' }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    editable?: boolean;
  }>(),
  { editable: true }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const displayName = computed(() => {
  const name = props.modelValue || '';
  return name.replace(/\.docx$/i, '');
});

function handleInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  emit('update:modelValue', raw.endsWith('.docx') ? raw : raw + '.docx');
}

function handleBlur(event: FocusEvent) {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (!raw) {
    emit('update:modelValue', 'Untitled document.docx');
  }
}
</script>

<style scoped>
.doc-name { display: inline-flex; align-items: center; }
.doc-name__input {
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  background: transparent;
  min-width: 120px;
  max-width: 300px;
  outline: none;
}
.doc-name__input:hover { border-color: #e5e7eb; }
.doc-name__input:focus { border-color: #3b82f6; background: #fff; }
.doc-name__text {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  padding: 4px 8px;
}
</style>
