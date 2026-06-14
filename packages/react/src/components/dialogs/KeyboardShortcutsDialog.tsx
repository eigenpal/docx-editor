/**
 * Keyboard Shortcuts Dialog Component
 *
 * Displays all available keyboard shortcuts organized by category.
 * Features:
 * - Categorized shortcut list
 * - Search/filter functionality
 * - Platform-aware modifier keys (Ctrl/Cmd)
 * - Keyboard shortcut to open (Ctrl+/)
 *
 * The shortcut catalog and category metadata live in
 * `KeyboardShortcutsDialog/data.ts`. The per-row renderer and the
 * platform-aware key formatter live in `KeyboardShortcutsDialog/ShortcutItem.tsx`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '@eigenpal/docx-editor-i18n';
import {
  CATEGORY_LABEL_KEYS,
  CATEGORY_ORDER,
  DEFAULT_SHORTCUTS,
  getDefaultShortcuts,
  getShortcutsByCategory,
  getCommonShortcuts,
  getCategoryLabel,
  getAllCategories,
} from './KeyboardShortcutsDialog/data';
import { ShortcutItem } from './KeyboardShortcutsDialog/ShortcutItem';
export { formatKeys as formatShortcutKeys } from './KeyboardShortcutsDialog/ShortcutItem';

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
  nameKey?: TranslationKey;
  /** Translation key for description (used internally) */
  descriptionKey?: TranslationKey;
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
      const name = s.nameKey ? t(s.nameKey) : s.name;
      const description = s.descriptionKey ? t(s.descriptionKey) : s.description;
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
        backgroundColor: 'var(--doc-overlay)',
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
          backgroundColor: 'var(--doc-surface)',
          borderRadius: '12px',
          boxShadow: '0 4px 24px var(--doc-shadow)',
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
                  {t(CATEGORY_LABEL_KEYS[category])}
                </h3>
                <div>
                  {shortcuts.map((shortcut) => (
                    <ShortcutItem
                      key={shortcut.id}
                      shortcut={shortcut}
                      translatedName={shortcut.nameKey ? t(shortcut.nameKey) : shortcut.name}
                      translatedDescription={
                        shortcut.descriptionKey ? t(shortcut.descriptionKey) : shortcut.description
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
                    backgroundColor: 'var(--doc-surface)',
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
// PUBLIC RE-EXPORTS
// ============================================================================

export {
  getDefaultShortcuts,
  getShortcutsByCategory,
  getCommonShortcuts,
  getCategoryLabel,
  getAllCategories,
};

export default KeyboardShortcutsDialog;
