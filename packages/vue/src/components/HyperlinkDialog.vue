<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">{{ isEditing ? 'Edit Link' : 'Insert Link' }}</span>
        <button class="dialog__close" @click="close">✕</button>
      </div>
      <div class="dialog__body">
        <div class="field">
          <label class="field__label">URL</label>
          <input
            ref="urlInputRef"
            v-model="url"
            class="field__input"
            placeholder="https://example.com"
            @keydown.enter.prevent="submit"
          />
        </div>
        <div class="field">
          <label class="field__label">Display text</label>
          <input
            v-model="displayText"
            class="field__input"
            placeholder="Link text"
          />
        </div>
        <div class="field">
          <label class="field__label">Tooltip (optional)</label>
          <input
            v-model="tooltip"
            class="field__input"
            placeholder="Hover text"
          />
        </div>
        <div class="dialog__actions">
          <button v-if="isEditing" class="dialog__btn dialog__btn--danger" @mousedown.prevent="removeLink">Remove link</button>
          <div style="flex:1"></div>
          <button class="dialog__btn" @click="close">Cancel</button>
          <button class="dialog__btn dialog__btn--primary" @mousedown.prevent="submit" :disabled="!url.trim()">
            {{ isEditing ? 'Update' : 'Insert' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { EditorView } from 'prosemirror-view';

const props = defineProps<{
  isOpen: boolean;
  view: EditorView | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', data: { url: string; displayText: string; tooltip: string }): void;
  (e: 'remove'): void;
}>();

const urlInputRef = ref<HTMLInputElement | null>(null);
const url = ref('');
const displayText = ref('');
const tooltip = ref('');
const isEditing = ref(false);

watch(() => props.isOpen, async (open) => {
  if (open) {
    // Check if there's an existing hyperlink at cursor
    const v = props.view;
    if (v) {
      const { $from, empty, from, to } = v.state.selection;
      const marks = v.state.storedMarks || $from.marks();
      const linkMark = marks.find(m => m.type.name === 'hyperlink');

      if (linkMark) {
        url.value = linkMark.attrs.href || '';
        tooltip.value = linkMark.attrs.tooltip || '';
        isEditing.value = true;
      } else {
        url.value = '';
        tooltip.value = '';
        isEditing.value = false;
      }

      // Get selected text as display text
      if (!empty) {
        displayText.value = v.state.doc.textBetween(from, to);
      } else {
        displayText.value = '';
      }
    }

    await nextTick();
    urlInputRef.value?.focus();
  }
});

function close() { emit('close'); }

function submit() {
  if (!url.value.trim()) return;
  let href = url.value.trim();
  // Auto-add https:// if no protocol
  if (!/^(https?:\/\/|mailto:|tel:|ftp:)/i.test(href)) {
    href = 'https://' + href;
  }
  emit('submit', { url: href, displayText: displayText.value, tooltip: tooltip.value });
  close();
}

function removeLink() {
  emit('remove');
  close();
}
</script>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 300; display: flex; align-items: center; justify-content: center; }
.dialog { background: #fff; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); min-width: 400px; max-width: 90vw; }
.dialog__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.dialog__title { font-weight: 600; font-size: 14px; color: #1f2937; }
.dialog__close { border: none; background: transparent; cursor: pointer; font-size: 14px; color: #6b7280; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
.dialog__close:hover { background: #f3f4f6; }
.dialog__body { padding: 16px; }
.dialog__actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.dialog__btn { padding: 6px 16px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; font-size: 13px; background: #fff; }
.dialog__btn--primary { background: #3b82f6; color: #fff; border-color: #3b82f6; }
.dialog__btn--primary:hover { background: #2563eb; }
.dialog__btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.dialog__btn--danger { color: #dc2626; border-color: #fca5a5; }
.dialog__btn--danger:hover { background: #fef2f2; }

.field { margin-bottom: 12px; }
.field__label { display: block; font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 4px; }
.field__input { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; outline: none; box-sizing: border-box; }
.field__input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
</style>
