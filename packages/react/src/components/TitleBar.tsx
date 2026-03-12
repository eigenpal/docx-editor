/**
 * TitleBar and sub-components for the Google Docs-style 2-level toolbar.
 *
 * - TitleBar: two-row layout (row 1: logo + doc name + right actions, row 2: menu bar)
 * - Logo: renders custom logo content left-aligned
 * - DocumentName: editable document name input
 * - MenuBar: File/Format/Insert menus (auto-wired from EditorToolbarContext)
 * - TitleBarRight: right-aligned actions slot
 */

import React, { useCallback, Children, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { MenuDropdown } from './ui/MenuDropdown';
import type { MenuEntry } from './ui/MenuDropdown';
import { TableGridInline } from './ui/TableGridInline';
import { useEditorToolbar } from './EditorToolbarContext';
import type { FormattingAction } from './Toolbar';

// ============================================================================
// Logo
// ============================================================================

export interface LogoProps {
  children: ReactNode;
}

export function Logo({ children }: LogoProps) {
  return <div className="flex items-center flex-shrink-0">{children}</div>;
}

// ============================================================================
// DocumentName
// ============================================================================

export interface DocumentNameProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function DocumentName({ value, onChange, placeholder = 'Untitled' }: DocumentNameProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="text-base font-normal text-slate-800 bg-transparent border-0 outline-none px-2 py-0 rounded hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-slate-300 min-w-[100px] max-w-[300px] truncate leading-tight"
      aria-label="Document name"
    />
  );
}

// ============================================================================
// TitleBarRight
// ============================================================================

export interface TitleBarRightProps {
  children: ReactNode;
}

export function TitleBarRight({ children }: TitleBarRightProps) {
  return <div className="flex items-center gap-2 ml-auto flex-shrink-0">{children}</div>;
}

// ============================================================================
// MenuBar
// ============================================================================

export function MenuBar() {
  const ctx = useEditorToolbar();
  const {
    disabled = false,
    onFormat,
    onPrint,
    showPrintButton = true,
    onPageSetup,
    onInsertImage,
    onInsertTable,
    showTableInsert = true,
    onInsertPageBreak,
    onInsertTOC,
    onRefocusEditor,
  } = ctx;

  const handleFormat = useCallback(
    (action: FormattingAction) => {
      if (!disabled && onFormat) {
        onFormat(action);
      }
    },
    [disabled, onFormat]
  );

  const handleTableInsert = useCallback(
    (rows: number, columns: number) => {
      if (!disabled && onInsertTable) {
        onInsertTable(rows, columns);
        requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onInsertTable, onRefocusEditor]
  );

  const hasFileMenu = (showPrintButton && onPrint) || onPageSetup;

  return (
    <div className="flex items-center" role="menubar" aria-label="Menu bar">
      {/* File Menu */}
      {hasFileMenu && (
        <MenuDropdown
          label="File"
          disabled={disabled}
          items={[
            ...(showPrintButton && onPrint
              ? [
                  {
                    icon: 'print',
                    label: 'Print',
                    shortcut: 'Ctrl+P',
                    onClick: onPrint,
                  } as MenuEntry,
                ]
              : []),
            ...(onPageSetup
              ? [{ icon: 'settings', label: 'Page setup', onClick: onPageSetup } as MenuEntry]
              : []),
          ]}
        />
      )}

      {/* Format Menu */}
      <MenuDropdown
        label="Format"
        disabled={disabled}
        items={[
          {
            icon: 'format_textdirection_l_to_r',
            label: 'Left-to-right text',
            onClick: () => handleFormat('setLtr'),
          } as MenuEntry,
          {
            icon: 'format_textdirection_r_to_l',
            label: 'Right-to-left text',
            onClick: () => handleFormat('setRtl'),
          } as MenuEntry,
        ]}
      />

      {/* Insert Menu */}
      <MenuDropdown
        label="Insert"
        disabled={disabled}
        items={[
          ...(onInsertImage
            ? [{ icon: 'image', label: 'Image', onClick: onInsertImage } as MenuEntry]
            : []),
          ...(showTableInsert && onInsertTable
            ? [
                {
                  icon: 'grid_on',
                  label: 'Table',
                  submenuContent: (closeMenu: () => void) => (
                    <TableGridInline
                      onInsert={(rows: number, cols: number) => {
                        handleTableInsert(rows, cols);
                        closeMenu();
                      }}
                    />
                  ),
                } as MenuEntry,
              ]
            : []),
          ...(onInsertImage || (showTableInsert && onInsertTable)
            ? [{ type: 'separator' as const } as MenuEntry]
            : []),
          {
            icon: 'page_break',
            label: 'Page break',
            onClick: onInsertPageBreak,
            disabled: !onInsertPageBreak,
          },
          {
            icon: 'format_list_numbered',
            label: 'Table of contents',
            onClick: onInsertTOC,
            disabled: !onInsertTOC,
          },
        ]}
      />
    </div>
  );
}

// ============================================================================
// TitleBar
// ============================================================================

export interface TitleBarProps {
  children: ReactNode;
}

/**
 * TitleBar layout (Google Docs style):
 *
 *   ┌──────────┬────────────────────────────┬──────────────────┐
 *   │          │ Document Name              │                  │
 *   │  Logo    │                            │  Right Actions   │
 *   │          │ File  Format  Insert       │                  │
 *   └──────────┴────────────────────────────┴──────────────────┘
 *
 * Logo and TitleBarRight span full height. DocumentName + MenuBar
 * stack vertically in the center column.
 */
export function TitleBar({ children }: TitleBarProps) {
  let logoItem: ReactNode = null;
  let rightItem: ReactNode = null;
  const middleTopItems: ReactNode[] = [];
  const menuBarItems: ReactNode[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Logo) {
      logoItem = child;
    } else if (child.type === TitleBarRight) {
      rightItem = child;
    } else if (child.type === MenuBar) {
      menuBarItems.push(child);
    } else {
      middleTopItems.push(child);
    }
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isInteractive =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'OPTION';

    if (!isInteractive) {
      e.preventDefault();
    }
  }, []);

  return (
    <div
      className="flex items-stretch bg-white pt-2"
      onMouseDown={handleMouseDown}
      data-testid="title-bar"
    >
      {/* Left: Logo spanning full height */}
      {logoItem && <div className="flex items-center flex-shrink-0 px-3">{logoItem}</div>}

      {/* Center: doc name on top, menus below */}
      <div className="flex flex-col justify-center flex-1 min-w-0 py-1">
        {middleTopItems.length > 0 && (
          <div className="flex items-center gap-2 px-1">{middleTopItems}</div>
        )}
        {menuBarItems.length > 0 && <div className="flex items-center px-1">{menuBarItems}</div>}
      </div>

      {/* Right: actions spanning full height */}
      {rightItem && <div className="flex items-center flex-shrink-0 px-3">{rightItem}</div>}
    </div>
  );
}
