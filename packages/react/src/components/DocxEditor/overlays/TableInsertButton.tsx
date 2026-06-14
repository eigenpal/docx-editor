/**
 * Floating "+" button rendered over the visible pages when the user
 * hovers near a table row / column boundary. Click inserts a row below
 * (or a column to the right) at the cell the hit-test resolved to.
 *
 * The hover hit-test, position tracking, and click dispatch all live in
 * `usePagesPointer`. This component is just the visual.
 */

import React from 'react';

export interface TableInsertButtonProps {
  type: 'row' | 'column';
  x: number;
  y: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function TableInsertButton({
  type,
  x,
  y,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: TableInsertButtonProps) {
  const label = type === 'row' ? 'Insert row below' : 'Insert column to the right';
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 20,
        height: 20,
        borderRadius: '4px',
        border: '1px solid var(--doc-border-light)',
        backgroundColor: 'var(--doc-bg)',
        color: 'var(--doc-text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 200,
        padding: 0,
        boxShadow: 'none',
      }}
      title={label}
      aria-label={label}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
