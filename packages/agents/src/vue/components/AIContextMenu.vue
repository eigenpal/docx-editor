<!--
  AIContextMenu — floating menu of AI actions for selected text. Migrated
  from packages/vue in the 1.0 train so it lives next to the agent UI it
  belongs to. Labels default to bundled English; pass the `labels` prop
  (a partial `AIContextMenuLabels` object) for translations.
-->
<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="ai-ctx-backdrop"
      @mousedown="emit('close')"
      @contextmenu.prevent="emit('close')"
    />
    <div
      v-if="isOpen"
      class="ai-ctx-menu"
      :aria-label="headerLabel"
      :style="menuStyle"
      tabindex="-1"
      @contextmenu.prevent
      @keydown.esc.stop="emit('close')"
    >
      <div class="ai-ctx-menu__header" aria-hidden="true">{{ headerLabel }}</div>
      <button
        v-for="action in actions"
        :key="action.id"
        ref="itemRefs"
        class="ai-ctx-menu__item"
        @mousedown.prevent="handleAction(action.id)"
      >
        <span class="ai-ctx-menu__icon" v-html="action.icon" />
        <span class="ai-ctx-menu__label">{{ resolvedLabel(action.id) }}</span>
      </button>
      <div class="ai-ctx-menu__divider" />
      <div v-if="showCustomPrompt" class="ai-ctx-menu__custom">
        <input
          v-model="customPrompt"
          class="ai-ctx-menu__input"
          :placeholder="customPlaceholder"
          @keydown.enter.prevent="handleAction('custom')"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import en from '../../../i18n/en.json';

export interface AIContextMenuLabels {
  header?: string;
  rewrite?: string;
  expand?: string;
  summarize?: string;
  fixGrammar?: string;
  makeFormal?: string;
  makeCasual?: string;
  translate?: string;
  explain?: string;
  customPlaceholder?: string;
}

export interface AIContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  selectedText: string;
  showCustomPrompt?: boolean;
  labels?: AIContextMenuLabels;
}

const props = withDefaults(defineProps<AIContextMenuProps>(), {
  showCustomPrompt: true,
  labels: () => ({}),
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'action', action: string, customPrompt?: string): void;
}>();

const customPrompt = ref('');

// Focus the first action when the menu opens (WCAG 2.1.1: keyboard users
// must be able to dismiss + interact). Native `ref="itemRefs"` collects
// the array; `immediate: true` covers the case where the menu mounts
// already-open (parent races mount with isOpen=true).
const itemRefs = ref<HTMLButtonElement[]>([]);
watch(
  () => props.isOpen,
  (open) => {
    if (!open) return;
    nextTick(() => itemRefs.value[0]?.focus());
  },
  { immediate: true }
);

// Icons stay inline — keeps the component self-contained without a font
// dependency. Labels default to en.json so translators own them.
const actions = [
  { id: 'rewrite', icon: '&#x270D;' },
  { id: 'expand', icon: '&#x2194;' },
  { id: 'summarize', icon: '&#x1F4DD;' },
  { id: 'fixGrammar', icon: '&#x2714;' },
  { id: 'makeFormal', icon: '&#x1F454;' },
  { id: 'makeCasual', icon: '&#x1F60A;' },
  { id: 'translate', icon: '&#x1F310;' },
  { id: 'explain', icon: '&#x1F4A1;' },
];

const headerLabel = computed(() => props.labels?.header ?? en.aiActions.header);
const customPlaceholder = computed(
  () => props.labels?.customPlaceholder ?? en.aiActions.customPlaceholder
);

function resolvedLabel(id: string): string {
  const override = props.labels?.[id as keyof AIContextMenuLabels];
  if (override) return override;
  return (en.aiActions as Record<string, string>)[id] ?? id;
}

const menuStyle = computed(() => {
  let x = props.position.x;
  let y = props.position.y;
  const MENU_W = 220;
  const MENU_H = 360;
  if (typeof window !== 'undefined') {
    if (x + MENU_W + 10 > window.innerWidth) x = window.innerWidth - MENU_W - 10;
    if (y + MENU_H + 10 > window.innerHeight) y = window.innerHeight - MENU_H - 10;
  }
  return { position: 'fixed' as const, left: `${x}px`, top: `${y}px`, zIndex: 500 };
});

function handleAction(action: string) {
  emit('action', action, action === 'custom' ? customPrompt.value : undefined);
  customPrompt.value = '';
  emit('close');
}
</script>

<style scoped>
.ai-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 499;
}
.ai-ctx-menu {
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  min-width: 200px;
  padding: 4px 0;
}
.ai-ctx-menu__header {
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ai-ctx-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #1f2937;
  text-align: left;
}
.ai-ctx-menu__item:hover {
  background: #f3f4f6;
}
.ai-ctx-menu__icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
}
.ai-ctx-menu__label {
  flex: 1;
}
.ai-ctx-menu__divider {
  height: 1px;
  background: #e5e7eb;
  margin: 4px 10px;
}
.ai-ctx-menu__custom {
  padding: 6px 10px;
}
.ai-ctx-menu__input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}
.ai-ctx-menu__input:focus {
  border-color: #3b82f6;
}
</style>
