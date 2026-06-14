<!--
  Mirror of React's EditingModeDropdown (DocxEditor.tsx:757). Three-
  mode pill (editing / suggesting / viewing) with icon + label +
  chevron; click opens a panel with each mode's description. Goes
  compact (icon only) below 1400px to match React's behavior. Close
  behaviour via shared Popover.
-->
<template>
  <Popover
    :open="isOpen"
    placement="bottom-right"
    @update:open="(v) => (isOpen = v)"
    @close="isOpen = false"
  >
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="editing-mode__trigger"
        :class="{
          'editing-mode__trigger--open': isOpen,
          'editing-mode__trigger--compact': compact,
        }"
        :title="`${t(current.labelKey)} (Ctrl+Shift+E)`"
        @click.prevent="toggle"
      >
        <MaterialSymbol :name="current.icon" :size="18" />
        <span v-if="!compact" class="editing-mode__label">{{ t(current.labelKey) }}</span>
        <MaterialSymbol name="arrow_drop_down" :size="16" />
      </button>
    </template>
    <template #panel>
      <div class="editing-mode__panel">
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          class="editing-mode__option"
          @click.prevent="select(m.value)"
        >
          <MaterialSymbol :name="m.icon" :size="20" />
          <span class="editing-mode__option-text">
            <span class="editing-mode__option-label">{{ t(m.labelKey) }}</span>
            <span class="editing-mode__option-desc">{{ t(m.descKey) }}</span>
          </span>
          <MaterialSymbol
            v-if="m.value === modelValue"
            name="check"
            :size="18"
            class="editing-mode__check"
          />
        </button>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import MaterialSymbol from './ui/MaterialSymbol.vue';
import Popover from './ui/Popover.vue';
import type { EditorMode } from './DocxEditor/types';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '@eigenpal/docx-editor-i18n';

const { t } = useTranslation();

const props = defineProps<{
  modelValue: EditorMode;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', mode: EditorMode): void;
}>();

const modes: {
  value: EditorMode;
  labelKey: TranslationKey;
  icon: string;
  descKey: TranslationKey;
}[] = [
  {
    value: 'editing',
    labelKey: 'editor.editing',
    icon: 'edit_note',
    descKey: 'editor.editingDescription',
  },
  {
    value: 'suggesting',
    labelKey: 'editor.suggesting',
    icon: 'rate_review',
    descKey: 'editor.suggestingDescription',
  },
  {
    value: 'viewing',
    labelKey: 'editor.viewing',
    icon: 'visibility',
    descKey: 'editor.viewingDescription',
  },
];

const isOpen = ref(false);
const compact = ref(false);

const current = computed(() => modes.find((m) => m.value === props.modelValue) ?? modes[0]);

function select(mode: EditorMode) {
  emit('update:modelValue', mode);
  isOpen.value = false;
}

let mql: MediaQueryList | null = null;
function onMqlChange(e: MediaQueryListEvent) {
  compact.value = e.matches;
}
onMounted(() => {
  mql = window.matchMedia('(max-width: 1400px)');
  compact.value = mql.matches;
  mql.addEventListener('change', onMqlChange);
});
onBeforeUnmount(() => mql?.removeEventListener('change', onMqlChange));
</script>

<style scoped>
.editing-mode__trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 400;
  /* React's trigger is full-strength --doc-text, not muted. */
  color: var(--doc-text);
  white-space: nowrap;
  height: 28px;
}
.editing-mode__trigger:hover {
  background: var(--doc-bg-hover);
}
.editing-mode__trigger--open {
  background: var(--doc-bg-hover);
}
.editing-mode__trigger--compact {
  gap: 0;
  padding: 2px 4px;
}
.editing-mode__label {
  padding: 0 2px;
}
.editing-mode__panel {
  padding: 4px 0;
  min-width: 220px;
}
.editing-mode__option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--doc-text);
  width: 100%;
  text-align: left;
}
.editing-mode__option:hover {
  background: var(--doc-bg-hover);
}
.editing-mode__option-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.editing-mode__option-label {
  font-weight: 500;
}
.editing-mode__option-desc {
  font-size: 11px;
  /* React's option description is --doc-text-muted, not subtle. */
  color: var(--doc-text-muted);
}
.editing-mode__check {
  margin-left: auto;
  color: var(--doc-primary);
}
</style>
