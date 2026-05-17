<!-- Dropdown menu with a text-label trigger — Vue port of
     packages/react/src/components/ui/MenuDropdown.tsx (same `MenuEntry` shape).
     Items with `submenu: true` open a hover panel from the `#submenu` slot. -->
<template>
  <Popover :open="isOpen" @update:open="(v) => (isOpen = v)" @close="closeMenu">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="docx-menu-dropdown__trigger"
        :class="{ 'docx-menu-dropdown__trigger--open': isOpen }"
        :disabled="disabled"
        @mousedown.prevent
        @click.prevent="toggle"
      >
        {{ label }}
        <MaterialSymbol v-if="showChevron" name="arrow_drop_down" :size="16" />
      </button>
    </template>
    <template #panel>
      <!-- @mousedown.prevent so picking an item doesn't blur the ProseMirror view
           (the menu only contains buttons + the table grid, no inputs). -->
      <div class="docx-menu-dropdown__menu" @mousedown.prevent>
        <template v-for="(item, i) in items" :key="i">
          <div v-if="isSeparator(item)" class="docx-menu-dropdown__separator" />
          <div
            v-else
            class="docx-menu-dropdown__wrap"
            @mouseenter="item.submenu ? (openSubmenu = i) : undefined"
            @mouseleave="item.submenu ? (openSubmenu = null) : undefined"
          >
            <button
              type="button"
              class="docx-menu-dropdown__item"
              :class="{ 'docx-menu-dropdown__item--disabled': item.disabled }"
              :disabled="item.disabled"
              @click.prevent="onItemClick(item)"
            >
              <MaterialSymbol v-if="item.icon" :name="item.icon" :size="18" />
              <span class="docx-menu-dropdown__label">{{ item.label }}</span>
              <span v-if="item.shortcut" class="docx-menu-dropdown__shortcut">{{
                item.shortcut
              }}</span>
              <span v-if="item.submenu" class="docx-menu-dropdown__chevron">
                <MaterialSymbol name="keyboard_arrow_right" :size="16" />
              </span>
            </button>
            <div v-if="item.submenu && openSubmenu === i" class="docx-menu-dropdown__submenu">
              <slot name="submenu" :item="item" :close-menu="closeMenu" />
            </div>
          </div>
        </template>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MaterialSymbol from './MaterialSymbol.vue';
import Popover from './Popover.vue';

export interface MenuItem {
  icon?: string;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Stable id so the `#submenu` slot can tell which item it's rendering for. */
  key?: string;
  /** When true, the item shows a right-chevron and opens the `#submenu` slot on hover. */
  submenu?: boolean;
}
export interface MenuSeparator {
  type: 'separator';
}
export type MenuEntry = MenuItem | MenuSeparator;

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'type' in entry && entry.type === 'separator';
}

withDefaults(
  defineProps<{
    label: string;
    items: MenuEntry[];
    disabled?: boolean;
    /** When true, the trigger renders a down-arrow caret next to the label.
     *  Default `false` — every in-tree caller is a top-level menubar button. */
    showChevron?: boolean;
  }>(),
  { showChevron: false }
);

const isOpen = ref(false);
const openSubmenu = ref<number | null>(null);

function closeMenu() {
  isOpen.value = false;
  openSubmenu.value = null;
}

function onItemClick(item: MenuItem) {
  if (item.disabled || item.submenu) return;
  item.onClick?.();
  closeMenu();
}
</script>

<style scoped>
.docx-menu-dropdown__trigger {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 400;
  color: #374151;
  white-space: nowrap;
  height: 28px;
}
.docx-menu-dropdown__trigger:hover {
  background: #f3f4f6;
}
.docx-menu-dropdown__trigger--open {
  background: #f3f4f6;
}
.docx-menu-dropdown__menu {
  min-width: 200px;
  padding: 4px 0;
}
.docx-menu-dropdown__wrap {
  position: relative;
}
.docx-menu-dropdown__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  width: 100%;
  text-align: left;
  white-space: nowrap;
}
.docx-menu-dropdown__item:hover:not(.docx-menu-dropdown__item--disabled) {
  background: #f3f4f6;
}
.docx-menu-dropdown__item--disabled {
  opacity: 0.4;
  cursor: default;
}
.docx-menu-dropdown__label {
  flex: 1;
}
.docx-menu-dropdown__shortcut {
  margin-left: auto;
  font-size: 11px;
  color: #9ca3af;
  font-family: monospace;
}
.docx-menu-dropdown__chevron {
  margin-left: auto;
  display: inline-flex;
  color: #9ca3af;
}
.docx-menu-dropdown__submenu {
  /* Flush against the item (no margin) so the cursor never crosses a gap
     that would fire mouseleave and collapse the submenu mid-travel. */
  position: absolute;
  left: 100%;
  top: -4px;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 8px;
  z-index: 1;
}
.docx-menu-dropdown__separator {
  height: 1px;
  background: #e5e7eb;
  margin: 4px 0;
}
</style>
