/**
 * Paste Special Dialog Component
 *
 * Provides paste options for pasting content with or without formatting.
 * Features:
 * - Paste with formatting (default)
 * - Paste as plain text (unformatted)
 * - Keyboard shortcut: Ctrl+Shift+V opens dialog
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedClipboardContent } from '@eigenpal/docx-core/utils/clipboard';
import { readFromClipboard } from '@eigenpal/docx-core/utils/clipboard';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Paste option type
 */
export type PasteOption = 'formatted' | 'plainText';

/**
 * Paste special dialog props
 */
export interface PasteSpecialDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when paste is confirmed */
  onPaste: (content: ParsedClipboardContent, asPlainText: boolean) => void;
  /** Optional custom position */
  position?: { x: number; y: number };
  /** Additional className */
  className?: string;
}

/**
 * Paste option item (with translation keys for label/description/shortcut)
 */
interface PasteOptionItem {
  id: PasteOption;
  label: string;
  description: string;
  shortcut: string;
}

/**
 * Paste option definition with translation keys
 */
interface PasteOptionDef {
  id: PasteOption;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  shortcutKey: TranslationKey;
}

/**
 * Hook return value for paste special
 */
export interface UsePasteSpecialReturn {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Open the paste special dialog */
  openDialog: () => void;
  /** Close the dialog */
  closeDialog: () => void;
  /** Handle keyboard shortcut (Ctrl+Shift+V) */
  handleKeyDown: (event: KeyboardEvent) => boolean;
  /** Paste as plain text directly */
  pasteAsPlainText: () => Promise<void>;
}

/**
 * Options for usePasteSpecial hook
 */
export interface UsePasteSpecialOptions {
  /** Callback when paste is confirmed */
  onPaste?: (content: ParsedClipboardContent, asPlainText: boolean) => void;
  /** Whether paste operations are enabled */
  enabled?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Available paste options (using translation keys)
 */
const PASTE_OPTION_DEFS: PasteOptionDef[] = [
  {
    id: 'formatted',
    labelKey: 'dialogs.pasteSpecial.keepFormatting',
    descriptionKey: 'dialogs.pasteSpecial.keepFormattingDescription',
    shortcutKey: 'dialogs.pasteSpecial.keepFormattingShortcut',
  },
  {
    id: 'plainText',
    labelKey: 'dialogs.pasteSpecial.plainText',
    descriptionKey: 'dialogs.pasteSpecial.plainTextDescription',
    shortcutKey: 'dialogs.pasteSpecial.plainTextShortcut',
  },
];

// ============================================================================
// ICONS
// ============================================================================

const FormattedIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 4h12v2H4V4zM4 8h8v2H4V8zM4 12h10v2H4v-2zM4 16h6v2H4v-2z" fill="currentColor" />
    <path d="M14 10l3 3-3 3v-2h-2v-2h2v-2z" fill="currentColor" opacity="0.6" />
  </svg>
);

const PlainTextIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M4 4h12v1H4V4zM4 7h12v1H4V7zM4 10h12v1H4v-1zM4 13h12v1H4v-1zM4 16h8v1H4v-1z"
      fill="currentColor"
    />
  </svg>
);

/**
 * Get icon for paste option
 */
function getPasteOptionIcon(option: PasteOption): React.ReactNode {
  switch (option) {
    case 'formatted':
      return <FormattedIcon />;
    case 'plainText':
      return <PlainTextIcon />;
    default:
      return null;
  }
}

// ============================================================================
// PASTE OPTION ITEM COMPONENT
// ============================================================================

interface PasteOptionButtonProps {
  option: PasteOptionItem;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

const PasteOptionButton: React.FC<PasteOptionButtonProps> = ({
  option,
  isSelected,
  onClick,
  onMouseEnter,
}) => {
  return (
    <button
      type="button"
      className={`docx-paste-special-option ${isSelected ? 'docx-paste-special-option-selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="menuitem"
      aria-selected={isSelected}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        padding: '12px 16px',
        border: 'none',
        background: isSelected ? 'var(--doc-primary-light)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        borderRadius: '4px',
        transition: 'background-color 0.15s ease',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '4px',
          background: isSelected ? 'var(--doc-primary)' : 'var(--doc-bg-hover)',
          color: isSelected ? 'white' : 'var(--doc-text-muted)',
        }}
      >
        {getPasteOptionIcon(option.id)}
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--doc-text)',
            marginBottom: '2px',
          }}
        >
          {option.label}
        </div>
        <div
          style={{
            fontSize: '12px',
            color: 'var(--doc-text-muted)',
          }}
        >
          {option.description}
        </div>
      </div>
      <span
        style={{
          fontSize: '11px',
          color: 'var(--doc-text-subtle)',
          fontFamily: 'monospace',
        }}
      >
        {option.shortcut}
      </span>
    </button>
  );
};

// ============================================================================
// PASTE SPECIAL DIALOG COMPONENT
// ============================================================================

export const PasteSpecialDialog: React.FC<PasteSpecialDialogProps> = ({
  isOpen,
  onClose,
  onPaste,
  position,
  className = '',
}) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [clipboardContent, setClipboardContent] = useState<ParsedClipboardContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Translate paste options at render time
  const pasteOptions: PasteOptionItem[] = PASTE_OPTION_DEFS.map((def) => ({
    id: def.id,
    label: t(def.labelKey),
    description: t(def.descriptionKey),
    shortcut: t(def.shortcutKey),
  }));

  // Read clipboard content when dialog opens
  useEffect(() => {
    if (!isOpen) {
      setClipboardContent(null);
      setError(null);
      setSelectedIndex(0);
      return;
    }

    const loadClipboard = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const content = await readFromClipboard({ cleanWordFormatting: true });
        setClipboardContent(content);
        if (!content) {
          setError(t('dialogs.pasteSpecial.noContent'));
        }
      } catch {
        setError(t('dialogs.pasteSpecial.clipboardError'));
      } finally {
        setIsLoading(false);
      }
    };

    loadClipboard();
  }, [isOpen]);

  // Handle click outside to close
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

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % PASTE_OPTION_DEFS.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(
            (prev) => (prev - 1 + PASTE_OPTION_DEFS.length) % PASTE_OPTION_DEFS.length
          );
          break;
        case 'Enter':
          e.preventDefault();
          handlePaste(PASTE_OPTION_DEFS[selectedIndex].id);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, onClose]);

  const handlePaste = useCallback(
    (option: PasteOption) => {
      if (!clipboardContent) {
        setError(t('dialogs.pasteSpecial.noContent'));
        return;
      }

      const asPlainText = option === 'plainText';
      onPaste(clipboardContent, asPlainText);
      onClose();
    },
    [clipboardContent, onPaste, onClose]
  );

  // Calculate dialog position
  const getDialogStyle = useCallback((): React.CSSProperties => {
    const dialogWidth = 320;
    const dialogHeight = 200;

    let x =
      position?.x ??
      (typeof window !== 'undefined' ? window.innerWidth / 2 - dialogWidth / 2 : 100);
    let y =
      position?.y ??
      (typeof window !== 'undefined' ? window.innerHeight / 2 - dialogHeight / 2 : 100);

    // Adjust for viewport boundaries
    if (typeof window !== 'undefined') {
      if (x + dialogWidth > window.innerWidth) {
        x = window.innerWidth - dialogWidth - 10;
      }
      if (y + dialogHeight > window.innerHeight) {
        y = window.innerHeight - dialogHeight - 10;
      }
      if (x < 10) x = 10;
      if (y < 10) y = 10;
    }

    return {
      position: 'fixed',
      top: y,
      left: x,
      width: dialogWidth,
      background: 'white',
      border: '1px solid var(--doc-border-light)',
      borderRadius: '8px',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
      zIndex: 10001,
      overflow: 'hidden',
    };
  }, [position]);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      className={`docx-paste-special-dialog ${className}`}
      style={getDialogStyle()}
      role="dialog"
      aria-label={t('dialogs.pasteSpecial.title')}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--doc-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--doc-text)',
          }}
        >
          {t('dialogs.pasteSpecial.title')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.closeDialog')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            borderRadius: '4px',
            color: 'var(--doc-text-muted)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '8px' }}>
        {isLoading ? (
          <div
            style={{
              padding: '20px',
              textAlign: 'center',
              color: 'var(--doc-text-muted)',
              fontSize: '13px',
            }}
          >
            {t('dialogs.pasteSpecial.readingClipboard')}
          </div>
        ) : error ? (
          <div
            style={{
              padding: '20px',
              textAlign: 'center',
              color: 'var(--doc-error)',
              fontSize: '13px',
            }}
          >
            {error}
          </div>
        ) : (
          <div role="menu">
            {pasteOptions.map((option, index) => (
              <PasteOptionButton
                key={option.id}
                option={option}
                isSelected={index === selectedIndex}
                onClick={() => handlePaste(option.id)}
                onMouseEnter={() => setSelectedIndex(index)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Clipboard preview */}
      {clipboardContent && !isLoading && !error && (
        <div
          style={{
            padding: '8px 16px 12px',
            borderTop: '1px solid var(--doc-border)',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              color: 'var(--doc-text-muted)',
              marginBottom: '4px',
            }}
          >
            {t('dialogs.pasteSpecial.preview')}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--doc-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              padding: '6px 8px',
              background: 'var(--doc-bg)',
              borderRadius: '4px',
            }}
          >
            "{clipboardContent.plainText.slice(0, 50)}
            {clipboardContent.plainText.length > 50 ? '...' : ''}"
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// HOOK FOR PASTE SPECIAL
// ============================================================================

/**
 * Hook to manage paste special dialog
 */
export function usePasteSpecial(options: UsePasteSpecialOptions = {}): UsePasteSpecialReturn {
  const { onPaste, enabled = true } = options;
  const [isOpen, setIsOpen] = useState(false);

  const openDialog = useCallback(() => {
    if (enabled) {
      setIsOpen(true);
    }
  }, [enabled]);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
  }, []);

  /**
   * Paste as plain text directly (without dialog)
   */
  const pasteAsPlainText = useCallback(async () => {
    if (!enabled || !onPaste) return;

    try {
      const content = await readFromClipboard({ cleanWordFormatting: true });
      if (content) {
        onPaste(content, true);
      }
    } catch (error) {
      console.error('Failed to paste as plain text:', error);
    }
  }, [enabled, onPaste]);

  /**
   * Handle keyboard shortcuts
   * Returns true if the event was handled
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!enabled) return false;

      const isCtrlOrMeta = event.ctrlKey || event.metaKey;

      // Ctrl+Shift+V - Open paste special dialog OR paste as plain text
      if (isCtrlOrMeta && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        openDialog();
        return true;
      }

      return false;
    },
    [enabled, openDialog]
  );

  return {
    isOpen,
    openDialog,
    closeDialog,
    handleKeyDown,
    pasteAsPlainText,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get paste option definition by id
 */
export function getPasteOption(id: PasteOption): PasteOptionDef | undefined {
  return PASTE_OPTION_DEFS.find((option) => option.id === id);
}

/**
 * Get all paste option definitions
 */
export function getAllPasteOptions(): PasteOptionDef[] {
  return [...PASTE_OPTION_DEFS];
}

/**
 * Get default paste option
 */
export function getDefaultPasteOption(): PasteOption {
  return 'formatted';
}

/**
 * Check if paste special shortcut
 */
export function isPasteSpecialShortcut(event: KeyboardEvent): boolean {
  const isCtrlOrMeta = event.ctrlKey || event.metaKey;
  return isCtrlOrMeta && event.shiftKey && event.key.toLowerCase() === 'v';
}

// ============================================================================
// EXPORTS
// ============================================================================

export default PasteSpecialDialog;
