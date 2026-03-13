/**
 * Text Context Menu Component
 *
 * Right-click context menu for text editing operations.
 * Shows Cut, Copy, Paste, and other text editing options.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context menu action types
 */
export type TextContextAction =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAsPlainText'
  | 'selectAll'
  | 'delete'
  | 'textColor'
  | 'highlightColor'
  | 'separator'
  | 'spellcheckSuggestions'
  | 'spellcheckReplace'
  | 'spellcheckIgnore'
  | 'spellcheckAddToDictionary'
  | 'spellcheckLoading';

/**
 * Menu item configuration
 */
export interface TextContextMenuItem {
  /** Action type */
  action: TextContextAction;
  /** Display label */
  label: string;
  /** Optional action value (used for spellcheck replacements) */
  value?: string;
  /** Keyboard shortcut hint */
  shortcut?: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Whether to show divider after this item */
  dividerAfter?: boolean;
  /** Submenu items */
  submenu?: TextContextMenuItem[];
  /** Render as split item (apply + submenu) */
  split?: boolean;
  /** Submenu rendering variant */
  submenuVariant?: 'list' | 'colorGrid';
  /** Optional swatch color (for color grid items) */
  swatch?: string;
  /** Whether this item opens a color picker */
  isColorPicker?: boolean;
  /** Optional icon override */
  icon?: React.ReactNode;
  /** Optional data-testid prefix for split buttons */
  testIdPrefix?: string;
  /** Optional data-testid for menu item */
  testId?: string;
}

/**
 * Context menu props
 */
export interface TextContextMenuProps {
  /** Whether the menu is visible */
  isOpen: boolean;
  /** Menu position */
  position: { x: number; y: number };
  /** Minimum viewport Y position (prevents overlapping toolbars) */
  minY?: number;
  /** Whether there's a selection (enables copy/cut) */
  hasSelection: boolean;
  /** Whether the editor is editable (enables paste/cut/delete) */
  isEditable: boolean;
  /** Whether clipboard has content (enables paste) */
  hasClipboardContent?: boolean;
  /** Callback when an action is selected */
  onAction: (action: TextContextAction, value?: string) => void;
  /** Callback when menu is closed */
  onClose: () => void;
  /** Custom menu items (overrides default) */
  items?: TextContextMenuItem[];
  /** Additional className */
  className?: string;
}

/**
 * Hook options for text context menu
 */
export interface UseTextContextMenuOptions {
  /** Whether the context menu is enabled */
  enabled?: boolean;
  /** Whether the editor is editable */
  isEditable?: boolean;
  /** Container element ref */
  containerRef?: React.RefObject<HTMLElement>;
  /** Callback when an action is triggered */
  onAction?: (action: TextContextAction, value?: string) => void;
}

/**
 * Hook return value
 */
export interface UseTextContextMenuReturn {
  /** Whether the menu is open */
  isOpen: boolean;
  /** Menu position */
  position: { x: number; y: number };
  /** Whether there's a text selection */
  hasSelection: boolean;
  /** Open the context menu */
  openMenu: (event: React.MouseEvent | MouseEvent) => void;
  /** Close the context menu */
  closeMenu: () => void;
  /** Handle action selection */
  handleAction: (action: TextContextAction, value?: string) => void;
  /** Context menu event handler for onContextMenu prop */
  onContextMenu: (event: React.MouseEvent) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default menu items
 */
const DEFAULT_MENU_ITEMS: TextContextMenuItem[] = [
  { action: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
  { action: 'copy', label: 'Copy', shortcut: 'Ctrl+C' },
  { action: 'paste', label: 'Paste', shortcut: 'Ctrl+V' },
  {
    action: 'pasteAsPlainText',
    label: 'Paste as Plain Text',
    shortcut: 'Ctrl+Shift+V',
    dividerAfter: true,
  },
  { action: 'delete', label: 'Delete', shortcut: 'Del', dividerAfter: true },
  { action: 'selectAll', label: 'Select All', shortcut: 'Ctrl+A' },
];

// ============================================================================
// ICONS
// ============================================================================

const CutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M5.5 10.5L10.5 3M10.5 10.5L5.5 3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M11 5V3a1 1 0 00-1-1H4a1 1 0 00-1 1v8a1 1 0 001 1h2"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

const PasteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="10" height="11" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 3V2a1 1 0 011-1h2a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 8h4M6 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const DeleteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SelectAllIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect
      x="2"
      y="2"
      width="12"
      height="12"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
    />
    <rect x="4" y="4" width="8" height="8" fill="currentColor" opacity="0.3" />
  </svg>
);

/**
 * Get icon for action
 */
function getActionIcon(action: TextContextAction): React.ReactNode {
  switch (action) {
    case 'cut':
      return <CutIcon />;
    case 'copy':
      return <CopyIcon />;
    case 'paste':
    case 'pasteAsPlainText':
      return <PasteIcon />;
    case 'delete':
      return <DeleteIcon />;
    case 'selectAll':
      return <SelectAllIcon />;
    case 'spellcheckReplace':
    case 'spellcheckIgnore':
    case 'spellcheckAddToDictionary':
    case 'spellcheckLoading':
    case 'spellcheckSuggestions':
      return null;
    default:
      return null;
  }
}

// ============================================================================
// MENU ITEM COMPONENT
// ============================================================================

interface MenuItemComponentProps {
  item: TextContextMenuItem;
  onClick: () => void;
  onOpenSubmenu?: () => void;
  isHighlighted: boolean;
  onMouseEnter: () => void;
  onArrowMouseEnter?: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  showSubmenuIndicator?: boolean;
}

const MenuItemComponent: React.FC<MenuItemComponentProps> = ({
  item,
  onClick,
  onOpenSubmenu,
  isHighlighted,
  onMouseEnter,
  onArrowMouseEnter,
  buttonRef,
  showSubmenuIndicator = false,
}) => {
  if (item.action === 'separator') {
    return (
      <div
        className="docx-text-context-menu-separator"
        style={{
          height: '1px',
          backgroundColor: 'var(--doc-border, rgba(15, 23, 42, 0.12))',
          margin: '4px 12px',
        }}
      />
    );
  }

  const iconNode = item.icon ?? getActionIcon(item.action);
  const rowBackground =
    isHighlighted && !item.disabled
      ? 'var(--doc-context-menu-hover, rgba(15, 23, 42, 0.08))'
      : 'transparent';

  if (item.split && showSubmenuIndicator) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
          <button
            type="button"
            className={`docx-text-context-menu-item ${isHighlighted ? 'docx-text-context-menu-item-highlighted' : ''} ${item.disabled ? 'docx-text-context-menu-item-disabled' : ''}`}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            disabled={item.disabled}
            role="menuitem"
            aria-disabled={item.disabled}
            ref={buttonRef}
            data-testid={item.testIdPrefix ? `${item.testIdPrefix}-apply` : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flex: 1,
              padding: '8px 12px',
              border: 'none',
              background: rowBackground,
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              color: item.disabled ? 'var(--doc-text-subtle)' : 'var(--doc-text)',
              textAlign: 'left',
              opacity: item.disabled ? 0.6 : 1,
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
            }}
          >
            <span
              style={{
                display: 'flex',
                color: item.disabled ? 'var(--doc-border)' : 'var(--doc-text-muted)',
                width: 16,
                height: 16,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {iconNode}
            </span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && (
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--doc-text-subtle)',
                  fontFamily: 'monospace',
                }}
              >
                {item.shortcut}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`docx-text-context-menu-item ${isHighlighted ? 'docx-text-context-menu-item-highlighted' : ''} ${item.disabled ? 'docx-text-context-menu-item-disabled' : ''}`}
            onClick={onOpenSubmenu}
            onMouseEnter={onArrowMouseEnter}
            disabled={item.disabled}
            role="menuitem"
            aria-disabled={item.disabled}
            aria-haspopup="menu"
            aria-expanded={isHighlighted}
            data-testid={item.testIdPrefix ? `${item.testIdPrefix}-arrow` : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              border: 'none',
              background: rowBackground,
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              color: 'var(--doc-text-subtle)',
              opacity: item.disabled ? 0.6 : 1,
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              borderLeft: '1px solid var(--doc-border, rgba(15, 23, 42, 0.12))',
            }}
          >
            ›
          </button>
        </div>
        {item.dividerAfter && (
          <div
            className="docx-text-context-menu-separator"
            style={{
              height: '1px',
              backgroundColor: 'var(--doc-border, rgba(15, 23, 42, 0.12))',
              margin: '4px 12px',
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`docx-text-context-menu-item ${isHighlighted ? 'docx-text-context-menu-item-highlighted' : ''} ${item.disabled ? 'docx-text-context-menu-item-disabled' : ''}`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        disabled={item.disabled}
        role="menuitem"
        aria-disabled={item.disabled}
        aria-haspopup={showSubmenuIndicator ? 'menu' : undefined}
        aria-expanded={showSubmenuIndicator ? isHighlighted : undefined}
        ref={buttonRef}
        data-testid={item.testId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: '100%',
          padding: '8px 12px',
          border: 'none',
          background: rowBackground,
          cursor: item.disabled ? 'not-allowed' : 'pointer',
          fontSize: '13px',
          color: item.disabled ? 'var(--doc-text-subtle)' : 'var(--doc-text)',
          textAlign: 'left',
          opacity: item.disabled ? 0.6 : 1,
        }}
      >
        <span
          style={{
            display: 'flex',
            color: item.disabled ? 'var(--doc-border)' : 'var(--doc-text-muted)',
            width: 16,
            height: 16,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {iconNode}
        </span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.shortcut && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--doc-text-subtle)',
              fontFamily: 'monospace',
            }}
          >
            {item.shortcut}
          </span>
        )}
        {showSubmenuIndicator && (
          <span
            aria-hidden="true"
            style={{
              fontSize: '12px',
              color: 'var(--doc-text-subtle)',
              marginLeft: '4px',
            }}
          >
            ›
          </span>
        )}
      </button>
      {item.dividerAfter && (
        <div
          className="docx-text-context-menu-separator"
          style={{
            height: '1px',
            backgroundColor: 'var(--doc-border, rgba(15, 23, 42, 0.12))',
            margin: '4px 12px',
          }}
        />
      )}
    </>
  );
};

const SUBMENU_OFFSET = 1;

// ============================================================================
// TEXT CONTEXT MENU COMPONENT
// ============================================================================

export const TextContextMenu: React.FC<TextContextMenuProps> = ({
  isOpen,
  position,
  minY,
  hasSelection,
  isEditable,
  hasClipboardContent = true,
  onAction,
  onClose,
  items,
  className = '',
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [submenuState, setSubmenuState] = useState<{
    parentIndex: number;
    position: { x: number; y: number };
    anchorRect: DOMRect;
  } | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [submenuHighlightedIndex, setSubmenuHighlightedIndex] = useState(0);
  const [isColorPickerActive, setIsColorPickerActive] = useState(false);

  // Build menu items with disabled states
  const menuItems = (items || DEFAULT_MENU_ITEMS).map((item) => {
    const disabled = (() => {
      if (item.disabled !== undefined) return item.disabled;
      switch (item.action) {
        case 'cut':
        case 'copy':
        case 'delete':
          return !hasSelection;
        case 'paste':
        case 'pasteAsPlainText':
          return !isEditable || !hasClipboardContent;
        case 'textColor':
        case 'highlightColor':
          return !isEditable;
        default:
          return false;
      }
    })();

    return { ...item, disabled };
  });

  // Filter out separators for keyboard navigation
  const navigableItems = menuItems.filter((item) => item.action !== 'separator');

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (isColorPickerActive) return;
      const targetNode = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(targetNode) &&
        (!submenuRef.current || !submenuRef.current.contains(targetNode))
      ) {
        onClose();
      }
    };

    // Use timeout to avoid immediately closing on right-click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, isColorPickerActive, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setSubmenuState(null);
      setSubmenuPosition(null);
      setSubmenuHighlightedIndex(0);
      setIsColorPickerActive(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (submenuState) {
      setSubmenuHighlightedIndex(0);
    }
  }, [submenuState]);

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
          setHighlightedIndex((prev) => {
            let next = (prev + 1) % navigableItems.length;
            // Skip disabled items
            while (navigableItems[next]?.disabled && next !== prev) {
              next = (next + 1) % navigableItems.length;
            }
            return next;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((prev) => {
            let next = (prev - 1 + navigableItems.length) % navigableItems.length;
            // Skip disabled items
            while (navigableItems[next]?.disabled && next !== prev) {
              next = (next - 1 + navigableItems.length) % navigableItems.length;
            }
            return next;
          });
          break;
        case 'Enter':
          e.preventDefault();
          const item = navigableItems[highlightedIndex];
          if (item && !item.disabled) {
            if (item.submenu && item.submenu.length > 0 && !item.split) {
              const menuIndex = menuItems.findIndex((menuItem) => menuItem === item);
              if (menuIndex >= 0) {
                const anchor = itemRefs.current[menuIndex];
                if (anchor) {
                  const rect = anchor.getBoundingClientRect();
                  setSubmenuState({
                    parentIndex: menuIndex,
                    position: { x: rect.right + SUBMENU_OFFSET, y: rect.top - SUBMENU_OFFSET },
                    anchorRect: rect,
                  });
                }
              }
              break;
            }
            onAction(item.action, item.value);
            onClose();
          }
          break;
        case 'ArrowRight': {
          const arrowItem = navigableItems[highlightedIndex];
          if (arrowItem && !arrowItem.disabled && arrowItem.submenu?.length) {
            const menuIndex = menuItems.findIndex((menuItem) => menuItem === arrowItem);
            if (menuIndex >= 0) {
              const anchor = itemRefs.current[menuIndex];
                if (anchor) {
                  const rect = anchor.getBoundingClientRect();
                  setSubmenuState({
                    parentIndex: menuIndex,
                    position: { x: rect.right + SUBMENU_OFFSET, y: rect.top - SUBMENU_OFFSET },
                    anchorRect: rect,
                  });
                }
            }
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, highlightedIndex, navigableItems, menuItems, onAction, onClose]);

  // Reset highlighted index when menu opens
  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(0);
    }
  }, [isOpen]);

  // Position menu to stay within viewport
  useLayoutEffect(() => {
    if (!isOpen) return;
    const menu = menuRef.current;
    if (!menu || typeof window === 'undefined') return;

    const rect = menu.getBoundingClientRect();
    const padding = 8;
    let x = position.x;
    let y = position.y;
    const minTop = Math.max(padding, minY ?? padding);
    const maxTop = Math.max(minTop, window.innerHeight - rect.height - padding);

    if (x + rect.width > window.innerWidth - padding) {
      x = window.innerWidth - rect.width - padding;
    }
    if (y + rect.height > window.innerHeight - padding) {
      y = window.innerHeight - rect.height - padding;
    }
    if (x < padding) x = padding;
    if (y < minTop) y = minTop;
    if (y > maxTop) y = maxTop;

    if (x !== adjustedPosition.x || y !== adjustedPosition.y) {
      setAdjustedPosition({ x, y });
    }
  }, [isOpen, position.x, position.y, adjustedPosition.x, adjustedPosition.y, minY]);

  useEffect(() => {
    if (submenuState) {
      setSubmenuPosition(submenuState.position);
    }
  }, [submenuState]);

  useLayoutEffect(() => {
    if (!submenuState || !submenuRef.current || typeof window === 'undefined') return;

    const rect = submenuRef.current.getBoundingClientRect();
    const padding = 8;
    let x = submenuState.position.x;
    let y = submenuState.position.y;
    const minTop = Math.max(padding, minY ?? padding);
    const maxTop = Math.max(minTop, window.innerHeight - rect.height - padding);

    if (x + rect.width > window.innerWidth - padding) {
      x = submenuState.anchorRect.left - rect.width - SUBMENU_OFFSET;
    }
    if (x < padding) x = padding;
    if (y + rect.height > window.innerHeight - padding) {
      y = window.innerHeight - rect.height - padding;
    }
    if (y < minTop) y = minTop;
    if (y > maxTop) y = maxTop;

    if (!submenuPosition || submenuPosition.x !== x || submenuPosition.y !== y) {
      setSubmenuPosition({ x, y });
    }
  }, [submenuState, submenuPosition, minY]);

  const getMenuStyle = useCallback((): React.CSSProperties => {
    return {
      position: 'fixed',
      top: adjustedPosition.y,
      left: adjustedPosition.x,
      minWidth: 220,
      maxWidth: 320,
      background: '#ffffff',
      border: '1px solid rgba(0, 0, 0, 0.12)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
      zIndex: 20000,
      padding: '6px 0',
      overflow: 'hidden',
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    };
  }, [adjustedPosition.x, adjustedPosition.y]);

  const getSubmenuStyle = useCallback((): React.CSSProperties => {
    const position = submenuPosition ?? submenuState?.position ?? { x: 0, y: 0 };
    return {
      position: 'fixed',
      top: position.y,
      left: position.x,
      minWidth: 200,
      maxWidth: 300,
      background: '#ffffff',
      border: '1px solid rgba(0, 0, 0, 0.12)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
      zIndex: 20001,
      padding: '6px 0',
      overflow: 'hidden',
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    };
  }, [submenuPosition, submenuState?.position]);

  const openSubmenuAtIndex = (index: number) => {
    const anchor = itemRefs.current[index];
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setSubmenuState({
      parentIndex: index,
      position: { x: rect.right + SUBMENU_OFFSET, y: rect.top - SUBMENU_OFFSET },
      anchorRect: rect,
    });
  };

  const handleItemClick = (item: TextContextMenuItem, index: number) => {
    if (item.disabled) return;
    if (item.submenu && item.submenu.length > 0 && !item.split) {
      openSubmenuAtIndex(index);
      return;
    }
    onAction(item.action, item.value);
    onClose();
  };

  if (!isOpen) return null;

  const submenuParentItem = submenuState ? menuItems[submenuState.parentIndex] : null;
  const submenuItems = submenuParentItem?.submenu ?? [];
  const submenuVariant = submenuParentItem?.submenuVariant ?? 'list';
  const isColorGrid = submenuVariant === 'colorGrid';
  const colorGridItems = isColorGrid
    ? submenuItems.filter((item) => item.action !== 'separator')
    : submenuItems;

  const renderColorGrid = () => (
    <div
      className="docx-text-context-menu-color-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 20px)',
        gap: 8,
        padding: '8px 10px',
      }}
    >
      {colorGridItems.map((item, index) => {
        const isHighlighted = index === submenuHighlightedIndex;
        const isDisabled = item.disabled;
        const swatchColor = item.swatch ?? item.value ?? 'transparent';
        const isPicker = item.isColorPicker;

        if (isPicker) {
          const pickerValue =
            typeof item.value === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(item.value)
              ? item.value.startsWith('#')
                ? item.value
                : `#${item.value}`
              : '#000000';
          return (
            <label
              key={`submenu-picker-${index}`}
              style={{
                position: 'relative',
                width: 20,
                height: 20,
                borderRadius: 4,
                border: `1px solid ${isHighlighted ? 'var(--doc-primary, #2563eb)' : 'var(--doc-border, rgba(15, 23, 42, 0.18))'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
                boxShadow: isHighlighted ? '0 0 0 2px rgba(37, 99, 235, 0.2)' : 'none',
                opacity: isDisabled ? 0.5 : 1,
              }}
              aria-label={item.label}
              data-testid={item.testId}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <span style={{ fontSize: 12, color: 'var(--doc-text-muted)' }}>＋</span>
              <input
                type="color"
                aria-label={item.label}
                disabled={isDisabled}
                data-testid={item.testId ? `${item.testId}-input` : undefined}
                defaultValue={pickerValue}
                data-last-value={pickerValue}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                }}
                onFocus={(event) => {
                  if (isDisabled) return;
                  event.currentTarget.dataset.openValue = event.currentTarget.value;
                  setIsColorPickerActive(true);
                }}
                onBlur={(event) => {
                  if (isDisabled) return;
                  setIsColorPickerActive(false);
                  const openValue =
                    event.currentTarget.dataset.openValue ??
                    event.currentTarget.dataset.lastValue ??
                    '';
                  const nextValue = event.currentTarget.value;
                  event.currentTarget.dataset.openValue = '';
                  if (openValue && openValue.toLowerCase() !== nextValue.toLowerCase()) {
                    event.currentTarget.dataset.lastValue = nextValue;
                    onAction(item.action, nextValue);
                    onClose();
                  }
                }}
                onMouseEnter={() => {
                  if (!isDisabled) setSubmenuHighlightedIndex(index);
                }}
              />
            </label>
          );
        }

        return (
          <button
            key={`submenu-swatch-${item.action}-${index}`}
            type="button"
            role="menuitem"
            aria-label={item.label}
            disabled={isDisabled}
            data-testid={item.testId}
            onClick={() => {
              if (isDisabled) return;
              onAction(item.action, item.value);
              onClose();
            }}
            onMouseEnter={() => {
              if (!isDisabled) setSubmenuHighlightedIndex(index);
            }}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              border: `1px solid ${
                isHighlighted ? 'var(--doc-primary, #2563eb)' : 'var(--doc-border, rgba(15, 23, 42, 0.18))'
              }`,
              backgroundColor:
                swatchColor === 'auto' || swatchColor === 'none' ? '#ffffff' : swatchColor,
              position: 'relative',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.5 : 1,
              boxShadow: isHighlighted ? '0 0 0 2px rgba(37, 99, 235, 0.2)' : 'none',
            }}
          >
            {(swatchColor === 'auto' || swatchColor === 'none') && (
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: 'var(--doc-text-subtle)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                }}
              >
                {swatchColor === 'auto' ? 'A' : '×'}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const menuContent = (
    <>
      <div
        ref={menuRef}
        className={`docx-text-context-menu ${className}`}
        style={getMenuStyle()}
        role="menu"
        aria-label="Text editing menu"
      >
        {menuItems.map((item, index) => {
          // Find the index in navigable items for highlighting
          const navigableIndex = navigableItems.findIndex((ni) => ni === item);
          const showSubmenuIndicator = !!item.submenu && item.submenu.length > 0;
          const isSubmenuOpen = submenuState?.parentIndex === index;
          const isHighlighted = navigableIndex === highlightedIndex || isSubmenuOpen;

          return (
            <MenuItemComponent
              key={`${item.action}-${index}`}
              item={item}
              onClick={() => handleItemClick(item, index)}
              onOpenSubmenu={
                showSubmenuIndicator && item.split ? () => openSubmenuAtIndex(index) : undefined
              }
              isHighlighted={isHighlighted}
              onMouseEnter={() => {
                if (navigableIndex >= 0 && !item.disabled) {
                  setHighlightedIndex(navigableIndex);
                }
                if (showSubmenuIndicator && !item.split) {
                  openSubmenuAtIndex(index);
                  return;
                }
                if (submenuState) {
                  setSubmenuState(null);
                }
              }}
              onArrowMouseEnter={
                showSubmenuIndicator && item.split ? () => openSubmenuAtIndex(index) : undefined
              }
              buttonRef={(el) => {
                itemRefs.current[index] = el;
              }}
              showSubmenuIndicator={showSubmenuIndicator}
            />
          );
        })}
      </div>
      {submenuState && submenuItems.length > 0 && (
        <div
          ref={submenuRef}
          className={`docx-text-context-menu docx-text-context-menu-submenu${
            isColorGrid ? ' docx-text-context-menu-submenu--colors' : ''
          }`}
          style={getSubmenuStyle()}
          role="menu"
          aria-label={submenuParentItem?.label ?? 'Context submenu'}
        >
          {isColorGrid
            ? renderColorGrid()
            : submenuItems.map((item, index) => {
                const isHighlighted = index === submenuHighlightedIndex;
                if (item.action === 'separator') {
                  return (
                    <div
                      key={`submenu-separator-${index}`}
                      className="docx-text-context-menu-separator"
                      style={{
                        height: '1px',
                        backgroundColor: 'var(--doc-border, rgba(15, 23, 42, 0.12))',
                        margin: '4px 12px',
                      }}
                    />
                  );
                }
                return (
                  <MenuItemComponent
                    key={`submenu-${item.action}-${index}`}
                    item={item}
                    onClick={() => {
                      if (item.disabled) return;
                      onAction(item.action, item.value);
                      onClose();
                    }}
                    isHighlighted={isHighlighted}
                    onMouseEnter={() => {
                      setSubmenuHighlightedIndex(index);
                    }}
                  />
                );
              })}
        </div>
      )}
    </>
  );

  if (typeof document === 'undefined') {
    return menuContent;
  }

  return createPortal(menuContent, document.body);
};

// ============================================================================
// USE TEXT CONTEXT MENU HOOK
// ============================================================================

/**
 * Hook to manage text context menu state
 */
export function useTextContextMenu(
  options: UseTextContextMenuOptions = {}
): UseTextContextMenuReturn {
  const {
    enabled = true,
    isEditable: _isEditable = true,
    containerRef: _containerRef,
    onAction,
  } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hasSelection, setHasSelection] = useState(false);

  /**
   * Check if there's a text selection
   */
  const checkSelection = useCallback(() => {
    const selection = window.getSelection();
    const hasText = selection && !selection.isCollapsed && selection.toString().length > 0;
    setHasSelection(!!hasText);
    return !!hasText;
  }, []);

  /**
   * Open the context menu
   */
  const openMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      if (!enabled) return;

      event.preventDefault();
      event.stopPropagation();

      // Update selection state
      checkSelection();

      setPosition({ x: event.clientX, y: event.clientY });
      setIsOpen(true);
    },
    [enabled, checkSelection]
  );

  /**
   * Close the context menu
   */
  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  /**
   * Handle action selection
   */
  const handleAction = useCallback(
    (action: TextContextAction, value?: string) => {
      closeMenu();

      // Execute the action
      switch (action) {
        case 'cut':
          document.execCommand('cut');
          break;
        case 'copy':
          document.execCommand('copy');
          break;
        case 'paste':
          document.execCommand('paste');
          break;
        case 'pasteAsPlainText':
          // Trigger paste event with shift key simulation
          // Note: This may not work in all browsers due to security restrictions
          navigator.clipboard
            .readText?.()
            .then((text) => {
              document.execCommand('insertText', false, text);
            })
            .catch(() => {
              // Fallback - just try regular paste
              document.execCommand('paste');
            });
          break;
        case 'delete':
          document.execCommand('delete');
          break;
        case 'selectAll':
          document.execCommand('selectAll');
          break;
        case 'textColor':
        case 'highlightColor':
        case 'spellcheckReplace':
        case 'spellcheckSuggestions':
        case 'spellcheckIgnore':
        case 'spellcheckAddToDictionary':
        case 'spellcheckLoading':
        case 'separator':
          break;
      }

      onAction?.(action, value);
    },
    [closeMenu, onAction]
  );

  /**
   * Context menu event handler
   */
  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      openMenu(event);
    },
    [openMenu]
  );

  // Close menu when clicking elsewhere or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeMenu]);

  return {
    isOpen,
    position,
    hasSelection,
    openMenu,
    closeMenu,
    handleAction,
    onContextMenu,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get action label
 */
export function getTextActionLabel(action: TextContextAction): string {
  const labels: Record<TextContextAction, string> = {
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    pasteAsPlainText: 'Paste as Plain Text',
    selectAll: 'Select All',
    delete: 'Delete',
    textColor: 'Text Color',
    highlightColor: 'Highlight Color',
    separator: '',
    spellcheckSuggestions: 'Suggestions',
    spellcheckReplace: 'Replace',
    spellcheckIgnore: 'Ignore',
    spellcheckAddToDictionary: 'Add to Dictionary',
    spellcheckLoading: 'Loading suggestions...',
  };
  return labels[action];
}

/**
 * Get action shortcut
 */
export function getTextActionShortcut(action: TextContextAction): string {
  const shortcuts: Record<TextContextAction, string> = {
    cut: 'Ctrl+X',
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    pasteAsPlainText: 'Ctrl+Shift+V',
    selectAll: 'Ctrl+A',
    delete: 'Del',
    textColor: '',
    highlightColor: '',
    separator: '',
    spellcheckSuggestions: '',
    spellcheckReplace: '',
    spellcheckIgnore: '',
    spellcheckAddToDictionary: '',
    spellcheckLoading: '',
  };
  return shortcuts[action];
}

/**
 * Get default menu items
 */
export function getDefaultTextContextMenuItems(): TextContextMenuItem[] {
  return [...DEFAULT_MENU_ITEMS];
}

/**
 * Check if action is available
 */
export function isTextActionAvailable(
  action: TextContextAction,
  hasSelection: boolean,
  isEditable: boolean
): boolean {
  switch (action) {
    case 'cut':
    case 'copy':
    case 'delete':
      return hasSelection;
    case 'paste':
    case 'pasteAsPlainText':
      return isEditable;
    case 'selectAll':
      return true;
    default:
      return true;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default TextContextMenu;
