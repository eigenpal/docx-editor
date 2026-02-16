/**
 * MenuDropdown — a reusable dropdown menu with text label trigger
 *
 * Supports submenu panels that appear to the right on hover (Google Docs style).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { MaterialSymbol } from './MaterialSymbol';

export interface MenuItem {
  icon?: string;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Custom content to render instead of a simple menu item */
  customContent?: ReactNode;
  /** Submenu content that appears to the right on hover */
  submenuContent?: (closeMenu: () => void) => ReactNode;
}

export interface MenuSeparator {
  type: 'separator';
}

export type MenuEntry = MenuItem | MenuSeparator;

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'type' in entry && entry.type === 'separator';
}

interface MenuDropdownProps {
  label: string;
  items: MenuEntry[];
  disabled?: boolean;
}

const triggerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '2px 8px',
  border: 'none',
  background: 'transparent',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 400,
  color: 'var(--doc-text, #374151)',
  whiteSpace: 'nowrap',
  height: 28,
  lineHeight: '28px',
};

const triggerOpenStyle: CSSProperties = {
  ...triggerStyle,
  background: 'var(--doc-hover, #f3f4f6)',
};

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 2,
  backgroundColor: 'white',
  border: '1px solid var(--doc-border, #d1d5db)',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
  padding: '4px 0',
  zIndex: 1000,
  minWidth: 200,
};

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--doc-text, #374151)',
  width: '100%',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const menuItemDisabledStyle: CSSProperties = {
  ...menuItemStyle,
  opacity: 0.4,
  cursor: 'default',
};

const separatorStyle: CSSProperties = {
  height: 1,
  backgroundColor: 'var(--doc-border, #e5e7eb)',
  margin: '4px 0',
};

const shortcutStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 12,
  color: 'var(--doc-text-muted, #9ca3af)',
};

const submenuPanelStyle: CSSProperties = {
  position: 'absolute',
  left: '100%',
  top: -4,
  marginLeft: 2,
  backgroundColor: 'white',
  border: '1px solid var(--doc-border, #d1d5db)',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
  padding: 8,
  zIndex: 1001,
};

export function MenuDropdown({ label, items, disabled }: MenuDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredSubmenu, setHoveredSubmenu] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setHoveredSubmenu(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu();
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, closeMenu]);

  const handleItemClick = (item: MenuItem) => {
    if (item.disabled || item.submenuContent) return;
    if (!item.onClick) return;
    item.onClick();
    closeMenu();
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onMouseDown={(e) => e.preventDefault()}
        disabled={disabled}
        style={isOpen ? triggerOpenStyle : triggerStyle}
      >
        {label}
        <MaterialSymbol name="arrow_drop_down" size={16} />
      </button>

      {isOpen && (
        <div style={dropdownStyle}>
          {items.map((entry, i) => {
            if (isSeparator(entry)) {
              return <div key={`sep-${i}`} style={separatorStyle} />;
            }
            const item = entry;
            if (item.customContent) {
              return (
                <div key={item.label} onMouseDown={(e) => e.preventDefault()}>
                  {item.customContent}
                </div>
              );
            }

            const hasSubmenu = !!item.submenuContent;
            const isSubmenuOpen = hoveredSubmenu === item.label;

            return (
              <div
                key={item.label}
                style={{ position: 'relative' }}
                onMouseEnter={() => hasSubmenu && setHoveredSubmenu(item.label)}
                onMouseLeave={() => hasSubmenu && setHoveredSubmenu(null)}
              >
                <button
                  type="button"
                  style={item.disabled ? menuItemDisabledStyle : menuItemStyle}
                  onClick={() => handleItemClick(item)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseOver={(e) => {
                    if (!item.disabled) {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                        'var(--doc-hover, #f3f4f6)';
                    }
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                  }}
                  disabled={item.disabled}
                >
                  {item.icon && <MaterialSymbol name={item.icon} size={18} />}
                  <span>{item.label}</span>
                  {item.shortcut && <span style={shortcutStyle}>{item.shortcut}</span>}
                  {hasSubmenu && (
                    <span style={{ marginLeft: 'auto' }}>
                      <MaterialSymbol name="keyboard_arrow_right" size={16} />
                    </span>
                  )}
                </button>
                {hasSubmenu && isSubmenuOpen && (
                  <div style={submenuPanelStyle} onMouseDown={(e) => e.preventDefault()}>
                    {item.submenuContent!(closeMenu)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
