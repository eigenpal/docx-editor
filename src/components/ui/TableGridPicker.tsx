/**
 * TableGridPicker Component
 *
 * A compact grid picker dropdown for inserting tables.
 * Wraps TableGridInline with a toolbar button and dropdown.
 */

import React, { useState, useCallback } from 'react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { MaterialSymbol } from './MaterialSymbol';
import { TableGridInline } from './TableGridInline';
import { cn } from '../../lib/utils';
import { useFixedDropdown } from './useFixedDropdown';

// ============================================================================
// TYPES
// ============================================================================

export interface TableGridPickerProps {
  /** Callback when table dimensions are selected */
  onInsert: (rows: number, columns: number) => void;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Grid dimensions (default 5x5) */
  gridRows?: number;
  gridColumns?: number;
  /** Additional CSS class */
  className?: string;
  /** Tooltip text */
  tooltip?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_GRID_ROWS = 5;
const DEFAULT_GRID_COLUMNS = 5;

// ============================================================================
// STYLES
// ============================================================================

const dropdownPanelStyle: React.CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid var(--doc-border)',
  borderRadius: 6,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
  padding: 8,
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TableGridPicker({
  onInsert,
  disabled = false,
  gridRows = DEFAULT_GRID_ROWS,
  gridColumns = DEFAULT_GRID_COLUMNS,
  className,
  tooltip = 'Insert table',
}: TableGridPickerProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const onClose = useCallback(() => setIsOpen(false), []);
  const { containerRef, dropdownRef, dropdownStyle } = useFixedDropdown({
    isOpen,
    onClose,
  });

  // Handle toggle dropdown
  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!disabled) {
        setIsOpen((prev) => !prev);
      }
    },
    [disabled]
  );

  const handleInsert = useCallback(
    (rows: number, columns: number) => {
      onInsert(rows, columns);
      setIsOpen(false);
    },
    [onInsert]
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
      onMouseDown={handleToggle}
      disabled={disabled}
      aria-label={tooltip}
      aria-expanded={isOpen}
      aria-haspopup="grid"
      data-testid="toolbar-insert-table"
    >
      <MaterialSymbol name="grid_on" size={20} />
    </Button>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button}

      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          className="docx-table-grid-picker-dropdown"
          style={{ ...dropdownStyle, ...dropdownPanelStyle }}
        >
          <TableGridInline onInsert={handleInsert} gridRows={gridRows} gridColumns={gridColumns} />
        </div>
      )}
    </div>
  );
}

export default TableGridPicker;
