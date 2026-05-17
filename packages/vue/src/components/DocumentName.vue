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
/* React: text-base (16px) font-normal text-slate-800 bg-transparent
   border-0 outline-none px-2 py-0 rounded hover:bg-slate-50
   focus:bg-white focus:ring-1 focus:ring-slate-300 min-w-[100px]
   max-w-[300px] truncate leading-tight */
.doc-name {
  display: inline-flex;
  align-items: center;
}
.doc-name__input,
.doc-name__text {
  font-size: 16px;
  font-weight: 400;
  color: #1e293b;
  background: transparent;
  border: 0;
  outline: none;
  border-radius: 4px;
  padding: 0 8px;
  line-height: 1.25;
  min-width: 100px;
  max-width: 300px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-name__input {
  height: 24px;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
.doc-name__input:hover {
  background: #f8fafc;
}
.doc-name__input:focus {
  background: #fff;
  box-shadow: 0 0 0 1px #cbd5e1;
}
</style>
