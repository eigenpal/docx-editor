<template>
  <div v-if="open" class="citation-dialog-backdrop" @mousedown.self="emit('close')">
    <form class="citation-dialog" @submit.prevent="submit">
      <h2>{{ editing ? 'Edit citation' : 'Insert citation' }}</h2>
      <label>
        Source ID
        <input v-model="form.sourceId" required />
      </label>
      <label>
        Authors (comma-separated)
        <input v-model="authorsText" required />
      </label>
      <label>
        Year
        <input v-model.number="form.year" type="number" min="0" max="3000" required />
      </label>
      <label>
        Locator
        <input v-model="form.locator" />
      </label>
      <div class="actions">
        <button type="button" :style="DEMO_SECONDARY_BUTTON" @mousedown="keepCaret" @click="emit('close')">
          Cancel
        </button>
        <button type="submit" :style="DEMO_PRIMARY_BUTTON" @mousedown="keepCaret">
          {{ editing ? 'Save' : 'Insert' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useDocxEditor } from '@docx-editor.dev/vue';
import { insertCustomNode, updateCustomNode } from '@docx-editor.dev/pro';
import { DEMO_CITATION, DEMO_CITATION_DEFAULTS, type CitationFormState } from './demoCitation';
import { DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON, keepCaret } from './demoButtons';

const props = defineProps<{
  form: CitationFormState | null;
}>();

const emit = defineEmits<{ close: [] }>();

const editor = useDocxEditor();
const open = computed(() => props.form !== null);
const editing = computed(() => props.form?.mode === 'edit');
const form = reactive({ ...DEMO_CITATION_DEFAULTS });
const authorsText = computed({
  get: () => form.authors.join(', '),
  set: (value: string) => {
    form.authors = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  },
});

watch(
  () => props.form,
  (next) => {
    if (!next) return;
    const current = next.mode === 'edit' ? DEMO_CITATION.dataOf(next) : undefined;
    Object.assign(form, current ?? DEMO_CITATION_DEFAULTS);
  }
);

function submit(): void {
  const instance = editor.value;
  const state = props.form;
  if (!instance || !state) {
    emit('close');
    return;
  }
  const result =
    state.mode === 'edit'
      ? updateCustomNode(instance, DEMO_CITATION, state.nodeId, { data: { ...form } })
      : insertCustomNode(instance, DEMO_CITATION, {
          ...(state.at ? { at: state.at } : {}),
          data: { ...form },
        });
  void Promise.resolve(result).then((outcome) => {
    if (!outcome.ok) {
      window.alert(`${state.mode === 'edit' ? 'Edit' : 'Insert'} refused: ${outcome.reason}`);
    }
    emit('close');
  });
}
</script>

<style scoped>
.citation-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(15 23 42 / 35%);
}
.citation-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 320px;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--doc-border);
  background: var(--doc-surface);
  color: var(--doc-text);
  box-shadow: var(--doc-shadow-lg);
}
.citation-dialog h2 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
}
.citation-dialog label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--doc-text-muted);
}
.citation-dialog input {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid var(--doc-border);
  border-radius: 6px;
  background: var(--doc-surface);
  color: var(--doc-text);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
</style>
