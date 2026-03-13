import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { SpellcheckMenuAction, SpellcheckMenuItem } from '../menu-utils';

export interface SpellcheckContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  items: SpellcheckMenuItem[];
  loading?: boolean;
  onAction: (action: SpellcheckMenuAction, value?: string) => void;
  onClose: () => void;
  className?: string;
}

const EMPTY_STATE_ITEM: SpellcheckMenuItem = {
  label: 'No suggestions',
  action: 'ignore',
};

export const SpellcheckContextMenu: React.FC<SpellcheckContextMenuProps> = ({
  isOpen,
  position,
  items,
  loading = false,
  onAction,
  onClose,
  className = '',
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const displayItems = items.length > 0 ? items : [EMPTY_STATE_ITEM];

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          event.preventDefault();
          setHighlightedIndex((prev) => (prev + 1) % displayItems.length);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setHighlightedIndex((prev) => (prev - 1 + displayItems.length) % displayItems.length);
          break;
        case 'Enter': {
          event.preventDefault();
          const item = displayItems[highlightedIndex];
          if (!item) return;
          onAction(item.action, item.value);
          onClose();
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [displayItems, highlightedIndex, isOpen, onAction, onClose]);

  useEffect(() => {
    if (isOpen) setHighlightedIndex(0);
  }, [isOpen]);

  const getMenuStyle = useCallback((): React.CSSProperties => {
    const menuWidth = 220;
    const menuHeight = Math.max(1, displayItems.length) * 36 + 20;

    let x = position.x;
    let y = position.y;

    if (typeof window !== 'undefined') {
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
      if (x < 10) x = 10;
      if (y < 10) y = 10;
    }

    return {
      position: 'fixed',
      top: y,
      left: x,
      minWidth: menuWidth,
      background: 'white',
      border: '1px solid var(--doc-border-light)',
      borderRadius: '8px',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
      zIndex: 10000,
      padding: '4px 0',
      overflow: 'hidden',
    };
  }, [displayItems.length, position.x, position.y]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className={`docx-spellcheck-menu ${className}`}
      style={getMenuStyle()}
      role="menu"
      aria-label="Spellcheck suggestions"
    >
      {loading && (
        <div
          style={{
            padding: '8px 12px',
            fontSize: '12px',
            color: 'var(--doc-text-subtle)',
            borderBottom: '1px solid var(--doc-border)',
          }}
        >
          Loading suggestions...
        </div>
      )}

      {displayItems.map((item, index) => {
        const isHighlighted = index === highlightedIndex;
        const isPlaceholder = item === EMPTY_STATE_ITEM;

        return (
          <button
            key={`${item.action}-${item.label}-${index}`}
            type="button"
            className={`docx-spellcheck-menu-item ${isHighlighted ? 'docx-spellcheck-menu-item-highlighted' : ''}`}
            onClick={() => {
              if (isPlaceholder) return;
              onAction(item.action, item.value);
              onClose();
            }}
            onMouseEnter={() => setHighlightedIndex(index)}
            disabled={isPlaceholder}
            role="menuitem"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              background:
                isHighlighted && !isPlaceholder ? 'var(--doc-primary-light)' : 'transparent',
              cursor: isPlaceholder ? 'default' : 'pointer',
              fontSize: '13px',
              color: isPlaceholder ? 'var(--doc-text-subtle)' : 'var(--doc-text)',
              textAlign: 'left',
            }}
          >
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.action === 'replace' && item.value && (
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--doc-text-subtle)',
                  fontFamily: 'monospace',
                }}
              >
                Replace
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default SpellcheckContextMenu;
