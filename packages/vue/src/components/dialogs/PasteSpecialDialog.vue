<template>
  <div v-if="isOpen" class="psd-overlay" @mousedown.self="$emit('close')">
    <div class="psd-dialog" @keydown.escape="$emit('close')" @keydown.enter="apply">
      <div class="psd-dialog__header">{{ t('dialogs.pasteSpecial.title') }}</div>

      <div class="psd-dialog__body">
        <div class="psd-preview" v-if="clipboardPreview">
          <span class="psd-preview__label">{{ t('dialogs.pasteSpecial.preview') }}</span>
          <span class="psd-preview__text">{{ clipboardPreview }}</span>
        </div>

        <div class="psd-options">
          <label class="psd-option" :class="{ 'psd-option--selected': pasteMode === 'formatted' }">
            <input type="radio" v-model="pasteMode" value="formatted" />
            <div class="psd-option__info">
              <span class="psd-option__name">{{ t('dialogs.pasteSpecial.keepFormatting') }}</span>
              <span class="psd-option__desc">{{
                t('dialogs.pasteSpecial.keepFormattingDescription')
              }}</span>
            </div>
          </label>
          <label class="psd-option" :class="{ 'psd-option--selected': pasteMode === 'plain' }">
            <input type="radio" v-model="pasteMode" value="plain" />
            <div class="psd-option__info">
              <span class="psd-option__name">{{ t('dialogs.pasteSpecial.plainText') }}</span>
              <span class="psd-option__desc">{{
                t('dialogs.pasteSpecial.plainTextDescription')
              }}</span>
            </div>
          </label>
        </div>
      </div>

      <div class="psd-dialog__footer">
        <button class="psd-btn" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="psd-btn psd-btn--primary" @click="apply">
          {{ t('contextMenu.paste') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useTranslation } from '../../i18n';

const { t } = useTranslation();

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'paste', mode: 'formatted' | 'plain'): void;
}>();

const pasteMode = ref<'formatted' | 'plain'>('formatted');
const clipboardPreview = ref('');

watch(
  () => props.isOpen,
  async (open) => {
    if (!open) return;
    pasteMode.value = 'formatted';
    try {
      const text = await navigator.clipboard.readText();
      clipboardPreview.value = text.length > 80 ? text.slice(0, 80) + '...' : text;
    } catch {
      clipboardPreview.value = '';
    }
  }
);

function apply() {
  emit('paste', pasteMode.value);
  emit('close');
}
</script>

<style scoped>
.psd-overlay {
  position: fixed;
  inset: 0;
  background: var(--doc-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.psd-dialog {
  background: var(--doc-surface);
  border-radius: 8px;
  box-shadow: 0 4px 20px var(--doc-shadow);
  width: 380px;
  max-width: 90vw;
}
.psd-dialog__header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--doc-border);
  font-size: 16px;
  font-weight: 600;
  color: var(--doc-text);
}
.psd-dialog__body {
  padding: 16px 20px;
}
.psd-dialog__footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--doc-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.psd-preview {
  padding: 8px 10px;
  background: var(--doc-bg);
  border: 1px solid var(--doc-border);
  border-radius: 4px;
  margin-bottom: 12px;
}
.psd-preview__label {
  display: block;
  font-size: 11px;
  color: var(--doc-text-subtle);
  margin-bottom: 4px;
}
.psd-preview__text {
  font-size: 12px;
  color: var(--doc-text-muted);
  font-family: ui-monospace, monospace;
  word-break: break-all;
}
.psd-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.psd-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 2px solid var(--doc-border);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.psd-option:hover {
  border-color: var(--doc-border-dark);
}
.psd-option--selected {
  border-color: var(--doc-primary);
  background: var(--doc-primary-light);
}
.psd-option input {
  margin-top: 2px;
}
.psd-option__info {
  display: flex;
  flex-direction: column;
}
.psd-option__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--doc-text);
}
.psd-option__desc {
  font-size: 11px;
  color: var(--doc-text-subtle);
}
.psd-btn {
  padding: 6px 16px;
  font-size: 13px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  cursor: pointer;
  background: var(--doc-surface);
}
.psd-btn--primary {
  background: var(--doc-primary);
  color: var(--doc-on-primary);
  border-color: var(--doc-primary);
}
</style>
