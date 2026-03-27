/**
 * TableOptionsDropdown Component
 *
 * A dropdown menu for all table operations (Google Docs style):
 * - Insert row above/below
 * - Insert column left/right
 * - Delete row/column/table
 * - Border options with color picker
 * - Cell fill color
 * - Merge/Split cells
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { MaterialSymbol } from './MaterialSymbol';
import { cn } from '../../lib/utils';
import type { TableAction } from './TableToolbar';
import type { TableContextInfo } from '@eigenpal/docx-core/prosemirror/extensions/nodes/TableExtension';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

export interface TableOptionsDropdownProps {
  /** Callback when an action is triggered */
  onAction?: (action: TableAction) => void;
  /** Whether the dropdown is disabled */
  disabled?: boolean;
  /** Table context for enabling/disabling actions */
  tableContext?: TableContextInfo | null;
  /** Additional CSS class */
  className?: string;
  /** Tooltip text */
  tooltip?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

type SimpleAction =
  | 'selectRow'
  | 'selectColumn'
  | 'addRowAbove'
  | 'addRowBelow'
  | 'addColumnLeft'
  | 'addColumnRight'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'
  | 'borderAll'
  | 'borderOutside'
  | 'borderInside'
  | 'borderNone'
  | 'borderTop'
  | 'borderBottom'
  | 'borderLeft'
  | 'borderRight'
  | 'mergeCells'
  | 'splitCell';

interface MenuItem {
  action: SimpleAction;
  labelKey: TranslationKey;
  icon: string;
  shortcut?: string;
  danger?: boolean;
  separator?: boolean;
  disabled?: (ctx: TableOptionsDropdownProps['tableContext']) => boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { action: 'addRowAbove', labelKey: 'table.insertRowAbove', icon: 'add' },
  { action: 'addRowBelow', labelKey: 'table.insertRowBelow', icon: 'add' },
  { action: 'addColumnLeft', labelKey: 'table.insertColumnLeft', icon: 'add' },
  { action: 'addColumnRight', labelKey: 'table.insertColumnRight', icon: 'add', separator: true },
  {
    action: 'deleteRow',
    labelKey: 'table.deleteRow',
    icon: 'delete',
    danger: true,
    disabled: (ctx) => (ctx?.rowCount ?? 0) <= 1,
  },
  {
    action: 'deleteColumn',
    labelKey: 'table.deleteColumn',
    icon: 'delete',
    danger: true,
    disabled: (ctx) => (ctx?.columnCount ?? 0) <= 1,
  },
  {
    action: 'deleteTable',
    labelKey: 'table.deleteTable',
    icon: 'delete',
    danger: true,
    separator: true,
  },
  { action: 'borderAll', labelKey: 'table.borders.all', icon: 'border_all' },
  { action: 'borderOutside', labelKey: 'table.borders.outside', icon: 'border_outer' },
  { action: 'borderInside', labelKey: 'table.borders.inside', icon: 'border_inner' },
  { action: 'borderNone', labelKey: 'table.borders.remove', icon: 'border_clear' },
  { action: 'borderTop', labelKey: 'table.borders.top', icon: 'border_top' },
  { action: 'borderBottom', labelKey: 'table.borders.bottom', icon: 'border_bottom' },
  { action: 'borderLeft', labelKey: 'table.borders.left', icon: 'border_left' },
  { action: 'borderRight', labelKey: 'table.borders.right', icon: 'border_right', separator: true },
  {
    action: 'mergeCells',
    labelKey: 'table.mergeCells',
    icon: 'call_merge',
    disabled: (ctx) => !ctx?.hasMultiCellSelection,
  },
  {
    action: 'splitCell',
    labelKey: 'table.splitCell',
    icon: 'call_split',
    disabled: (ctx) => !ctx?.canSplitCell,
  },
];

// ============================================================================
// STYLES
// ============================================================================

const baseDropdownStyles: CSSProperties = {
  position: 'fixed',
  backgroundColor: 'white',
  border: '1px solid var(--doc-border)',
  borderRadius: 8,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
  padding: '4px 0',
  zIndex: 10000,
  minWidth: 220,
  maxHeight: '70vh',
  overflowY: 'auto',
};

const menuItemStyles: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 16px',
  fontSize: 14,
  color: 'var(--doc-text)',
  cursor: 'pointer',
  border: 'none',
  backgroundColor: 'transparent',
  width: '100%',
  textAlign: 'left',
  transition: 'background-color 0.1s',
};

const separatorStyles: CSSProperties = {
  height: 1,
  backgroundColor: 'var(--doc-border)',
  margin: '4px 0',
};

const alignmentRowStyles: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
};

const alignmentButtonStyles: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 28,
  borderRadius: 6,
  border: '1px solid var(--doc-border)',
  backgroundColor: 'transparent',
  cursor: 'pointer',
};

// ============================================================================
// VERTICAL ALIGNMENT SUBCOMPONENT
// ============================================================================

const VALIGN_OPTIONS: { value: 'top' | 'center' | 'bottom'; icon: string; label: string }[] = [
  { value: 'top', icon: 'vertical_align_top', label: 'Top' },
  { value: 'center', icon: 'vertical_align_center', label: 'Middle' },
  { value: 'bottom', icon: 'vertical_align_bottom', label: 'Bottom' },
];

function VerticalAlignRow({ onAction }: { onAction: (action: TableAction) => void }) {
  return (
    <div style={{ padding: '6px 12px' }}>
      <div style={{ fontSize: 12, color: 'var(--doc-text-muted)', marginBottom: 4 }}>
        Vertical alignment
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {VALIGN_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 28,
              border: '1px solid var(--doc-border)',
              borderRadius: 4,
              backgroundColor: 'transparent',
              cursor: 'pointer',
            }}
            onClick={() => onAction({ type: 'cellVerticalAlign', align: opt.value })}
          >
            <MaterialSymbol name={opt.icon} size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// CELL MARGINS SUBCOMPONENT
// ============================================================================

function CellMarginsRow({ onAction }: { onAction: (action: TableAction) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [marginValues, setMarginValues] = useState({ top: 0, bottom: 0, left: 108, right: 108 });

  const handleApply = () => {
    onAction({ type: 'cellMargins', margins: marginValues });
    setIsExpanded(false);
  };

  return (
    <div>
      <button
        type="button"
        style={{
          ...menuItemStyles,
          backgroundColor: hoveredItem === 'main' ? 'var(--doc-bg-hover)' : 'transparent',
        }}
        onMouseEnter={() => setHoveredItem('main')}
        onMouseLeave={() => setHoveredItem(null)}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <MaterialSymbol name="padding" size={18} />
        <span style={{ flex: 1 }}>Cell margins</span>
        <MaterialSymbol name={isExpanded ? 'expand_less' : 'expand_more'} size={18} />
      </button>

      {isExpanded && (
        <div
          style={{
            backgroundColor: 'var(--doc-bg-muted)',
            borderTop: '1px solid var(--doc-border)',
            borderBottom: '1px solid var(--doc-border)',
            padding: '8px 12px',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
              <label
                key={side}
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
              >
                <span
                  style={{ width: 42, textTransform: 'capitalize', color: 'var(--doc-text-muted)' }}
                >
                  {side}
                </span>
                <input
                  type="number"
                  min={0}
                  step={20}
                  value={marginValues[side]}
                  onChange={(e) =>
                    setMarginValues((prev) => ({ ...prev, [side]: Number(e.target.value) || 0 }))
                  }
                  style={{
                    width: 60,
                    padding: '2px 4px',
                    border: '1px solid var(--doc-border)',
                    borderRadius: 3,
                    fontSize: 12,
                  }}
                />
                <span style={{ fontSize: 10, color: 'var(--doc-text-muted)' }}>tw</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            style={{
              marginTop: 6,
              padding: '4px 12px',
              fontSize: 12,
              border: '1px solid var(--doc-border)',
              borderRadius: 4,
              backgroundColor: 'var(--doc-primary)',
              color: 'white',
              cursor: 'pointer',
              width: '100%',
            }}
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TEXT DIRECTION SUBCOMPONENT
// ============================================================================

const TEXT_DIR_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'Horizontal (LR)' },
  { value: 'tbRl', label: 'Vertical (top-bottom, RL)' },
  { value: 'btLr', label: 'Vertical (bottom-top, LR)' },
];

function TextDirectionRow({ onAction }: { onAction: (action: TableAction) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        style={{
          ...menuItemStyles,
          backgroundColor: hoveredItem === 'main' ? 'var(--doc-bg-hover)' : 'transparent',
        }}
        onMouseEnter={() => setHoveredItem('main')}
        onMouseLeave={() => setHoveredItem(null)}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <MaterialSymbol name="text_rotation_none" size={18} />
        <span style={{ flex: 1 }}>Text direction</span>
        <MaterialSymbol name={isExpanded ? 'expand_less' : 'expand_more'} size={18} />
      </button>

      {isExpanded && (
        <div
          style={{
            backgroundColor: 'var(--doc-bg-muted)',
            borderTop: '1px solid var(--doc-border)',
            borderBottom: '1px solid var(--doc-border)',
            padding: '4px 0',
          }}
        >
          {TEXT_DIR_OPTIONS.map((opt) => (
            <button
              key={opt.value ?? 'default'}
              type="button"
              style={{
                ...menuItemStyles,
                padding: '6px 16px',
                fontSize: 13,
                backgroundColor:
                  hoveredItem === (opt.value ?? 'default') ? 'var(--doc-bg-hover)' : 'transparent',
              }}
              onMouseEnter={() => setHoveredItem(opt.value ?? 'default')}
              onMouseLeave={() => setHoveredItem(null)}
              onClick={() => {
                onAction({ type: 'cellTextDirection', direction: opt.value });
                setIsExpanded(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// NO-WRAP SUBCOMPONENT
// ============================================================================

function NoWrapRow({ onAction }: { onAction: (action: TableAction) => void }) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <button
      type="button"
      style={{
        ...menuItemStyles,
        backgroundColor: hoveredItem === 'main' ? 'var(--doc-bg-hover)' : 'transparent',
      }}
      onMouseEnter={() => setHoveredItem('main')}
      onMouseLeave={() => setHoveredItem(null)}
      onClick={() => onAction({ type: 'toggleNoWrap' })}
    >
      <MaterialSymbol name="wrap_text" size={18} />
      <span style={{ flex: 1 }}>Toggle no-wrap</span>
    </button>
  );
}

// ============================================================================
// ROW HEIGHT SUBCOMPONENT
// ============================================================================

const HEIGHT_RULE_OPTIONS: { value: 'auto' | 'atLeast' | 'exact'; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'atLeast', label: 'At least' },
  { value: 'exact', label: 'Exact' },
];

function RowHeightRow({ onAction }: { onAction: (action: TableAction) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [heightValue, setHeightValue] = useState(0);
  const [heightRule, setHeightRule] = useState<'auto' | 'atLeast' | 'exact'>('atLeast');

  const handleApply = () => {
    if (heightRule === 'auto' || heightValue <= 0) {
      onAction({ type: 'rowHeight', height: null });
    } else {
      onAction({ type: 'rowHeight', height: heightValue, rule: heightRule });
    }
    setIsExpanded(false);
  };

  return (
    <div>
      <button
        type="button"
        style={{
          ...menuItemStyles,
          backgroundColor: hoveredItem === 'main' ? 'var(--doc-bg-hover)' : 'transparent',
        }}
        onMouseEnter={() => setHoveredItem('main')}
        onMouseLeave={() => setHoveredItem(null)}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <MaterialSymbol name="height" size={18} />
        <span style={{ flex: 1 }}>Row height</span>
        <MaterialSymbol name={isExpanded ? 'expand_less' : 'expand_more'} size={18} />
      </button>

      {isExpanded && (
        <div
          style={{
            backgroundColor: 'var(--doc-bg-muted)',
            borderTop: '1px solid var(--doc-border)',
            borderBottom: '1px solid var(--doc-border)',
            padding: '8px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--doc-text-muted)', width: 40 }}>Rule</label>
            <select
              value={heightRule}
              onChange={(e) => setHeightRule(e.target.value as typeof heightRule)}
              style={{
                flex: 1,
                padding: '2px 4px',
                border: '1px solid var(--doc-border)',
                borderRadius: 3,
                fontSize: 12,
              }}
            >
              {HEIGHT_RULE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {heightRule !== 'auto' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--doc-text-muted)', width: 40 }}>
                Height
              </label>
              <input
                type="number"
                min={0}
                step={20}
                value={heightValue}
                onChange={(e) => setHeightValue(Number(e.target.value) || 0)}
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  border: '1px solid var(--doc-border)',
                  borderRadius: 3,
                  fontSize: 12,
                }}
              />
              <span style={{ fontSize: 10, color: 'var(--doc-text-muted)' }}>tw</span>
            </div>
          )}
          <button
            type="button"
            style={{
              padding: '4px 12px',
              fontSize: 12,
              border: '1px solid var(--doc-border)',
              borderRadius: 4,
              backgroundColor: 'var(--doc-primary)',
              color: 'white',
              cursor: 'pointer',
              width: '100%',
            }}
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HEADER ROW SUBCOMPONENT
// ============================================================================

function HeaderRowRow({ onAction }: { onAction: (action: TableAction) => void }) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <button
      type="button"
      style={{
        ...menuItemStyles,
        backgroundColor: hoveredItem === 'main' ? 'var(--doc-bg-hover)' : 'transparent',
      }}
      onMouseEnter={() => setHoveredItem('main')}
      onMouseLeave={() => setHoveredItem(null)}
      onClick={() => onAction({ type: 'toggleHeaderRow' })}
    >
      <MaterialSymbol name="table_rows" size={18} />
      <span style={{ flex: 1 }}>Toggle header row</span>
    </button>
  );
}

// ============================================================================
// DISTRIBUTE / AUTO-FIT SUBCOMPONENTS
// ============================================================================

function DistributeColumnsRow({ onAction }: { onAction: (action: TableAction) => void }) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <button
      type="button"
      style={{
        ...menuItemStyles,
        backgroundColor: hoveredItem === 'main' ? 'var(--doc-bg-hover)' : 'transparent',
      }}
      onMouseEnter={() => setHoveredItem('main')}
      onMouseLeave={() => setHoveredItem(null)}
      onClick={() => onAction({ type: 'distributeColumns' })}
    >
      <MaterialSymbol name="view_column" size={18} />
      <span style={{ flex: 1 }}>Distribute columns evenly</span>
    </button>
  );
}

function AutoFitRow({ onAction }: { onAction: (action: TableAction) => void }) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <button
      type="button"
      style={{
        ...menuItemStyles,
        backgroundColor: hoveredItem === 'main' ? 'var(--doc-bg-hover)' : 'transparent',
      }}
      onMouseEnter={() => setHoveredItem('main')}
      onMouseLeave={() => setHoveredItem(null)}
      onClick={() => onAction({ type: 'autoFitContents' })}
    >
      <MaterialSymbol name="fit_width" size={18} />
      <span style={{ flex: 1 }}>Auto-fit to contents</span>
    </button>
  );
}

// ============================================================================
// TABLE PROPERTIES BUTTON
// ============================================================================

function TablePropertiesRow({ onAction }: { onAction: (action: TableAction) => void }) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <>
      <div style={separatorStyles} role="separator" />
      <button
        type="button"
        style={{
          ...menuItemStyles,
          backgroundColor: hoveredItem === 'main' ? 'var(--doc-bg-hover)' : 'transparent',
        }}
        onMouseEnter={() => setHoveredItem('main')}
        onMouseLeave={() => setHoveredItem(null)}
        onClick={() => onAction({ type: 'openTableProperties' })}
      >
        <MaterialSymbol name="settings" size={18} />
        <span style={{ flex: 1 }}>Table properties...</span>
      </button>
    </>
  );
}

// ============================================================================
// TABLE ALIGNMENT
// ============================================================================

function TableAlignmentRow({
  onAction,
  justification,
}: {
  onAction: (action: TableAction) => void;
  justification: 'left' | 'center' | 'right';
}) {
  const makeButton = (value: 'left' | 'center' | 'right', icon: string, label: string) => {
    const isActive = justification === value;
    return (
      <button
        type="button"
        style={{
          ...alignmentButtonStyles,
          backgroundColor: isActive ? 'var(--doc-primary-light)' : 'transparent',
          borderColor: isActive ? 'var(--doc-primary)' : 'var(--doc-border)',
          color: isActive ? 'var(--doc-primary)' : 'var(--doc-text)',
        }}
        onClick={() => onAction({ type: 'tableProperties', props: { justification: value } })}
        title={label}
        aria-label={label}
      >
        <MaterialSymbol name={icon} size={18} />
      </button>
    );
  };

  return (
    <>
      <div style={separatorStyles} role="separator" />
      <div style={alignmentRowStyles}>
        <span style={{ fontSize: 13, color: 'var(--doc-text-muted)', flex: 1 }}>
          Table alignment
        </span>
        {makeButton('left', 'format_align_left', 'Align table left')}
        {makeButton('center', 'format_align_center', 'Align table center')}
        {makeButton('right', 'format_align_right', 'Align table right')}
      </div>
    </>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TableOptionsDropdown({
  onAction,
  disabled = false,
  tableContext,
  className,
  tooltip = 'Table options',
}: TableOptionsDropdownProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const currentJustification =
    (tableContext?.table?.attrs?.justification as 'left' | 'center' | 'right' | null | undefined) ??
    'left';

  // Calculate position when opening
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleScroll = () => {
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleClick = useCallback(() => {
    if (!disabled) {
      setIsOpen((prev) => !prev);
    }
  }, [disabled]);

  const handleAction = useCallback(
    (action: TableAction) => {
      onAction?.(action);
      setIsOpen(false);
    },
    [onAction]
  );

  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        'text-slate-500 hover:text-slate-900 hover:bg-slate-100/80',
        isOpen && 'bg-slate-100',
        disabled && 'opacity-30 cursor-not-allowed',
        className
      )}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      disabled={disabled}
      aria-label={tooltip}
      aria-expanded={isOpen}
      aria-haspopup="menu"
      data-testid="toolbar-table-options"
    >
      <MaterialSymbol name="table" size={20} />
      <MaterialSymbol name="arrow_drop_down" size={16} className="-ml-1" />
    </Button>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {tooltip && !isOpen ? <Tooltip content={tooltip}>{button}</Tooltip> : button}

      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          className="docx-table-options-dropdown"
          style={{ ...baseDropdownStyles, top: dropdownPos.top, left: dropdownPos.left }}
          role="menu"
          aria-label="Table options menu"
          onMouseDown={(e) => {
            // Prevent ProseMirror from reclaiming focus when interacting
            // with form inputs (row height, cell margins, etc.) inside the dropdown
            e.stopPropagation();
          }}
        >
          {/* Regular menu items */}
          {MENU_ITEMS.map((item, index) => {
            const isDisabled = disabled || item.disabled?.(tableContext);
            const isHovered = hoveredItem === item.action && !isDisabled;

            return (
              <React.Fragment key={item.action}>
                <button
                  type="button"
                  role="menuitem"
                  style={{
                    ...menuItemStyles,
                    backgroundColor: isHovered ? 'var(--doc-bg-hover)' : 'transparent',
                    color: isDisabled
                      ? 'var(--doc-text-muted)'
                      : item.danger
                        ? 'var(--doc-error)'
                        : 'var(--doc-text)',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                  }}
                  onClick={() => !isDisabled && handleAction(item.action)}
                  onMouseEnter={() => setHoveredItem(item.action)}
                  onMouseLeave={() => setHoveredItem(null)}
                  disabled={isDisabled}
                  aria-disabled={isDisabled}
                >
                  <MaterialSymbol
                    name={item.icon}
                    size={18}
                    className={item.danger && !isDisabled ? 'text-red-600' : ''}
                  />
                  <span style={{ flex: 1 }}>{t(item.labelKey)}</span>
                  {item.shortcut && (
                    <span style={{ fontSize: 12, color: 'var(--doc-text-muted)' }}>
                      {item.shortcut}
                    </span>
                  )}
                </button>
                {item.separator && index < MENU_ITEMS.length - 1 && (
                  <div style={separatorStyles} role="separator" />
                )}
              </React.Fragment>
            );
          })}

          {/* Vertical alignment section */}
          <div style={separatorStyles} role="separator" />
          <VerticalAlignRow onAction={handleAction} />

          {/* Cell margins section */}
          <CellMarginsRow onAction={handleAction} />

          {/* Text direction + no-wrap section */}
          <div style={separatorStyles} role="separator" />
          <TextDirectionRow onAction={handleAction} />
          <NoWrapRow onAction={handleAction} />
          <RowHeightRow onAction={handleAction} />
          <HeaderRowRow onAction={handleAction} />
          <DistributeColumnsRow onAction={handleAction} />
          <AutoFitRow onAction={handleAction} />
          <TableAlignmentRow onAction={handleAction} justification={currentJustification} />
          <TablePropertiesRow onAction={handleAction} />
        </div>
      )}
    </div>
  );
}

export default TableOptionsDropdown;
