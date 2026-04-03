<template>
  <div v-if="isOpen" class="psd-overlay" @mousedown.self="$emit('close')">
    <div class="psd-dialog" @keydown.escape="$emit('close')" @keydown.enter="apply">
      <div class="psd-dialog__header">Paste Special</div>

      <div class="psd-dialog__body">
        <div class="psd-preview" v-if="clipboardPreview">
          <span class="psd-preview__label">Clipboard content:</span>
          <span class="psd-preview__text">{{ clipboardPreview }}</span>
        </div>

        <div class="psd-options">
          <label class="psd-option" :class="{ 'psd-option--selected': pasteMode === 'formatted' }">
            <input type="radio" v-model="pasteMode" value="formatted" />
            <div class="psd-option__info">
              <span class="psd-option__name">Formatted text</span>
              <span class="psd-option__desc">Keep original formatting from source</span>
            </div>
          </label>
          <label class="psd-option" :class="{ 'psd-option--selected': pasteMode === 'plain' }">
            <input type="radio" v-model="pasteMode" value="plain" />
            <div class="psd-option__info">
              <span class="psd-option__name">Plain text</span>
              <span class="psd-option__desc">Strip all formatting</span>
            </div>
          </label>
        </div>
      </div>

      <div class="psd-dialog__footer">
        <button class="psd-btn" @click="$emit('close')">Cancel</button>
        <button class="psd-btn psd-btn--primary" @click="apply">Paste</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'paste', mode: 'formatted' | 'plain'): void;
}>();

const pasteMode = ref<'formatted' | 'plain'>('formatted');
const clipboardPreview = ref('');

watch(() => props.isOpen, async (open) => {
  if (!open) return;
  pasteMode.value = 'formatted';
  try {
    const text = await navigator.clipboard.readText();
    clipboardPreview.value = text.length > 80 ? text.slice(0, 80) + '...' : text;
  } catch {
    clipboardPreview.value = '';
  }
});

function apply() {
  emit('paste', pasteMode.value);
  emit('close');
}
</script>

<style scoped>
.psd-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 10000; }
.psd-dialog { background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); width: 380px; max-width: 90vw; }
.psd-dialog__header { padding: 16px 20px 12px; border-bottom: 1px solid #e5e7eb; font-size: 16px; font-weight: 600; color: #1f2937; }
.psd-dialog__body { padding: 16px 20px; }
.psd-dialog__footer { padding: 12px 20px 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 8px; }
.psd-preview { padding: 8px 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; margin-bottom: 12px; }
.psd-preview__label { display: block; font-size: 11px; color: #9ca3af; margin-bottom: 4px; }
.psd-preview__text { font-size: 12px; color: #374151; font-family: ui-monospace, monospace; word-break: break-all; }
.psd-options { display: flex; flex-direction: column; gap: 6px; }
.psd-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 2px solid #e5e7eb;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.psd-option:hover { border-color: #d1d5db; }
.psd-option--selected { border-color: #3b82f6; background: #eff6ff; }
.psd-option input { margin-top: 2px; }
.psd-option__info { display: flex; flex-direction: column; }
.psd-option__name { font-size: 13px; font-weight: 500; color: #1f2937; }
.psd-option__desc { font-size: 11px; color: #9ca3af; }
.psd-btn { padding: 6px 16px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; background: #fff; }
.psd-btn--primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
</style>
