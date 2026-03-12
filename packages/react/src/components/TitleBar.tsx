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
// Default Doc Icon (shown when no Logo is provided)
// ============================================================================

function DefaultDocIcon() {
  return (
    <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 0C0.9 0 0 0.9 0 2V38C0 39.1 0.9 40 2 40H30C31.1 40 32 39.1 32 38V10L22 0H2Z"
        fill="#cbd5e1"
      />
      <path d="M22 0L32 10H24C22.9 10 22 9.1 22 8V0Z" fill="#94a3b8" />
      <rect x="7" y="18" width="18" height="2" rx="1" fill="#fff" />
      <rect x="7" y="23" width="18" height="2" rx="1" fill="#fff" />
      <rect x="7" y="28" width="12" height="2" rx="1" fill="#fff" />
    </svg>
  );
}

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
  onChange?: (value: string) => void;
  placeholder?: string;
  editable?: boolean;
}

function stripExtension(name: string): string {
  return name.replace(/\.docx$/i, '');
}

export function DocumentName({
  value,
  onChange,
  placeholder = 'Untitled',
  editable = true,
}: DocumentNameProps) {
  const displayName = stripExtension(value);

  if (!editable) {
    return (
      <span className="text-base font-normal text-slate-800 px-2 py-0 min-w-[100px] max-w-[300px] truncate leading-tight">
        {displayName || placeholder}
      </span>
    );
  }
  return (
    <input
      type="text"
      value={displayName}
      onChange={(e) => {
        const raw = e.target.value;
        onChange?.(raw.endsWith('.docx') ? raw : raw + '.docx');
      }}
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
      className="flex items-stretch bg-white pt-2 pb-1"
      onMouseDown={handleMouseDown}
      data-testid="title-bar"
    >
      {/* Left: Logo spanning full height (default doc icon if none provided) */}
      <div className="flex items-center flex-shrink-0 pl-3 pr-1">
        {logoItem || <DefaultDocIcon />}
      </div>

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
