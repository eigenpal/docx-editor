<!--
  Vue port of packages/react/src/components/ContextMenu.tsx —
  right-click AI-action menu (Ask AI / rewrite / expand / summarize /
  translate / etc). Same DEFAULT_AI_ACTIONS list and same action
  descriptions as React (sourced from core's agentApi types).

  This is a focused port covering the AI sub-surface; React's
  ContextMenu also handles general-purpose right-click branches
  (table cell, image, hyperlink) which Vue routes through dedicated
  components (TableMoreDropdown, ImageSelectionOverlay, HyperlinkPopup).
-->
<template>
  <div
    v-if="isOpen"
    class="docx-context-menu"
    :class="className"
    :style="menuStyle"
    @mousedown.stop
    @contextmenu.prevent
  >
    <div v-if="selectedText" class="docx-context-menu__preview">
      <span class="docx-context-menu__preview-label">Selected:</span>
      <span class="docx-context-menu__preview-text">"{{ truncatedSelection }}"</span>
    </div>
    <div class="docx-context-menu__items">
      <button
        v-for="action in resolvedActions"
        :key="action"
        class="docx-context-menu__item"
        @click.prevent="onItemClick(action)"
      >
        <span class="docx-context-menu__icon">{{ ICONS[action] }}</span>
        <span class="docx-context-menu__label">{{ LABELS[action] }}</span>
      </button>
    </div>
    <div v-if="showCustomPrompt" class="docx-context-menu__custom">
      <input
        v-model="customPrompt"
        class="docx-context-menu__custom-input"
        placeholder="Ask AI to..."
        @keydown.enter.prevent="onSubmitCustom"
        @keydown.esc="$emit('close')"
      />
      <button
        class="docx-context-menu__custom-submit"
        :disabled="!customPrompt.trim()"
        @click.prevent="onSubmitCustom"
      >
        Send
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, type CSSProperties } from 'vue';
import type {
  AIAction,
  SelectionContext,
} from '@eigenpal/docx-editor-core/types/agentApi';
import { DEFAULT_AI_ACTIONS } from '@eigenpal/docx-editor-core/types/agentApi';

const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    position: { x: number; y: number };
    selectedText: string;
    selectionContext?: SelectionContext;
    actions?: AIAction[];
    showCustomPrompt?: boolean;
    className?: string;
  }>(),
  { showCustomPrompt: true }
);

const emit = defineEmits<{
  (e: 'action', action: AIAction, customPrompt?: string): void;
  (e: 'close'): void;
}>();

const customPrompt = ref('');

const resolvedActions = computed(() => props.actions ?? DEFAULT_AI_ACTIONS);

const truncatedSelection = computed(() => {
  if (!props.selectedText) return '';
  return props.selectedText.length > 60
    ? props.selectedText.slice(0, 60) + '…'
    : props.selectedText;
});

const menuStyle = computed<CSSProperties>(() => ({
  left: props.position.x + 'px',
  top: props.position.y + 'px',
}));

const LABELS: Record<AIAction, string> = {
  askAI: 'Ask AI',
  rewrite: 'Rewrite',
  expand: 'Expand',
  summarize: 'Summarize',
  translate: 'Translate',
  explain: 'Explain',
  fixGrammar: 'Fix grammar',
  makeFormal: 'Make formal',
  makeCasual: 'Make casual',
  custom: 'Custom prompt',
};
const ICONS: Record<AIAction, string> = {
  askAI: '✦',
  rewrite: '✏︎',
  expand: '⤢',
  summarize: '↓',
  translate: '🌐',
  explain: '?',
  fixGrammar: '✓',
  makeFormal: 'A',
  makeCasual: 'a',
  custom: '…',
};

function onItemClick(action: AIAction) {
  emit('action', action);
  emit('close');
}
function onSubmitCustom() {
  const prompt = customPrompt.value.trim();
  if (!prompt) return;
  emit('action', 'custom', prompt);
  customPrompt.value = '';
  emit('close');
}

function onDocClick(e: MouseEvent) {
  if (!props.isOpen) return;
  const t = e.target as HTMLElement;
  if (!t.closest('.docx-context-menu')) emit('close');
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.isOpen) emit('close');
}
onMounted(() => {
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onEsc);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onEsc);
});
</script>

<style scoped>
.docx-context-menu {
  position: fixed;
  z-index: 10000;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  min-width: 220px;
  padding: 6px 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
}
.docx-context-menu__preview {
  padding: 6px 12px 8px;
  border-bottom: 1px solid #f1f3f4;
  font-size: 12px;
  color: #5f6368;
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.docx-context-menu__preview-text {
  font-style: italic;
  color: #202124;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.docx-context-menu__items {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}
.docx-context-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #1f2937;
  text-align: left;
  width: 100%;
}
.docx-context-menu__item:hover { background: #f3f4f6; }
.docx-context-menu__icon {
  width: 18px;
  text-align: center;
  color: #5f6368;
}
.docx-context-menu__custom {
  display: flex;
  gap: 4px;
  padding: 8px 8px 4px;
  border-top: 1px solid #f1f3f4;
}
.docx-context-menu__custom-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
}
.docx-context-menu__custom-input:focus { border-color: #1a73e8; }
.docx-context-menu__custom-submit {
  padding: 6px 12px;
  font-size: 13px;
  border: none;
  background: #1a73e8;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
}
.docx-context-menu__custom-submit:disabled {
  background: #f1f3f4;
  color: #80868b;
  cursor: not-allowed;
}
</style>
