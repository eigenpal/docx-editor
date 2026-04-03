<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="ai-ctx-backdrop"
      @mousedown="$emit('close')"
      @contextmenu.prevent="$emit('close')"
    />
    <div
      v-if="isOpen"
      class="ai-ctx-menu"
      :style="menuStyle"
      @contextmenu.prevent
    >
      <div class="ai-ctx-menu__header">AI Actions</div>
      <button
        v-for="action in actions"
        :key="action.id"
        class="ai-ctx-menu__item"
        @mousedown.prevent="handleAction(action.id)"
      >
        <span class="ai-ctx-menu__icon">{{ action.icon }}</span>
        <span class="ai-ctx-menu__label">{{ action.label }}</span>
      </button>
      <div class="ai-ctx-menu__divider" />
      <div v-if="showCustomPrompt" class="ai-ctx-menu__custom">
        <input
          v-model="customPrompt"
          class="ai-ctx-menu__input"
          placeholder="Custom prompt..."
          @keydown.enter.prevent="handleAction('custom')"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    position: { x: number; y: number };
    selectedText: string;
    showCustomPrompt?: boolean;
  }>(),
  { showCustomPrompt: true }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'action', action: string, customPrompt?: string): void;
}>();

const customPrompt = ref('');

const actions = [
  { id: 'rewrite', label: 'Rewrite', icon: '&#x270D;' },
  { id: 'expand', label: 'Expand', icon: '&#x2194;' },
  { id: 'summarize', label: 'Summarize', icon: '&#x1F4DD;' },
  { id: 'fixGrammar', label: 'Fix grammar', icon: '&#x2714;' },
  { id: 'makeFormal', label: 'Make formal', icon: '&#x1F454;' },
  { id: 'makeCasual', label: 'Make casual', icon: '&#x1F60A;' },
  { id: 'translate', label: 'Translate', icon: '&#x1F310;' },
  { id: 'explain', label: 'Explain', icon: '&#x1F4A1;' },
];

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
.ai-ctx-backdrop { position: fixed; inset: 0; z-index: 499; }
.ai-ctx-menu {
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.14);
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
.ai-ctx-menu__item:hover { background: #f3f4f6; }
.ai-ctx-menu__icon { font-size: 14px; width: 18px; text-align: center; }
.ai-ctx-menu__label { flex: 1; }
.ai-ctx-menu__divider { height: 1px; background: #e5e7eb; margin: 4px 10px; }
.ai-ctx-menu__custom { padding: 6px 10px; }
.ai-ctx-menu__input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}
.ai-ctx-menu__input:focus { border-color: #3b82f6; }
</style>
