<template>
  <div v-if="isOpen" class="kbd-overlay" @mousedown.self="close">
    <div class="kbd-dialog" @mousedown.stop @keydown.stop>
      <div class="kbd-dialog__header">
        <span class="kbd-dialog__title">{{ t('dialogs.keyboardShortcuts.ariaLabel') }}</span>
        <button class="kbd-dialog__close" :aria-label="t('common.closeDialog')" @click="close">
          &#x2715;
        </button>
      </div>

      <div class="kbd-dialog__search" v-if="showSearch">
        <input
          ref="searchInput"
          v-model="searchQuery"
          class="kbd-dialog__search-input"
          :placeholder="t('dialogs.keyboardShortcuts.searchPlaceholder')"
          type="text"
        />
      </div>

      <div class="kbd-dialog__body">
        <template v-for="cat in filteredCategories" :key="cat.name">
          <div class="kbd-category">{{ t(cat.labelKey).toUpperCase() }}</div>
          <div v-for="s in cat.shortcuts" :key="s.id" class="kbd-item">
            <div class="kbd-item__info">
              <span class="kbd-item__name">{{ s.nameKey ? t(s.nameKey) : s.name }}</span>
              <span class="kbd-item__desc">{{
                s.descriptionKey ? t(s.descriptionKey) : s.description
              }}</span>
            </div>
            <div class="kbd-item__keys">
              <kbd class="kbd-badge">{{ formatKeys(s.keys) }}</kbd>
              <template v-if="s.altKeys">
                <span class="kbd-or">{{ t('dialogs.keyboardShortcuts.or') }}</span>
                <kbd class="kbd-badge">{{ formatKeys(s.altKeys) }}</kbd>
              </template>
            </div>
          </div>
        </template>
        <div v-if="filteredCategories.length === 0" class="kbd-dialog__empty">
          {{ t('dialogs.keyboardShortcuts.noResults', { query: searchQuery }) }}
        </div>
      </div>

      <div class="kbd-dialog__footer">
        <template v-for="(part, i) in escFooterParts" :key="i">
          <span>{{ part }}</span>
          <kbd v-if="i < escFooterParts.length - 1" class="kbd-badge kbd-badge--small">Esc</kbd>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslation } from '../../i18n';

const { t } = useTranslation();

interface KeyboardShortcut {
  id: string;
  /** i18n key for the shortcut name; falls back to `name` if absent */
  nameKey?: string;
  name: string;
  /** i18n key for the description; falls back to `description` if absent */
  descriptionKey?: string;
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
    return keys.replace(/Ctrl/g, '\u2318').replace(/Alt/g, '\u2325').replace(/Shift/g, '\u21E7');
  }
  return keys;
}

function close() {
  searchQuery.value = '';
  emit('close');
}

// Focus search input when opened
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      nextTick(() => searchInput.value?.focus());
    }
  }
);

const escFooterParts = computed(() =>
  t('dialogs.keyboardShortcuts.pressEscToClose', { key: 'Esc' }).split('Esc')
);

const defaultShortcuts: KeyboardShortcut[] = [
  // Editing
  {
    id: 'undo',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.undo',
    name: 'Undo',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.undoDescription',
    description: 'Undo last action',
    keys: 'Ctrl+Z',
    category: 'Editing',
  },
  {
    id: 'redo',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.redo',
    name: 'Redo',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.redoDescription',
    description: 'Redo last action',
    keys: 'Ctrl+Y',
    altKeys: 'Ctrl+Shift+Z',
    category: 'Editing',
  },
  {
    id: 'find',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.find',
    name: 'Find',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.findDescription',
    description: 'Open find dialog',
    keys: 'Ctrl+F',
    category: 'Editing',
  },
  {
    id: 'replace',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.findReplace',
    name: 'Find & Replace',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.findReplaceDescription',
    description: 'Open find and replace',
    keys: 'Ctrl+H',
    category: 'Editing',
  },
  {
    id: 'delete',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.delete',
    name: 'Delete',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.deleteDescription',
    description: 'Delete selected content',
    keys: 'Del',
    altKeys: 'Backspace',
    category: 'Editing',
  },

  // Clipboard
  {
    id: 'cut',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.cut',
    name: 'Cut',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.cutDescription',
    description: 'Cut selection',
    keys: 'Ctrl+X',
    category: 'Clipboard',
  },
  {
    id: 'copy',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.copy',
    name: 'Copy',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.copyDescription',
    description: 'Copy selection',
    keys: 'Ctrl+C',
    category: 'Clipboard',
  },
  {
    id: 'paste',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.paste',
    name: 'Paste',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.pasteDescription',
    description: 'Paste content',
    keys: 'Ctrl+V',
    category: 'Clipboard',
  },

  // Formatting
  {
    id: 'bold',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.bold',
    name: 'Bold',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.boldDescription',
    description: 'Toggle bold',
    keys: 'Ctrl+B',
    category: 'Formatting',
  },
  {
    id: 'italic',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.italic',
    name: 'Italic',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.italicDescription',
    description: 'Toggle italic',
    keys: 'Ctrl+I',
    category: 'Formatting',
  },
  {
    id: 'underline',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.underline',
    name: 'Underline',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.underlineDescription',
    description: 'Toggle underline',
    keys: 'Ctrl+U',
    category: 'Formatting',
  },
  {
    id: 'strike',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.strikethrough',
    name: 'Strikethrough',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.strikethroughDescription',
    description: 'Toggle strikethrough',
    keys: 'Ctrl+Shift+X',
    category: 'Formatting',
  },
  {
    id: 'subscript',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.subscript',
    name: 'Subscript',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.subscriptDescription',
    description: 'Toggle subscript',
    keys: 'Ctrl+=',
    category: 'Formatting',
  },
  {
    id: 'superscript',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.superscript',
    name: 'Superscript',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.superscriptDescription',
    description: 'Toggle superscript',
    keys: 'Ctrl+Shift+=',
    category: 'Formatting',
  },
  {
    id: 'alignLeft',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.alignLeft',
    name: 'Align Left',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.alignLeftDescription',
    description: 'Left alignment',
    keys: 'Ctrl+L',
    category: 'Formatting',
  },
  {
    id: 'alignCenter',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.alignCenter',
    name: 'Align Center',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.alignCenterDescription',
    description: 'Center alignment',
    keys: 'Ctrl+E',
    category: 'Formatting',
  },
  {
    id: 'alignRight',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.alignRight',
    name: 'Align Right',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.alignRightDescription',
    description: 'Right alignment',
    keys: 'Ctrl+R',
    category: 'Formatting',
  },
  {
    id: 'justify',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.justify',
    name: 'Justify',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.justifyDescription',
    description: 'Justify alignment',
    keys: 'Ctrl+J',
    category: 'Formatting',
  },
  {
    id: 'indent',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.increaseIndent',
    name: 'Increase Indent',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.increaseIndentDescription',
    description: 'Increase indent level',
    keys: 'Tab',
    category: 'Formatting',
  },
  {
    id: 'outdent',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.decreaseIndent',
    name: 'Decrease Indent',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.decreaseIndentDescription',
    description: 'Decrease indent level',
    keys: 'Shift+Tab',
    category: 'Formatting',
  },
  {
    id: 'link',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.insertLink',
    name: 'Insert Link',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.insertLinkDescription',
    description: 'Insert or edit hyperlink',
    keys: 'Ctrl+K',
    category: 'Formatting',
  },

  // Selection
  {
    id: 'selectAll',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.selectAll',
    name: 'Select All',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.selectAllDescription',
    description: 'Select all content',
    keys: 'Ctrl+A',
    category: 'Selection',
  },
  {
    id: 'selectWord',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.selectWord',
    name: 'Select Word',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.selectWordDescription',
    description: 'Select current word',
    keys: 'Double-click',
    category: 'Selection',
  },
  {
    id: 'selectPara',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.selectParagraph',
    name: 'Select Paragraph',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.selectParagraphDescription',
    description: 'Select current paragraph',
    keys: 'Triple-click',
    category: 'Selection',
  },

  // Navigation
  {
    id: 'moveWord',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveByWord',
    name: 'Move by Word',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveByWordDescription',
    description: 'Jump to next/previous word',
    keys: 'Ctrl+Arrow',
    category: 'Navigation',
  },
  {
    id: 'lineStart',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveToLineStart',
    name: 'Line Start',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveToLineStartDescription',
    description: 'Move to start of line',
    keys: 'Home',
    category: 'Navigation',
  },
  {
    id: 'lineEnd',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveToLineEnd',
    name: 'Line End',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveToLineEndDescription',
    description: 'Move to end of line',
    keys: 'End',
    category: 'Navigation',
  },
  {
    id: 'docStart',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveToDocumentStart',
    name: 'Document Start',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveToDocumentStartDescription',
    description: 'Move to start of document',
    keys: 'Ctrl+Home',
    category: 'Navigation',
  },
  {
    id: 'docEnd',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveToDocumentEnd',
    name: 'Document End',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveToDocumentEndDescription',
    description: 'Move to end of document',
    keys: 'Ctrl+End',
    category: 'Navigation',
  },

  // View
  {
    id: 'zoomIn',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.zoomIn',
    name: 'Zoom In',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.zoomInDescription',
    description: 'Increase zoom level',
    keys: 'Ctrl++',
    altKeys: 'Ctrl+=',
    category: 'View',
  },
  {
    id: 'zoomOut',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.zoomOut',
    name: 'Zoom Out',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.zoomOutDescription',
    description: 'Decrease zoom level',
    keys: 'Ctrl+-',
    category: 'View',
  },
  {
    id: 'zoomReset',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.resetZoom',
    name: 'Reset Zoom',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.resetZoomDescription',
    description: 'Reset to 100% zoom',
    keys: 'Ctrl+0',
    category: 'View',
  },
  {
    id: 'shortcuts',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.keyboardShortcuts',
    name: 'Keyboard Shortcuts',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.keyboardShortcutsDescription',
    description: 'Show this dialog',
    keys: 'Ctrl+/',
    altKeys: 'F1',
    category: 'View',
  },
];

const categoryLabelKeys: Record<string, string> = {
  Editing: 'dialogs.keyboardShortcuts.categories.editing',
  Clipboard: 'dialogs.keyboardShortcuts.categories.clipboard',
  Formatting: 'dialogs.keyboardShortcuts.categories.formatting',
  Selection: 'dialogs.keyboardShortcuts.categories.selection',
  Navigation: 'dialogs.keyboardShortcuts.categories.navigation',
  View: 'dialogs.keyboardShortcuts.categories.view',
};

const categoryOrder = ['Editing', 'Clipboard', 'Formatting', 'Selection', 'Navigation', 'View'];

const filteredCategories = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  const groups: { name: string; labelKey: string; shortcuts: KeyboardShortcut[] }[] = [];

  for (const cat of categoryOrder) {
    let shortcuts = defaultShortcuts.filter((s) => s.category === cat);
    if (q) {
      shortcuts = shortcuts.filter((s) => {
        const name = s.nameKey ? t(s.nameKey) : s.name;
        const description = s.descriptionKey ? t(s.descriptionKey) : s.description;
        return (
          name.toLowerCase().includes(q) ||
          description.toLowerCase().includes(q) ||
          s.keys.toLowerCase().includes(q) ||
          (s.altKeys != null && s.altKeys.toLowerCase().includes(q))
        );
      });
    }
    if (shortcuts.length > 0) {
      groups.push({ name: cat, labelKey: categoryLabelKeys[cat], shortcuts });
    }
  }
  return groups;
});
</script>

<style scoped>
.kbd-overlay {
  position: fixed;
  inset: 0;
  background: var(--doc-overlay);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kbd-dialog {
  background: var(--doc-surface);
  border-radius: 8px;
  box-shadow: 0 8px 30px var(--doc-shadow);
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.kbd-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--doc-border);
}
.kbd-dialog__title {
  font-weight: 600;
  font-size: 14px;
  color: var(--doc-text);
}
.kbd-dialog__close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--doc-text-muted);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.kbd-dialog__close:hover {
  background: var(--doc-bg-hover);
}
.kbd-dialog__search {
  padding: 8px 16px;
  border-bottom: 1px solid var(--doc-border);
}
.kbd-dialog__search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 13px;
  outline: none;
}
.kbd-dialog__search-input:focus {
  border-color: var(--doc-primary);
  box-shadow: 0 0 0 2px var(--doc-focus-ring);
}
.kbd-dialog__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.kbd-dialog__empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--doc-text-subtle);
  font-size: 13px;
}
.kbd-dialog__footer {
  padding: 8px 16px;
  border-top: 1px solid var(--doc-border);
  text-align: center;
  font-size: 12px;
  color: var(--doc-text-subtle);
}

.kbd-category {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--doc-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.kbd-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 16px;
}
.kbd-item:hover {
  background: var(--doc-bg);
}
.kbd-item__info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.kbd-item__name {
  font-size: 13px;
  color: var(--doc-text);
  font-weight: 500;
}
.kbd-item__desc {
  font-size: 11px;
  color: var(--doc-text-subtle);
}
.kbd-item__keys {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.kbd-or {
  font-size: 11px;
  color: var(--doc-text-subtle);
}
.kbd-badge {
  display: inline-block;
  padding: 2px 6px;
  background: var(--doc-bg-hover);
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--doc-text-muted);
  white-space: nowrap;
}
.kbd-badge--small {
  padding: 1px 4px;
  font-size: 10px;
}
</style>
