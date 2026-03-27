/**
 * Keyboard Shortcuts Dialog Component
 *
 * Displays all available keyboard shortcuts organized by category.
 * Features:
 * - Categorized shortcut list
 * - Search/filter functionality
 * - Platform-aware modifier keys (Ctrl/Cmd)
 * - Keyboard shortcut to open (Ctrl+/)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what the shortcut does */
  description: string;
  /** Primary key combination (e.g., 'Ctrl+C') */
  keys: string;
  /** Alternative key combination */
  altKeys?: string;
  /** Category for grouping */
  category: ShortcutCategory;
  /** Whether this is a common/frequently used shortcut */
  common?: boolean;
  /** Translation key for display name (used internally) */
  nameKey?: string;
  /** Translation key for description (used internally) */
  descriptionKey?: string;
}

/**
 * Shortcut category
 */
export type ShortcutCategory =
  | 'editing'
  | 'formatting'
  | 'navigation'
  | 'clipboard'
  | 'selection'
  | 'view'
  | 'file'
  | 'other';

/**
 * Dialog props
 */
export interface KeyboardShortcutsDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Custom shortcuts (merged with defaults) */
  customShortcuts?: KeyboardShortcut[];
  /** Whether to show search */
  showSearch?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * Hook options
 */
export interface UseKeyboardShortcutsDialogOptions {
  /** Whether the dialog can be opened with Ctrl+? or F1 */
  enabled?: boolean;
  /** Custom open shortcut (default: Ctrl+/) */
  openShortcut?: string;
}

/**
 * Hook return value
 */
export interface UseKeyboardShortcutsDialogReturn {
  /** Whether dialog is open */
  isOpen: boolean;
  /** Open the dialog */
  open: () => void;
  /** Close the dialog */
  close: () => void;
  /** Toggle the dialog */
  toggle: () => void;
  /** Keyboard event handler */
  handleKeyDown: (event: KeyboardEvent) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Category label translation keys
 */
const CATEGORY_LABEL_KEYS: Record<ShortcutCategory, string> = {
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
const CATEGORY_ORDER: ShortcutCategory[] = [
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
const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Detect if running on Mac
 */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/**
 * Format key combination for current platform
 */
function formatKeys(keys: string): string {
  if (isMac()) {
    return keys
      .replace(/Ctrl\+/g, '\u2318')
      .replace(/Alt\+/g, '\u2325')
      .replace(/Shift\+/g, '\u21E7');
  }
  return keys;
}

// ============================================================================
// SHORTCUT ITEM COMPONENT
// ============================================================================

interface ShortcutItemProps {
  shortcut: KeyboardShortcut;
  translatedName: string;
  translatedDescription: string;
}

const ShortcutItem: React.FC<ShortcutItemProps> = ({
  shortcut,
  translatedName,
  translatedDescription,
}) => {
  const formattedKeys = formatKeys(shortcut.keys);
  const formattedAltKeys = shortcut.altKeys ? formatKeys(shortcut.altKeys) : null;

  return (
    <div
      className="docx-shortcut-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid var(--doc-border-light)',
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--doc-text)',
          }}
        >
          {translatedName}
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--doc-text-muted)',
            marginTop: '2px',
          }}
        >
          {translatedDescription}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <kbd
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            color: 'var(--doc-text)',
            backgroundColor: 'var(--doc-bg-hover)',
            borderRadius: '4px',
            border: '1px solid var(--doc-border-light)',
            boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
          }}
        >
          {formattedKeys}
        </kbd>
        {formattedAltKeys && (
          <>
            <span style={{ color: 'var(--doc-text-subtle)', fontSize: '11px' }}>or</span>
            <kbd
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                fontSize: '12px',
                fontFamily: 'monospace',
                color: 'var(--doc-text)',
                backgroundColor: 'var(--doc-bg-hover)',
                borderRadius: '4px',
                border: '1px solid var(--doc-border-light)',
                boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
              }}
            >
              {formattedAltKeys}
            </kbd>
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// KEYBOARD SHORTCUTS DIALOG COMPONENT
// ============================================================================

export const KeyboardShortcutsDialog: React.FC<KeyboardShortcutsDialogProps> = ({
  isOpen,
  onClose,
  customShortcuts = [],
  showSearch = true,
  className = '',
}) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Merge custom shortcuts with defaults
  const allShortcuts = useMemo(() => {
    const merged = [...DEFAULT_SHORTCUTS];
    for (const custom of customShortcuts) {
      const existingIndex = merged.findIndex((s) => s.id === custom.id);
      if (existingIndex >= 0) {
        merged[existingIndex] = custom;
      } else {
        merged.push(custom);
      }
    }
    return merged;
  }, [customShortcuts]);

  // Filter shortcuts by search query (searches translated name/description)
  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) return allShortcuts;

    const query = searchQuery.toLowerCase();
    return allShortcuts.filter((s) => {
      const name = s.nameKey ? t(s.nameKey as Parameters<typeof t>[0]) : s.name;
      const description = s.descriptionKey
        ? t(s.descriptionKey as Parameters<typeof t>[0])
        : s.description;
      return (
        name.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query) ||
        s.keys.toLowerCase().includes(query) ||
        (s.altKeys && s.altKeys.toLowerCase().includes(query))
      );
    });
  }, [allShortcuts, searchQuery, t]);

  // Group shortcuts by category
  const groupedShortcuts = useMemo(() => {
    const groups = new Map<ShortcutCategory, KeyboardShortcut[]>();

    for (const shortcut of filteredShortcuts) {
      const existing = groups.get(shortcut.category) || [];
      existing.push(shortcut);
      groups.set(shortcut.category, existing);
    }

    // Sort by category order
    const sorted: Array<{ category: ShortcutCategory; shortcuts: KeyboardShortcut[] }> = [];
    for (const category of CATEGORY_ORDER) {
      const shortcuts = groups.get(category);
      if (shortcuts && shortcuts.length > 0) {
        sorted.push({ category, shortcuts });
      }
    }

    return sorted;
  }, [filteredShortcuts]);

  // Focus search on open
  useEffect(() => {
    if (isOpen && showSearch && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen, showSearch]);

  // Reset search on close
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="docx-shortcuts-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        ref={dialogRef}
        className={`docx-shortcuts-dialog ${className}`}
        style={{
          width: '600px',
          maxWidth: '90vw',
          maxHeight: '80vh',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        role="dialog"
        aria-label={t('dialogs.keyboardShortcuts.ariaLabel')}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--doc-border)',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--doc-text)',
            }}
          >
            {t('dialogs.keyboardShortcuts.ariaLabel')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.closeDialog')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: '50%',
              color: 'var(--doc-text-muted)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Search */}
        {showSearch && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--doc-border)' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('dialogs.keyboardShortcuts.searchPlaceholder')}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                border: '1px solid var(--doc-border-light)',
                borderRadius: '6px',
                outline: 'none',
              }}
            />
          </div>
        )}

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
          }}
        >
          {groupedShortcuts.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px',
                color: 'var(--doc-text-muted)',
              }}
            >
              {t('dialogs.keyboardShortcuts.noResults', { query: searchQuery })}
            </div>
          ) : (
            groupedShortcuts.map(({ category, shortcuts }) => (
              <div key={category} style={{ marginBottom: '24px' }}>
                <h3
                  style={{
                    margin: '0 0 12px 0',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--doc-primary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t(CATEGORY_LABEL_KEYS[category] as Parameters<typeof t>[0])}
                </h3>
                <div>
                  {shortcuts.map((shortcut) => (
                    <ShortcutItem
                      key={shortcut.id}
                      shortcut={shortcut}
                      translatedName={
                        shortcut.nameKey
                          ? t(shortcut.nameKey as Parameters<typeof t>[0])
                          : shortcut.name
                      }
                      translatedDescription={
                        shortcut.descriptionKey
                          ? t(shortcut.descriptionKey as Parameters<typeof t>[0])
                          : shortcut.description
                      }
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--doc-border)',
            backgroundColor: 'var(--doc-bg)',
            fontSize: '12px',
            color: 'var(--doc-text-muted)',
            textAlign: 'center',
          }}
        >
          {(() => {
            const text = t('dialogs.keyboardShortcuts.pressEscToClose', { key: 'Esc' });
            const parts = text.split('Esc');
            return (
              <>
                {parts[0]}
                <kbd
                  style={{
                    padding: '2px 6px',
                    backgroundColor: 'white',
                    borderRadius: '4px',
                    border: '1px solid var(--doc-border-light)',
                  }}
                >
                  Esc
                </kbd>
                {parts[1]}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// HOOK FOR KEYBOARD SHORTCUTS DIALOG
// ============================================================================

/**
 * Hook to manage keyboard shortcuts dialog
 */
export function useKeyboardShortcutsDialog(
  options: UseKeyboardShortcutsDialogOptions = {}
): UseKeyboardShortcutsDialogReturn {
  const { enabled = true, openShortcut: _openShortcut = 'Ctrl+/' } = options;
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    if (enabled) setIsOpen(true);
  }, [enabled]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      const isCtrlOrMeta = event.ctrlKey || event.metaKey;

      // Ctrl+/ or Ctrl+? to open
      if (isCtrlOrMeta && (event.key === '/' || event.key === '?')) {
        event.preventDefault();
        toggle();
        return;
      }

      // F1 to open
      if (event.key === 'F1') {
        event.preventDefault();
        open();
        return;
      }
    },
    [enabled, toggle, open]
  );

  // Set up global keyboard listener
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);

  return {
    isOpen,
    open,
    close,
    toggle,
    handleKeyDown,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

/**
 * Format shortcut keys for display
 */
export function formatShortcutKeys(keys: string): string {
  return formatKeys(keys);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default KeyboardShortcutsDialog;
