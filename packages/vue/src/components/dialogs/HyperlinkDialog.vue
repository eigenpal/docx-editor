<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">{{
          isEditing ? t('dialogs.hyperlink.titleEdit') : t('dialogs.hyperlink.titleInsert')
        }}</span>
        <button class="dialog__close" :aria-label="t('common.closeDialog')" @click="close">
          ✕
        </button>
      </div>
      <div class="dialog__body">
        <div v-if="bookmarks.length > 0" class="link-tabs" role="tablist">
          <button
            class="link-tab"
            :class="{ active: linkType === 'url' }"
            role="tab"
            :aria-selected="linkType === 'url'"
            @mousedown.prevent="linkType = 'url'"
          >
            {{ t('dialogs.hyperlink.tabWebAddress') }}
          </button>
          <button
            class="link-tab"
            :class="{ active: linkType === 'bookmark' }"
            role="tab"
            :aria-selected="linkType === 'bookmark'"
            @mousedown.prevent="linkType = 'bookmark'"
          >
            {{ t('dialogs.hyperlink.tabBookmark') }}
          </button>
        </div>

        <div v-if="linkType === 'url'" class="field">
          <label class="field__label">{{ t('dialogs.hyperlink.urlLabel') }}</label>
          <input
            ref="urlInputRef"
            v-model="url"
            class="field__input"
            :class="{ 'field__input--error': touched && !!urlError }"
            :placeholder="t('dialogs.hyperlink.urlPlaceholder')"
            :aria-invalid="touched && !!urlError"
            @keydown.enter.prevent="submit"
            @blur="validateUrl"
          />
          <div v-if="touched && urlError" class="field__error">{{ urlError }}</div>
          <div v-else class="field__hint">{{ t('dialogs.hyperlink.urlHint') }}</div>
        </div>
        <div v-else class="field">
          <label class="field__label">{{ t('dialogs.hyperlink.bookmarkLabel') }}</label>
          <select
            ref="bookmarkSelectRef"
            v-model="bookmark"
            class="field__input"
            @keydown.enter.prevent="submit"
          >
            <option value="">{{ t('dialogs.hyperlink.bookmarkPlaceholder') }}</option>
            <option v-for="bm in bookmarks" :key="bm.name" :value="bm.name">
              {{ bm.label || bm.name }}
            </option>
          </select>
        </div>
        <div class="field">
          <label class="field__label">{{ t('dialogs.hyperlink.displayTextLabel') }}</label>
          <input
            v-model="displayText"
            class="field__input"
            :placeholder="t('dialogs.hyperlink.displayTextPlaceholder')"
          />
          <div class="field__hint">{{ t('dialogs.hyperlink.displayTextHint') }}</div>
        </div>
        <div class="field">
          <label class="field__label">{{ t('dialogs.hyperlink.tooltipLabel') }}</label>
          <input
            v-model="tooltip"
            class="field__input"
            :placeholder="t('dialogs.hyperlink.tooltipPlaceholder')"
          />
        </div>
        <div class="dialog__actions">
          <button
            v-if="isEditing"
            class="dialog__btn dialog__btn--danger"
            @mousedown.prevent="removeLink"
          >
            {{ t('dialogs.hyperlink.removeLink') }}
          </button>
          <div style="flex: 1"></div>
          <button class="dialog__btn" @click="close">{{ t('common.cancel') }}</button>
          <button
            class="dialog__btn dialog__btn--primary"
            @mousedown.prevent="submit"
            :disabled="!canSubmit"
          >
            {{ isEditing ? t('common.update') : t('common.insert') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { useTranslation } from '../../i18n';

const { t } = useTranslation();

const props = defineProps<{
  isOpen: boolean;
  view: EditorView | null;
  bookmarks?: Array<{ name: string; label?: string }>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (
    e: 'submit',
    data: { url?: string; bookmark?: string; displayText: string; tooltip: string }
  ): void;
  (e: 'remove'): void;
}>();

const urlInputRef = ref<HTMLInputElement | null>(null);
const bookmarkSelectRef = ref<HTMLSelectElement | null>(null);
const linkType = ref<'url' | 'bookmark'>('url');
const url = ref('');
const bookmark = ref('');
const displayText = ref('');
const tooltip = ref('');
const isEditing = ref(false);
const urlError = ref('');
const touched = ref(false);

const bookmarks = computed(() => props.bookmarks ?? []);
const canSubmit = computed(() => {
  if (linkType.value === 'bookmark') return !!bookmark.value;
  return !!url.value.trim() && !urlError.value;
});

watch(url, () => {
  if (urlError.value) urlError.value = '';
});

function isValidUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(mailto:|tel:)/i.test(trimmed)) return trimmed.replace(/^(mailto:|tel:)/i, '').length > 0;
  if (/^ftp:\/\//i.test(trimmed)) return trimmed.length > 'ftp://'.length;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:\/\/|mailto:|tel:|ftp:\/\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

watch(
  () => props.isOpen,
  async (open) => {
    if (open) {
      // Check if there's an existing hyperlink at cursor
      const v = props.view;
      if (v) {
        const { $from, empty, from, to } = v.state.selection;
        const marks = v.state.storedMarks || $from.marks();
        const linkMark = marks.find((m) => m.type.name === 'hyperlink');

        if (linkMark) {
          const href = linkMark.attrs.href || '';
          if (href.startsWith('#')) {
            linkType.value = 'bookmark';
            bookmark.value = href.slice(1);
            url.value = '';
          } else {
            linkType.value = 'url';
            url.value = href;
            bookmark.value = '';
          }
          tooltip.value = linkMark.attrs.tooltip || '';
          isEditing.value = true;
        } else {
          linkType.value = 'url';
          url.value = '';
          bookmark.value = '';
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
      if (linkType.value === 'bookmark') bookmarkSelectRef.value?.focus();
      else urlInputRef.value?.focus();
    } else {
      touched.value = false;
      urlError.value = '';
    }
  }
);

function close() {
  emit('close');
}

function submit() {
  if (linkType.value === 'bookmark') {
    if (!bookmark.value) return;
    emit('submit', {
      bookmark: bookmark.value,
      displayText: displayText.value,
      tooltip: tooltip.value,
    });
    close();
    return;
  }
  touched.value = true;
  if (!isValidUrl(url.value)) {
    urlError.value = url.value.trim()
      ? t('dialogs.hyperlink.invalidUrl')
      : t('dialogs.hyperlink.urlRequired');
    return;
  }
  emit('submit', {
    url: normalizeUrl(url.value),
    displayText: displayText.value,
    tooltip: tooltip.value,
  });
  close();
}

function validateUrl() {
  if (linkType.value !== 'url') return;
  touched.value = true;
  if (!url.value.trim()) {
    urlError.value = '';
    return;
  }
  urlError.value = isValidUrl(url.value) ? '' : t('dialogs.hyperlink.invalidUrl');
}

function removeLink() {
  emit('remove');
  close();
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
  min-width: 400px;
  max-width: 90vw;
}
.dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}
.dialog__title {
  font-weight: 600;
  font-size: 14px;
  color: #1f2937;
}
.dialog__close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: #6b7280;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.dialog__close:hover {
  background: #f3f4f6;
}
.dialog__body {
  padding: 16px;
}
.dialog__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.dialog__btn {
  padding: 6px 16px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  background: #fff;
}
.dialog__btn--primary {
  background: #3b82f6;
  color: #fff;
  border-color: #3b82f6;
}
.dialog__btn--primary:hover {
  background: #2563eb;
}
.dialog__btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dialog__btn--danger {
  color: #dc2626;
  border-color: #fca5a5;
}
.dialog__btn--danger:hover {
  background: #fef2f2;
}

.link-tabs {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 12px;
}
.link-tab {
  padding: 8px 12px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  color: #6b7280;
  font-size: 13px;
  margin-bottom: -1px;
}
.link-tab.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 600;
}
.field {
  margin-bottom: 12px;
}
.field__label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 4px;
}
.field__input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.field__input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}
.field__input--error {
  border-color: #dc2626;
}
.field__error {
  color: #dc2626;
  font-size: 11px;
  margin-top: 4px;
}
.field__hint {
  color: #6b7280;
  font-size: 11px;
  margin-top: 4px;
}
</style>
