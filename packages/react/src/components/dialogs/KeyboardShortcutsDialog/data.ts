/**
 * Keyboard-shortcut catalog — categorized list of every shortcut surfaced
 * in the KeyboardShortcutsDialog, plus the lookup helpers that filter and
 * label them.
 */

import type { TranslationKey } from '../../../i18n';
import type { KeyboardShortcut, ShortcutCategory } from '../KeyboardShortcutsDialog';

/**
 * Category label translation keys
 */
export const CATEGORY_LABEL_KEYS: Record<ShortcutCategory, TranslationKey> = {
  editing: 'dialogs.keyboardShortcuts.categories.editing',
  formatting: 'dialogs.keyboardShortcuts.categories.formatting',
  navigation: 'dialogs.keyboardShortcuts.categories.navigation',
  clipboard: 'dialogs.keyboardShortcuts.categories.clipboard',
  selection: 'dialogs.keyboardShortcuts.categories.selection',
  view: 'dialogs.keyboardShortcuts.categories.view',
  file: 'dialogs.keyboardShortcuts.categories.file',
  other: 'dialogs.keyboardShortcuts.categories.other',
};

/**
 * Category order for display
 */
export const CATEGORY_ORDER: ShortcutCategory[] = [
  'file',
  'editing',
  'clipboard',
  'formatting',
  'selection',
  'navigation',
  'view',
  'other',
];

/**
 * Default keyboard shortcuts (with translation keys for name/description)
 */
export const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  // File
  {
    id: 'save',
    name: 'Save',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.save',
    description: 'Save document',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.saveDescription',
    keys: 'Ctrl+S',
    category: 'file',
    common: true,
  },
  {
    id: 'print',
    name: 'Print',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.print',
    description: 'Print document',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.printDescription',
    keys: 'Ctrl+P',
    category: 'file',
  },

  // Editing
  {
    id: 'undo',
    name: 'Undo',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.undo',
    description: 'Undo last action',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.undoDescription',
    keys: 'Ctrl+Z',
    category: 'editing',
    common: true,
  },
  {
    id: 'redo',
    name: 'Redo',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.redo',
    description: 'Redo last action',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.redoDescription',
    keys: 'Ctrl+Y',
    altKeys: 'Ctrl+Shift+Z',
    category: 'editing',
    common: true,
  },
  {
    id: 'delete',
    name: 'Delete',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.delete',
    description: 'Delete selected text',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.deleteDescription',
    keys: 'Del',
    altKeys: 'Backspace',
    category: 'editing',
  },
  {
    id: 'find',
    name: 'Find',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.find',
    description: 'Find text in document',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.findDescription',
    keys: 'Ctrl+F',
    category: 'editing',
    common: true,
  },
  {
    id: 'replace',
    name: 'Find & Replace',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.findReplace',
    description: 'Find and replace text',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.findReplaceDescription',
    keys: 'Ctrl+H',
    category: 'editing',
  },

  // Clipboard
  {
    id: 'cut',
    name: 'Cut',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.cut',
    description: 'Cut selected text',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.cutDescription',
    keys: 'Ctrl+X',
    category: 'clipboard',
    common: true,
  },
  {
    id: 'copy',
    name: 'Copy',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.copy',
    description: 'Copy selected text',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.copyDescription',
    keys: 'Ctrl+C',
    category: 'clipboard',
    common: true,
  },
  {
    id: 'paste',
    name: 'Paste',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.paste',
    description: 'Paste from clipboard',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.pasteDescription',
    keys: 'Ctrl+V',
    category: 'clipboard',
    common: true,
  },
  {
    id: 'paste-plain',
    name: 'Paste as Plain Text',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.pastePlainText',
    description: 'Paste without formatting',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.pastePlainTextDescription',
    keys: 'Ctrl+Shift+V',
    category: 'clipboard',
  },

  // Formatting
  {
    id: 'bold',
    name: 'Bold',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.bold',
    description: 'Toggle bold formatting',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.boldDescription',
    keys: 'Ctrl+B',
    category: 'formatting',
    common: true,
  },
  {
    id: 'italic',
    name: 'Italic',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.italic',
    description: 'Toggle italic formatting',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.italicDescription',
    keys: 'Ctrl+I',
    category: 'formatting',
    common: true,
  },
  {
    id: 'underline',
    name: 'Underline',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.underline',
    description: 'Toggle underline formatting',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.underlineDescription',
    keys: 'Ctrl+U',
    category: 'formatting',
    common: true,
  },
  {
    id: 'strikethrough',
    name: 'Strikethrough',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.strikethrough',
    description: 'Toggle strikethrough',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.strikethroughDescription',
    keys: 'Ctrl+Shift+X',
    category: 'formatting',
  },
  {
    id: 'subscript',
    name: 'Subscript',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.subscript',
    description: 'Toggle subscript',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.subscriptDescription',
    keys: 'Ctrl+=',
    category: 'formatting',
  },
  {
    id: 'superscript',
    name: 'Superscript',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.superscript',
    description: 'Toggle superscript',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.superscriptDescription',
    keys: 'Ctrl+Shift+=',
    category: 'formatting',
  },
  {
    id: 'align-left',
    name: 'Align Left',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.alignLeft',
    description: 'Left align paragraph',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.alignLeftDescription',
    keys: 'Ctrl+L',
    category: 'formatting',
  },
  {
    id: 'align-center',
    name: 'Align Center',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.alignCenter',
    description: 'Center align paragraph',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.alignCenterDescription',
    keys: 'Ctrl+E',
    category: 'formatting',
  },
  {
    id: 'align-right',
    name: 'Align Right',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.alignRight',
    description: 'Right align paragraph',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.alignRightDescription',
    keys: 'Ctrl+R',
    category: 'formatting',
  },
  {
    id: 'align-justify',
    name: 'Justify',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.justify',
    description: 'Justify paragraph',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.justifyDescription',
    keys: 'Ctrl+J',
    category: 'formatting',
  },
  {
    id: 'indent',
    name: 'Increase Indent',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.increaseIndent',
    description: 'Increase paragraph indent',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.increaseIndentDescription',
    keys: 'Tab',
    category: 'formatting',
  },
  {
    id: 'outdent',
    name: 'Decrease Indent',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.decreaseIndent',
    description: 'Decrease paragraph indent',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.decreaseIndentDescription',
    keys: 'Shift+Tab',
    category: 'formatting',
  },

  // Selection
  {
    id: 'select-all',
    name: 'Select All',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.selectAll',
    description: 'Select all content',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.selectAllDescription',
    keys: 'Ctrl+A',
    category: 'selection',
    common: true,
  },
  {
    id: 'select-word',
    name: 'Select Word',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.selectWord',
    description: 'Select current word',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.selectWordDescription',
    keys: 'Double-click',
    category: 'selection',
  },
  {
    id: 'select-paragraph',
    name: 'Select Paragraph',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.selectParagraph',
    description: 'Select current paragraph',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.selectParagraphDescription',
    keys: 'Triple-click',
    category: 'selection',
  },
  {
    id: 'extend-selection-word',
    name: 'Extend Selection by Word',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.extendSelectionByWord',
    description: 'Extend selection to next/previous word',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.extendSelectionByWordDescription',
    keys: 'Ctrl+Shift+Arrow',
    category: 'selection',
  },
  {
    id: 'extend-selection-line',
    name: 'Extend Selection to Line Edge',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.extendSelectionToLineEdge',
    description: 'Extend selection to line start/end',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.extendSelectionToLineEdgeDescription',
    keys: 'Shift+Home/End',
    category: 'selection',
  },

  // Navigation
  {
    id: 'move-word',
    name: 'Move by Word',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveByWord',
    description: 'Move cursor to next/previous word',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveByWordDescription',
    keys: 'Ctrl+Arrow',
    category: 'navigation',
  },
  {
    id: 'move-line-start',
    name: 'Move to Line Start',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveToLineStart',
    description: 'Move cursor to start of line',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveToLineStartDescription',
    keys: 'Home',
    category: 'navigation',
  },
  {
    id: 'move-line-end',
    name: 'Move to Line End',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveToLineEnd',
    description: 'Move cursor to end of line',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveToLineEndDescription',
    keys: 'End',
    category: 'navigation',
  },
  {
    id: 'move-doc-start',
    name: 'Move to Document Start',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveToDocumentStart',
    description: 'Move cursor to start of document',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveToDocumentStartDescription',
    keys: 'Ctrl+Home',
    category: 'navigation',
  },
  {
    id: 'move-doc-end',
    name: 'Move to Document End',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.moveToDocumentEnd',
    description: 'Move cursor to end of document',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.moveToDocumentEndDescription',
    keys: 'Ctrl+End',
    category: 'navigation',
  },
  {
    id: 'page-up',
    name: 'Page Up',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.pageUp',
    description: 'Scroll up one page',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.pageUpDescription',
    keys: 'Page Up',
    category: 'navigation',
  },
  {
    id: 'page-down',
    name: 'Page Down',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.pageDown',
    description: 'Scroll down one page',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.pageDownDescription',
    keys: 'Page Down',
    category: 'navigation',
  },

  // View
  {
    id: 'zoom-in',
    name: 'Zoom In',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.zoomIn',
    description: 'Increase zoom level',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.zoomInDescription',
    keys: 'Ctrl++',
    altKeys: 'Ctrl+Scroll Up',
    category: 'view',
  },
  {
    id: 'zoom-out',
    name: 'Zoom Out',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.zoomOut',
    description: 'Decrease zoom level',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.zoomOutDescription',
    keys: 'Ctrl+-',
    altKeys: 'Ctrl+Scroll Down',
    category: 'view',
  },
  {
    id: 'zoom-reset',
    name: 'Reset Zoom',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.resetZoom',
    description: 'Reset zoom to 100%',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.resetZoomDescription',
    keys: 'Ctrl+0',
    category: 'view',
  },
  {
    id: 'shortcuts',
    name: 'Keyboard Shortcuts',
    nameKey: 'dialogs.keyboardShortcuts.shortcuts.keyboardShortcuts',
    description: 'Show this help dialog',
    descriptionKey: 'dialogs.keyboardShortcuts.shortcuts.keyboardShortcutsDescription',
    keys: 'Ctrl+/',
    altKeys: 'F1',
    category: 'view',
  },
];

/**
 * Get all default shortcuts
 */
export function getDefaultShortcuts(): KeyboardShortcut[] {
  return [...DEFAULT_SHORTCUTS];
}

/**
 * Get shortcuts by category
 */
export function getShortcutsByCategory(category: ShortcutCategory): KeyboardShortcut[] {
  return DEFAULT_SHORTCUTS.filter((s) => s.category === category);
}

/**
 * Get common/frequently used shortcuts
 */
export function getCommonShortcuts(): KeyboardShortcut[] {
  return DEFAULT_SHORTCUTS.filter((s) => s.common);
}

/**
 * Get category label translation key
 */
export function getCategoryLabel(category: ShortcutCategory): string {
  return CATEGORY_LABEL_KEYS[category];
}

/**
 * Get all categories
 */
export function getAllCategories(): ShortcutCategory[] {
  return [...CATEGORY_ORDER];
}
