/**
 * TableGridPicker Component
 *
 * A compact grid picker dropdown for inserting tables.
 * Wraps TableGridInline with a toolbar button and dropdown.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { MaterialSymbol } from './MaterialSymbol';
import { TableGridInline } from './TableGridInline';
import { cn } from '../../lib/utils';

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

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  backgroundColor: 'white',
  border: '1px solid var(--doc-border)',
  borderRadius: 6,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
  padding: 8,
  zIndex: 1000,
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

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
        <div className="docx-table-grid-picker-dropdown" style={dropdownStyle}>
          <TableGridInline onInsert={handleInsert} gridRows={gridRows} gridColumns={gridColumns} />
        </div>
      )}
    </div>
  );
}

export default TableGridPicker;
