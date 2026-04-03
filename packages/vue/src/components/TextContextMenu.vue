<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="ctx-menu-backdrop"
      @mousedown="$emit('close')"
      @contextmenu.prevent="$emit('close')"
    />
    <div
      v-if="isOpen"
      ref="menuRef"
      class="ctx-menu"
      :style="menuStyle"
      @contextmenu.prevent
      @keydown="handleKeyDown"
    >
      <button
        v-for="(item, i) in visibleItems"
        :key="item.id || i"
        :class="['ctx-menu__item', { 'ctx-menu__item--disabled': item.disabled, 'ctx-menu__item--divider': item.divider }]"
        :disabled="item.disabled"
        @mousedown.prevent="onAction(item.action)"
      >
        <span class="ctx-menu__label">{{ item.label }}</span>
        <span v-if="item.shortcut" class="ctx-menu__shortcut">{{ item.shortcut }}</span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

export interface ContextMenuItem {
  id: string;
  label: string;
  action: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
}

const props = defineProps<{
  isOpen: boolean;
  position: { x: number; y: number };
  hasSelection: boolean;
  isEditable: boolean;
  inTable?: boolean;
  onImage?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'action', action: string): void;
}>();

const menuRef = ref<HTMLElement | null>(null);

const MENU_WIDTH = 220;
const MENU_ITEM_HEIGHT = 32;
const MARGIN = 10;

const visibleItems = computed<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [
    { id: 'cut', label: 'Cut', action: 'cut', shortcut: 'Ctrl+X', disabled: !props.hasSelection || !props.isEditable },
    { id: 'copy', label: 'Copy', action: 'copy', shortcut: 'Ctrl+C', disabled: !props.hasSelection },
    { id: 'paste', label: 'Paste', action: 'paste', shortcut: 'Ctrl+V', disabled: !props.isEditable },
    { id: 'div1', label: '', action: '', divider: true },
    { id: 'delete', label: 'Delete', action: 'delete', shortcut: 'Del', disabled: !props.hasSelection || !props.isEditable },
    { id: 'selectAll', label: 'Select All', action: 'selectAll', shortcut: 'Ctrl+A' },
  ];

  if (props.onImage && props.isEditable) {
    items.push(
      { id: 'div-img', label: '', action: '', divider: true },
      { id: 'replaceImage', label: 'Replace image\u2026', action: 'replaceImage' },
      { id: 'imageProperties', label: 'Image properties\u2026', action: 'imageProperties' },
      { id: 'deleteImage', label: 'Delete image', action: 'deleteImage', shortcut: 'Del' },
    );
  }

  if (props.inTable && props.isEditable) {
    items.push(
      { id: 'div2', label: '', action: '', divider: true },
      { id: 'addRowAbove', label: 'Insert row above', action: 'addRowAbove' },
      { id: 'addRowBelow', label: 'Insert row below', action: 'addRowBelow' },
      { id: 'deleteRow', label: 'Delete row', action: 'deleteRow' },
      { id: 'div3', label: '', action: '', divider: true },
      { id: 'addColLeft', label: 'Insert column left', action: 'addColumnLeft' },
      { id: 'addColRight', label: 'Insert column right', action: 'addColumnRight' },
      { id: 'deleteCol', label: 'Delete column', action: 'deleteColumn' },
    );
  }

  return items;
});

const menuStyle = computed(() => {
  let x = props.position.x;
  let y = props.position.y;
  const itemCount = visibleItems.value.filter(i => !i.divider).length;
  const dividerCount = visibleItems.value.filter(i => i.divider).length;
  const menuHeight = itemCount * MENU_ITEM_HEIGHT + dividerCount * 9;

  if (typeof window !== 'undefined') {
    if (x + MENU_WIDTH + MARGIN > window.innerWidth) {
      x = window.innerWidth - MENU_WIDTH - MARGIN;
    }
    if (y + menuHeight + MARGIN > window.innerHeight) {
      y = window.innerHeight - menuHeight - MARGIN;
    }
  }

  return {
    position: 'fixed' as const,
    left: `${x}px`,
    top: `${y}px`,
    zIndex: 400,
  };
});

function onAction(action: string) {
  if (!action) return;
  emit('action', action);
  emit('close');
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close');
  }
}

watch(() => props.isOpen, (open) => {
  if (open) {
    nextTick(() => menuRef.value?.focus());
  }
});
</script>

<style scoped>
.ctx-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 399;
}
.ctx-menu {
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.14);
  min-width: 220px;
  padding: 4px 0;
  outline: none;
}
.ctx-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #1f2937;
  text-align: left;
  height: 32px;
}
.ctx-menu__item:hover:not(.ctx-menu__item--disabled):not(.ctx-menu__item--divider) {
  background: #f3f4f6;
}
.ctx-menu__item--disabled {
  color: #9ca3af;
  cursor: default;
}
.ctx-menu__item--divider {
  height: 1px;
  padding: 0;
  margin: 4px 8px;
  background: #e5e7eb;
  cursor: default;
  pointer-events: none;
}
.ctx-menu__label { flex: 1; }
.ctx-menu__shortcut { font-size: 11px; color: #9ca3af; margin-left: 16px; }
</style>
