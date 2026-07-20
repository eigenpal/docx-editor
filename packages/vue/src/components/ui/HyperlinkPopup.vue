<!--
  Vue port of packages/react/src/components/ui/HyperlinkPopup.tsx —
  Floating popup for hyperlinks. View mode shows
  URL + copy / edit / unlink buttons; edit mode shows text + URL
  inputs + Apply button. Same colour palette + same anchor
  positioning as React.
-->
<template>
  <div
    v-if="data"
    ref="popupRef"
    :class="['docx-hyperlink-popup', { 'docx-hyperlink-popup--edit': isEditing }]"
    :style="popupStyle"
    @mousedown.stop
  >
    <template v-if="!isEditing">
      <span class="docx-hyperlink-popup__icon" aria-hidden>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path
            d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
          />
        </svg>
      </span>
      <a
        class="docx-hyperlink-popup__url"
        :href="data.href"
        :title="data.href"
        @click.prevent="$emit('navigate', data.href)"
      >
        {{ data.href }}
      </a>
      <span class="docx-hyperlink-popup__sep" />
      <button
        class="docx-hyperlink-popup__btn"
        :title="t('hyperlinkPopup.copyLink')"
        @click.prevent="onCopy"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button
        v-if="!readOnly"
        class="docx-hyperlink-popup__btn"
        :title="t('hyperlinkPopup.editLink')"
        @click.prevent="startEdit"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button
        v-if="!readOnly"
        class="docx-hyperlink-popup__btn"
        :title="t('hyperlinkPopup.removeLink')"
        @click.prevent="$emit('remove')"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M18.84 12.25l1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"
          />
          <path
            d="M5.17 11.75l-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"
          />
          <line x1="8" y1="2" x2="8" y2="5" />
          <line x1="2" y1="8" x2="5" y2="8" />
          <line x1="16" y1="19" x2="16" y2="22" />
          <line x1="19" y1="16" x2="22" y2="16" />
        </svg>
      </button>
    </template>
    <template v-else>
      <div class="docx-hyperlink-popup__edit-row">
        <input
          class="docx-hyperlink-popup__input"
          :placeholder="t('hyperlinkPopup.displayTextPlaceholder')"
          v-model="editText"
          @keydown.enter.prevent="saveEdit"
          @keydown.esc="$emit('close')"
        />
      </div>
      <div class="docx-hyperlink-popup__edit-row">
        <input
          class="docx-hyperlink-popup__input"
          placeholder="https://..."
          v-model="editHref"
          @keydown.enter.prevent="saveEdit"
          @keydown.esc="$emit('close')"
        />
        <button
          class="docx-hyperlink-popup__apply"
          :disabled="!editHref.trim()"
          @click.prevent="saveEdit"
        >
          {{ t('common.apply') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, type CSSProperties } from 'vue';
import { useTranslation } from '../../i18n';

const { t } = useTranslation();

export type { HyperlinkPopupData } from './hyperlinkPopupTypes';
import type { HyperlinkPopupData } from './hyperlinkPopupTypes';

const props = defineProps<{
  data: HyperlinkPopupData | null;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'navigate', href: string): void;
  (e: 'copy', href: string): void;
  (e: 'edit', displayText: string, href: string): void;
  (e: 'remove'): void;
  (e: 'close'): void;
}>();

const isEditing = ref(false);
const editText = ref('');
const editHref = ref('');
const popupRef = ref<HTMLDivElement | null>(null);

// Position comes from props.data.position in container coordinates. With
// position: absolute inside the pages-viewport, the browser handles scroll
// repositioning — no JS listeners needed.
const popupStyle = computed<CSSProperties>(() => ({
  left: (props.data?.position.left ?? 0) + 'px',
  top: (props.data?.position.top ?? 0) + 'px',
}));

watch(
  () => props.data?.href,
  () => {
    isEditing.value = false;
  }
);

let outsideMouseDownListener: ((e: MouseEvent) => void) | null = null;
let outsideListenerTimer: ReturnType<typeof setTimeout> | null = null;

function teardownListeners() {
  if (outsideListenerTimer) {
    clearTimeout(outsideListenerTimer);
    outsideListenerTimer = null;
  }
  if (outsideMouseDownListener) {
    document.removeEventListener('mousedown', outsideMouseDownListener);
    outsideMouseDownListener = null;
  }
}

watch(
  () => props.data,
  (data) => {
    teardownListeners();
    if (!data) return;

    // Close on click outside the popup. Defer attaching so the click that
    // opened the popup doesn't immediately close it.
    outsideMouseDownListener = (e: MouseEvent) => {
      const el = popupRef.value;
      if (el && !el.contains(e.target as Node)) {
        emit('close');
      }
    };
    outsideListenerTimer = setTimeout(() => {
      if (outsideMouseDownListener) {
        document.addEventListener('mousedown', outsideMouseDownListener);
      }
    }, 0);
  },
  { immediate: true }
);

onBeforeUnmount(teardownListeners);

function startEdit() {
  if (!props.data) return;
  editText.value = props.data.displayText;
  editHref.value = props.data.href;
  isEditing.value = true;
}

function saveEdit() {
  if (!editHref.value.trim()) return;
  emit('edit', editText.value, editHref.value);
  isEditing.value = false;
}

function onCopy() {
  if (!props.data) return;
  emit('copy', props.data.href);
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(props.data.href).catch(() => {});
  }
}
</script>

<style scoped>
.docx-hyperlink-popup {
  position: absolute;
  z-index: 10000;
  background: var(--doc-surface);
  border: 1px solid var(--doc-border-light);
  border-radius: 8px;
  box-shadow:
    0 1px 3px var(--doc-shadow),
    0 4px 12px var(--doc-shadow-subtle);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 400px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
}
.docx-hyperlink-popup--edit {
  flex-direction: column;
  align-items: stretch;
  padding: 12px;
  width: 320px;
}
.docx-hyperlink-popup__icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--doc-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
.docx-hyperlink-popup__url {
  color: var(--doc-link);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
}
.docx-hyperlink-popup__sep {
  width: 1px;
  height: 20px;
  background: var(--doc-border-light);
  flex-shrink: 0;
}
.docx-hyperlink-popup__btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--doc-text-muted);
  padding: 0;
  flex-shrink: 0;
}
.docx-hyperlink-popup__btn:hover {
  background: var(--doc-bg-hover);
}
.docx-hyperlink-popup__edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.docx-hyperlink-popup__edit-row:last-child {
  margin-bottom: 0;
}
.docx-hyperlink-popup__input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--doc-border-light);
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  line-height: 20px;
}
.docx-hyperlink-popup__input:focus {
  border-color: var(--doc-primary);
}
.docx-hyperlink-popup__apply {
  color: var(--doc-primary);
  font-weight: 600;
  font-size: 14px;
  border: none;
  background: none;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 4px;
  flex-shrink: 0;
}
.docx-hyperlink-popup__apply:disabled {
  color: var(--doc-text-subtle);
  cursor: not-allowed;
}
</style>
