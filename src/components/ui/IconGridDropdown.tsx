/**
 * Shared icon-grid dropdown used by image toolbar controls.
 *
 * Renders a trigger button (icon + chevron) that opens a floating
 * row of icon buttons. Handles click-outside, Escape, focus-stealing
 * prevention, and optional active-state highlighting.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { cn } from '../../lib/utils';

const ICON_SIZE = 20;

export interface IconGridOption<T extends string = string> {
  value: T;
  label: string;
  iconName: string;
}

export interface IconGridDropdownProps<T extends string = string> {
  /** Options to display in the grid */
  options: IconGridOption<T>[];
  /** Currently active value (highlighted in the grid), or null */
  activeValue?: T | null;
  /** Icon shown on the trigger button */
  triggerIcon: string;
  /** Tooltip text when closed */
  tooltipContent: string;
  /** Fired when an option is clicked */
  onSelect: (value: T) => void;
  disabled?: boolean;
  /** aria-label for the trigger button */
  ariaLabel?: string;
  /** data-testid for the trigger button */
  testId?: string;
}

export function IconGridDropdown<T extends string = string>({
  options,
  activeValue,
  triggerIcon,
  tooltipContent,
  onSelect,
  disabled = false,
  ariaLabel,
  testId,
}: IconGridDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click-outside and Escape
  useEffect(() => {
    if (!isOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isOpen]);

  // Prevent focus stealing from ProseMirror
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleOptionClick = useCallback(
    (value: T) => {
      if (!disabled) onSelect(value);
      setIsOpen(false);
    },
    [disabled, onSelect]
  );

  const triggerButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        'text-slate-500 hover:text-slate-900 hover:bg-slate-100/80',
        isOpen && 'bg-slate-100',
        disabled && 'opacity-30 cursor-not-allowed'
      )}
      onMouseDown={handleMouseDown}
      onClick={() => !disabled && setIsOpen((prev) => !prev)}
      disabled={disabled}
      aria-label={ariaLabel ?? tooltipContent}
      aria-expanded={isOpen}
      aria-haspopup="true"
      data-testid={testId}
    >
      <MaterialSymbol name={triggerIcon} size={ICON_SIZE} />
      <MaterialSymbol name="arrow_drop_down" size={14} className="-ml-1" />
    </Button>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {!isOpen ? <Tooltip content={tooltipContent}>{triggerButton}</Tooltip> : triggerButton}

      {isOpen && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            backgroundColor: 'white',
            border: '1px solid var(--doc-border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
            padding: 6,
            zIndex: 1000,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', gap: 2 }}>
            {options.map((option) => {
              const isActive = activeValue === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  data-testid={testId ? `${testId}-${option.value}` : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    border: '1px solid transparent',
                    borderRadius: 4,
                    backgroundColor: isActive ? 'var(--doc-primary-light)' : 'transparent',
                    cursor: 'pointer',
                    color: isActive ? 'var(--doc-primary)' : 'var(--doc-text)',
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                        'var(--doc-bg-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = isActive
                      ? 'var(--doc-primary-light)'
                      : 'transparent';
                  }}
                  onClick={() => handleOptionClick(option.value)}
                >
                  <MaterialSymbol name={option.iconName} size={18} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
