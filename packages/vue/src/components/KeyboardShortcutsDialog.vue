<template>
  <div v-if="isOpen" class="kbd-overlay" @mousedown.self="close">
    <div class="kbd-dialog" @mousedown.stop @keydown.stop>
      <div class="kbd-dialog__header">
        <span class="kbd-dialog__title">Keyboard Shortcuts</span>
        <button class="kbd-dialog__close" @click="close">&#x2715;</button>
      </div>

      <div class="kbd-dialog__search" v-if="showSearch">
        <input
          ref="searchInput"
          v-model="searchQuery"
          class="kbd-dialog__search-input"
          placeholder="Search shortcuts..."
          type="text"
        />
      </div>

      <div class="kbd-dialog__body">
        <template v-for="cat in filteredCategories" :key="cat.name">
          <div class="kbd-category">{{ cat.label }}</div>
          <div
            v-for="s in cat.shortcuts"
            :key="s.id"
            class="kbd-item"
          >
            <div class="kbd-item__info">
              <span class="kbd-item__name">{{ s.name }}</span>
              <span class="kbd-item__desc">{{ s.description }}</span>
            </div>
            <div class="kbd-item__keys">
              <kbd class="kbd-badge">{{ formatKeys(s.keys) }}</kbd>
              <template v-if="s.altKeys">
                <span class="kbd-or">or</span>
                <kbd class="kbd-badge">{{ formatKeys(s.altKeys) }}</kbd>
              </template>
            </div>
          </div>
        </template>
        <div v-if="filteredCategories.length === 0" class="kbd-dialog__empty">
          No shortcuts match your search
        </div>
      </div>

      <div class="kbd-dialog__footer">
        Press <kbd class="kbd-badge kbd-badge--small">Esc</kbd> to close
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

interface KeyboardShortcut {
  id: string;
  name: string;
  description: string;
  keys: string;
  altKeys?: string;
  category: string;
}

const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    showSearch?: boolean;
  }>(),
  { showSearch: true }
);

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const searchInput = ref<HTMLInputElement | null>(null);
const searchQuery = ref('');

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

function formatKeys(keys: string): string {
  if (isMac) {
    return keys
      .replace(/Ctrl/g, '\u2318')
      .replace(/Alt/g, '\u2325')
      .replace(/Shift/g, '\u21E7');
  }
  return keys;
}

function close() {
  searchQuery.value = '';
  emit('close');
}

// Focus search input when opened
watch(() => props.isOpen, (open) => {
  if (open) {
    nextTick(() => searchInput.value?.focus());
  }
});

const defaultShortcuts: KeyboardShortcut[] = [
  // Editing
  { id: 'undo', name: 'Undo', description: 'Undo last action', keys: 'Ctrl+Z', category: 'Editing' },
  { id: 'redo', name: 'Redo', description: 'Redo last action', keys: 'Ctrl+Y', altKeys: 'Ctrl+Shift+Z', category: 'Editing' },
  { id: 'find', name: 'Find', description: 'Open find dialog', keys: 'Ctrl+F', category: 'Editing' },
  { id: 'replace', name: 'Find & Replace', description: 'Open find and replace', keys: 'Ctrl+H', category: 'Editing' },
  { id: 'delete', name: 'Delete', description: 'Delete selected content', keys: 'Del', altKeys: 'Backspace', category: 'Editing' },

  // Clipboard
  { id: 'cut', name: 'Cut', description: 'Cut selection', keys: 'Ctrl+X', category: 'Clipboard' },
  { id: 'copy', name: 'Copy', description: 'Copy selection', keys: 'Ctrl+C', category: 'Clipboard' },
  { id: 'paste', name: 'Paste', description: 'Paste content', keys: 'Ctrl+V', category: 'Clipboard' },

  // Formatting
  { id: 'bold', name: 'Bold', description: 'Toggle bold', keys: 'Ctrl+B', category: 'Formatting' },
  { id: 'italic', name: 'Italic', description: 'Toggle italic', keys: 'Ctrl+I', category: 'Formatting' },
  { id: 'underline', name: 'Underline', description: 'Toggle underline', keys: 'Ctrl+U', category: 'Formatting' },
  { id: 'strike', name: 'Strikethrough', description: 'Toggle strikethrough', keys: 'Ctrl+Shift+X', category: 'Formatting' },
  { id: 'subscript', name: 'Subscript', description: 'Toggle subscript', keys: 'Ctrl+=', category: 'Formatting' },
  { id: 'superscript', name: 'Superscript', description: 'Toggle superscript', keys: 'Ctrl+Shift+=', category: 'Formatting' },
  { id: 'alignLeft', name: 'Align Left', description: 'Left alignment', keys: 'Ctrl+L', category: 'Formatting' },
  { id: 'alignCenter', name: 'Align Center', description: 'Center alignment', keys: 'Ctrl+E', category: 'Formatting' },
  { id: 'alignRight', name: 'Align Right', description: 'Right alignment', keys: 'Ctrl+R', category: 'Formatting' },
  { id: 'justify', name: 'Justify', description: 'Justify alignment', keys: 'Ctrl+J', category: 'Formatting' },
  { id: 'indent', name: 'Increase Indent', description: 'Increase indent level', keys: 'Tab', category: 'Formatting' },
  { id: 'outdent', name: 'Decrease Indent', description: 'Decrease indent level', keys: 'Shift+Tab', category: 'Formatting' },
  { id: 'link', name: 'Insert Link', description: 'Insert or edit hyperlink', keys: 'Ctrl+K', category: 'Formatting' },

  // Selection
  { id: 'selectAll', name: 'Select All', description: 'Select all content', keys: 'Ctrl+A', category: 'Selection' },
  { id: 'selectWord', name: 'Select Word', description: 'Select current word', keys: 'Double-click', category: 'Selection' },
  { id: 'selectPara', name: 'Select Paragraph', description: 'Select current paragraph', keys: 'Triple-click', category: 'Selection' },

  // Navigation
  { id: 'moveWord', name: 'Move by Word', description: 'Jump to next/previous word', keys: 'Ctrl+Arrow', category: 'Navigation' },
  { id: 'lineStart', name: 'Line Start', description: 'Move to start of line', keys: 'Home', category: 'Navigation' },
  { id: 'lineEnd', name: 'Line End', description: 'Move to end of line', keys: 'End', category: 'Navigation' },
  { id: 'docStart', name: 'Document Start', description: 'Move to start of document', keys: 'Ctrl+Home', category: 'Navigation' },
  { id: 'docEnd', name: 'Document End', description: 'Move to end of document', keys: 'Ctrl+End', category: 'Navigation' },

  // View
  { id: 'zoomIn', name: 'Zoom In', description: 'Increase zoom level', keys: 'Ctrl++', altKeys: 'Ctrl+=', category: 'View' },
  { id: 'zoomOut', name: 'Zoom Out', description: 'Decrease zoom level', keys: 'Ctrl+-', category: 'View' },
  { id: 'zoomReset', name: 'Reset Zoom', description: 'Reset to 100% zoom', keys: 'Ctrl+0', category: 'View' },
  { id: 'shortcuts', name: 'Keyboard Shortcuts', description: 'Show this dialog', keys: 'Ctrl+/', altKeys: 'F1', category: 'View' },
];

const categoryOrder = ['Editing', 'Clipboard', 'Formatting', 'Selection', 'Navigation', 'View'];

const filteredCategories = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  const groups: { name: string; label: string; shortcuts: KeyboardShortcut[] }[] = [];

  for (const cat of categoryOrder) {
    let shortcuts = defaultShortcuts.filter(s => s.category === cat);
    if (q) {
      shortcuts = shortcuts.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.keys.toLowerCase().includes(q) ||
        (s.altKeys && s.altKeys.toLowerCase().includes(q))
      );
    }
    if (shortcuts.length > 0) {
      groups.push({ name: cat, label: cat.toUpperCase(), shortcuts });
    }
  }
  return groups;
});
</script>

<style scoped>
.kbd-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 300; display: flex; align-items: center; justify-content: center; }
.kbd-dialog { background: #fff; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); width: 520px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; }
.kbd-dialog__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.kbd-dialog__title { font-weight: 600; font-size: 14px; color: #1f2937; }
.kbd-dialog__close { border: none; background: transparent; cursor: pointer; font-size: 14px; color: #6b7280; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
.kbd-dialog__close:hover { background: #f3f4f6; }
.kbd-dialog__search { padding: 8px 16px; border-bottom: 1px solid #e5e7eb; }
.kbd-dialog__search-input { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; outline: none; }
.kbd-dialog__search-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
.kbd-dialog__body { flex: 1; overflow-y: auto; padding: 8px 0; }
.kbd-dialog__empty { padding: 24px 16px; text-align: center; color: #9ca3af; font-size: 13px; }
.kbd-dialog__footer { padding: 8px 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af; }

.kbd-category { padding: 8px 16px 4px; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
.kbd-item { display: flex; align-items: center; justify-content: space-between; padding: 5px 16px; }
.kbd-item:hover { background: #f9fafb; }
.kbd-item__info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.kbd-item__name { font-size: 13px; color: #1f2937; font-weight: 500; }
.kbd-item__desc { font-size: 11px; color: #9ca3af; }
.kbd-item__keys { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.kbd-or { font-size: 11px; color: #9ca3af; }
.kbd-badge { display: inline-block; padding: 2px 6px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4px; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #374151; white-space: nowrap; }
.kbd-badge--small { padding: 1px 4px; font-size: 10px; }
</style>
