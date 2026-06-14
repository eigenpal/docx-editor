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
        :class="[
          'ctx-menu__item',
          { 'ctx-menu__item--disabled': item.disabled, 'ctx-menu__item--divider': item.divider },
        ]"
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
import { useTranslation } from '../i18n';

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
  // Mirrors React's tableContext gates: merge needs a multi-cell
  // selection; split is offered whenever the caret sits in a single
  // cell (prosemirror-tables' splitCell no-ops if it can't split).
  canMergeCells?: boolean;
  canSplitCell?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'action', action: string): void;
}>();

const { t } = useTranslation();

const menuRef = ref<HTMLElement | null>(null);

const MENU_WIDTH = 220;
const MENU_ITEM_HEIGHT = 32;
const MARGIN = 10;

const visibleItems = computed<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [
    {
      id: 'cut',
      label: t('contextMenu.cut'),
      action: 'cut',
      shortcut: t('contextMenu.cutShortcut'),
      disabled: !props.hasSelection || !props.isEditable,
    },
    {
      id: 'copy',
      label: t('contextMenu.copy'),
      action: 'copy',
      shortcut: t('contextMenu.copyShortcut'),
      disabled: !props.hasSelection,
    },
    {
      id: 'paste',
      label: t('contextMenu.paste'),
      action: 'paste',
      shortcut: t('contextMenu.pasteShortcut'),
      disabled: !props.isEditable,
    },
    {
      id: 'pasteAsPlainText',
      label: t('contextMenu.pastePlainText'),
      action: 'pasteAsPlainText',
      shortcut: t('contextMenu.pastePlainTextShortcut'),
      disabled: !props.isEditable,
    },
    { id: 'div1', label: '', action: '', divider: true },
    {
      id: 'delete',
      label: t('contextMenu.delete'),
      action: 'delete',
      shortcut: t('contextMenu.deleteShortcut'),
      disabled: !props.hasSelection || !props.isEditable,
    },
    {
      id: 'selectAll',
      label: t('contextMenu.selectAll'),
      action: 'selectAll',
      shortcut: t('contextMenu.selectAllShortcut'),
    },
  ];

  if (props.onImage && props.isEditable) {
    items.push(
      { id: 'div-img', label: '', action: '', divider: true },
      { id: 'replaceImage', label: t('imageOverlay.replaceImage'), action: 'replaceImage' },
      {
        id: 'imageProperties',
        label: t('imageWrap.menu.imageProperties'),
        action: 'imageProperties',
      },
      {
        id: 'deleteImage',
        label: t('imageOverlay.deleteImage'),
        action: 'deleteImage',
        shortcut: t('contextMenu.deleteShortcut'),
      }
    );
  }

  if (props.inTable && props.isEditable) {
    items.push(
      { id: 'div2', label: '', action: '', divider: true },
      { id: 'addRowAbove', label: t('table.insertRowAbove'), action: 'addRowAbove' },
      { id: 'addRowBelow', label: t('table.insertRowBelow'), action: 'addRowBelow' },
      { id: 'deleteRow', label: t('table.deleteRow'), action: 'deleteRow' },
      { id: 'div3', label: '', action: '', divider: true },
      { id: 'addColLeft', label: t('table.insertColumnLeft'), action: 'addColumnLeft' },
      { id: 'addColRight', label: t('table.insertColumnRight'), action: 'addColumnRight' },
      { id: 'deleteCol', label: t('table.deleteColumn'), action: 'deleteColumn' },
      { id: 'div4', label: '', action: '', divider: true },
      {
        id: 'mergeCells',
        label: t('table.mergeCells'),
        action: 'mergeCells',
        disabled: !props.canMergeCells,
      },
      {
        id: 'splitCell',
        label: t('table.splitCell'),
        action: 'splitCell',
        disabled: !props.canSplitCell,
      }
    );
  }

  return items;
});

const menuStyle = computed(() => {
  let x = props.position.x;
  let y = props.position.y;
  const itemCount = visibleItems.value.filter((i) => !i.divider).length;
  const dividerCount = visibleItems.value.filter((i) => i.divider).length;
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

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      nextTick(() => menuRef.value?.focus());
    }
  }
);
</script>

<style scoped>
.ctx-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 399;
}
.ctx-menu {
  background: var(--doc-surface);
  border: 1px solid var(--doc-border-dark);
  border-radius: 6px;
  box-shadow: 0 4px 16px var(--doc-shadow);
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
  color: var(--doc-text);
  text-align: left;
  height: 32px;
}
.ctx-menu__item:hover:not(.ctx-menu__item--disabled):not(.ctx-menu__item--divider) {
  background: var(--doc-bg-hover);
}
.ctx-menu__item--disabled {
  color: var(--doc-text-subtle);
  cursor: default;
}
.ctx-menu__item--divider {
  height: 1px;
  padding: 0;
  margin: 4px 8px;
  background: var(--doc-border);
  cursor: default;
  pointer-events: none;
}
.ctx-menu__label {
  flex: 1;
}
.ctx-menu__shortcut {
  font-size: 11px;
  color: var(--doc-text-subtle);
  margin-left: 16px;
}
</style>
