import { useState, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { ColorValue, Theme, ThemeColorScheme } from '@eigenpal/docx-core/types/document';
import {
  generateThemeTintShadeMatrix,
  resolveColor,
  resolveHighlightColor,
} from '@eigenpal/docx-core/utils/colorResolver';
import type { ThemeMatrixCell } from '@eigenpal/docx-core/utils/colorResolver';
import { useFixedDropdown } from './useFixedDropdown';
import { MaterialSymbol } from './MaterialSymbol';

// ============================================================================
// TYPES
// ============================================================================

export type AdvancedColorPickerMode = 'text' | 'highlight' | 'border';

export interface AdvancedColorPickerProps {
  mode: AdvancedColorPickerMode;
  value?: ColorValue | string;
  onChange?: (color: ColorValue | string) => void;
  theme?: Theme | null;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Override the default icon for the mode */
  icon?: string;
  /** Override the auto/no-color button label */
  autoLabel?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STANDARD_COLORS: Array<{ name: string; hex: string }> = [
  { name: 'Dark Red', hex: 'C00000' },
  { name: 'Red', hex: 'FF0000' },
  { name: 'Orange', hex: 'FFC000' },
  { name: 'Yellow', hex: 'FFFF00' },
  { name: 'Light Green', hex: '92D050' },
  { name: 'Green', hex: '00B050' },
  { name: 'Light Blue', hex: '00B0F0' },
  { name: 'Blue', hex: '0070C0' },
  { name: 'Dark Blue', hex: '002060' },
  { name: 'Purple', hex: '7030A0' },
];

const CELL_SIZE = 18;
const GAP = 2;

// ============================================================================
// STYLES
// ============================================================================

const S_CONTAINER: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

const S_BUTTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '40px',
  height: '32px',
  padding: '2px 6px',
  border: 'none',
  borderRadius: '4px',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  color: 'var(--doc-text-muted)',
};

const S_DROPDOWN: CSSProperties = {
  padding: '10px',
  backgroundColor: '#fff',
  border: '1px solid #d0d0d0',
  borderRadius: '6px',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
  width: 'auto',
};

const S_SECTION_LABEL: CSSProperties = {
  fontSize: '11px',
  color: '#666',
  marginBottom: '4px',
  fontWeight: 500,
};

const S_DIVIDER: CSSProperties = {
  height: '1px',
  backgroundColor: '#e0e0e0',
  margin: '8px 0',
};

const S_GRID: CSSProperties = {
  display: 'grid',
  gap: `${GAP}px`,
};

const S_CELL: CSSProperties = {
  width: `${CELL_SIZE}px`,
  height: `${CELL_SIZE}px`,
  border: '1px solid #c0c0c0',
  borderRadius: '2px',
  cursor: 'pointer',
  padding: 0,
  transition: 'transform 0.1s, border-color 0.1s',
};

const S_CELL_HOVER: CSSProperties = {
  ...S_CELL,
  transform: 'scale(1.15)',
  borderColor: '#333',
  zIndex: 1,
};

const S_CELL_SELECTED: CSSProperties = {
  ...S_CELL,
  borderWidth: '2px',
  borderColor: '#0066cc',
  boxShadow: '0 0 0 1px #0066cc',
};

const S_AUTO_BUTTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '5px 8px',
  border: '1px solid #d0d0d0',
  borderRadius: '4px',
  backgroundColor: '#fff',
  cursor: 'pointer',
  fontSize: '12px',
  color: '#333',
};

const S_CUSTOM_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const S_HEX_INPUT: CSSProperties = {
  width: '70px',
  height: '24px',
  padding: '2px 6px',
  border: '1px solid #ccc',
  borderRadius: '3px',
  fontSize: '12px',
};

const S_APPLY_BTN: CSSProperties = {
  height: '24px',
  padding: '0 10px',
  border: '1px solid #ccc',
  borderRadius: '3px',
  backgroundColor: '#f5f5f5',
  fontSize: '12px',
  cursor: 'pointer',
};

const S_COLOR_BAR: CSSProperties = {
  width: '14px',
  height: '3px',
  borderRadius: '0',
  marginTop: '-2px',
};

// ============================================================================
// HELPERS
// ============================================================================

function resolveCurrentColor(
  value: ColorValue | string | undefined,
  mode: AdvancedColorPickerMode,
  theme: Theme | null | undefined
): string {
  if (!value) {
    return mode === 'text' || mode === 'border' ? '#000000' : 'transparent';
  }
  if (typeof value === 'string') {
    if (mode === 'highlight') {
      // Try OOXML named color first, then treat as hex
      const resolved = resolveHighlightColor(value);
      if (resolved) return resolved;
      if (value === 'none') return 'transparent';
      return value.startsWith('#') ? value : `#${value}`;
    }
    return value.startsWith('#') ? value : `#${value}`;
  }
  return resolveColor(value, theme);
}

function isSelectedCell(
  value: ColorValue | string | undefined,
  cellHex: string,
  theme: Theme | null | undefined
): boolean {
  if (!value) return false;
  const resolved =
    typeof value === 'string'
      ? value.replace(/^#/, '').toUpperCase()
      : resolveColor(value, theme).replace(/^#/, '').toUpperCase();
  return resolved === cellHex.toUpperCase();
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function ThemeColorMatrix({
  matrix,
  selectedColor,
  theme,
  onSelect,
}: {
  matrix: ThemeMatrixCell[][];
  selectedColor?: ColorValue | string;
  theme?: Theme | null;
  onSelect: (cell: ThemeMatrixCell) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={{ ...S_GRID, gridTemplateColumns: `repeat(10, ${CELL_SIZE}px)` }}>
      {matrix.flatMap((row, ri) =>
        row.map((cell, ci) => {
          const key = `${ri}-${ci}`;
          const isHov = hovered === key;
          const isSel = isSelectedCell(selectedColor, cell.hex, theme);
          return (
            <button
              key={key}
              type="button"
              style={{
                ...(isSel ? S_CELL_SELECTED : isHov ? S_CELL_HOVER : S_CELL),
                backgroundColor: `#${cell.hex}`,
              }}
              title={cell.label}
              aria-label={cell.label}
              aria-selected={isSel}
              onClick={() => onSelect(cell)}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })
      )}
    </div>
  );
}

function StandardColorRow({
  selectedColor,
  theme,
  onSelect,
}: {
  selectedColor?: ColorValue | string;
  theme?: Theme | null;
  onSelect: (hex: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div style={{ ...S_GRID, gridTemplateColumns: `repeat(10, ${CELL_SIZE}px)` }}>
      {STANDARD_COLORS.map((c, i) => {
        const isHov = hovered === i;
        const isSel = isSelectedCell(selectedColor, c.hex, theme);
        return (
          <button
            key={c.hex}
            type="button"
            style={{
              ...(isSel ? S_CELL_SELECTED : isHov ? S_CELL_HOVER : S_CELL),
              backgroundColor: `#${c.hex}`,
            }}
            title={c.name}
            aria-label={c.name}
            aria-selected={isSel}
            onClick={() => onSelect(c.hex)}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AdvancedColorPicker({
  mode,
  value,
  onChange,
  theme,
  disabled = false,
  className,
  style,
  title,
  icon: iconOverride,
  autoLabel,
}: AdvancedColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [customHex, setCustomHex] = useState('');

  const onClose = useCallback(() => setIsOpen(false), []);
  const { containerRef, dropdownRef, dropdownStyle } = useFixedDropdown({
    isOpen,
    onClose,
  });

  const colorScheme: ThemeColorScheme | null = theme?.colorScheme ?? null;
  const matrix = useMemo(() => generateThemeTintShadeMatrix(colorScheme), [colorScheme]);

  const resolvedColor = useMemo(
    () => resolveCurrentColor(value, mode, theme),
    [value, mode, theme]
  );

  const toggleDropdown = useCallback(() => {
    if (!disabled) setIsOpen((prev) => !prev);
  }, [disabled]);

  // --- Handlers ---

  const handleThemeCellSelect = useCallback(
    (cell: ThemeMatrixCell) => {
      if (mode === 'highlight') {
        // Highlight mode: emit hex string (the highlight mark supports any color)
        onChange?.(cell.hex);
      } else {
        const colorValue: ColorValue = {
          themeColor: cell.themeSlot,
          rgb: cell.hex,
        };
        if (cell.tint) colorValue.themeTint = cell.tint;
        if (cell.shade) colorValue.themeShade = cell.shade;
        onChange?.(colorValue);
      }
      setIsOpen(false);
    },
    [mode, onChange]
  );

  const handleStandardColorSelect = useCallback(
    (hex: string) => {
      if (mode === 'highlight') {
        onChange?.(hex);
      } else {
        onChange?.({ rgb: hex });
      }
      setIsOpen(false);
    },
    [mode, onChange]
  );

  const handleAutomatic = useCallback(() => {
    if (mode === 'highlight') {
      onChange?.('none');
    } else {
      onChange?.({ auto: true });
    }
    setIsOpen(false);
  }, [mode, onChange]);

  const handleCustomApply = useCallback(() => {
    const hex = customHex.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/i.test(hex)) {
      if (mode === 'highlight') {
        onChange?.(hex);
      } else {
        onChange?.({ rgb: hex });
      }
      setIsOpen(false);
      setCustomHex('');
    }
  }, [mode, customHex, onChange]);

  // --- Button style ---
  const buttonStyle: CSSProperties = {
    ...S_BUTTON,
    ...(disabled
      ? { cursor: 'default', opacity: 0.38 }
      : isOpen
        ? { backgroundColor: 'var(--doc-primary-light)', color: 'var(--doc-primary)' }
        : isHovered
          ? { backgroundColor: 'var(--doc-bg-hover)' }
          : {}),
  };

  const defaultTitle =
    mode === 'text' ? 'Font Color' : mode === 'highlight' ? 'Text Highlight Color' : 'Border Color';

  const iconName =
    iconOverride ??
    (mode === 'text'
      ? 'format_color_text'
      : mode === 'highlight'
        ? 'ink_highlighter'
        : 'border_color');

  return (
    <div
      ref={containerRef}
      className={`docx-advanced-color-picker ${className || ''}`}
      style={{ ...S_CONTAINER, ...style }}
    >
      <button
        type="button"
        className="docx-advanced-color-picker-button"
        style={buttonStyle}
        onClick={toggleDropdown}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        disabled={disabled}
        title={title || defaultTitle}
        aria-label={title || defaultTitle}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          <MaterialSymbol name={iconName} size={18} />
          <div
            style={{
              ...S_COLOR_BAR,
              backgroundColor: resolvedColor === 'transparent' ? '#fff' : resolvedColor,
              border: resolvedColor === 'transparent' ? '1px solid #ccc' : 'none',
            }}
          />
        </div>
        <MaterialSymbol name="arrow_drop_down" size={14} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="docx-advanced-color-picker-dropdown"
          style={{ ...dropdownStyle, ...S_DROPDOWN }}
          role="dialog"
          aria-label={`${defaultTitle} picker`}
          onMouseDown={(e) => {
            // Allow input elements to receive focus, prevent focus steal for everything else
            if ((e.target as HTMLElement).tagName !== 'INPUT') {
              e.preventDefault();
            }
          }}
        >
          {/* All modes share the same layout */}
          <>
            <button
              type="button"
              style={S_AUTO_BUTTON}
              onClick={handleAutomatic}
              onMouseDown={(e) => e.preventDefault()}
            >
              {mode === 'highlight' ? (
                <span
                  style={{
                    display: 'inline-block',
                    width: '16px',
                    height: '16px',
                    border: '1px solid #ccc',
                    borderRadius: '2px',
                    position: 'relative',
                    backgroundColor: '#fff',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '-1px',
                      right: '-1px',
                      height: '2px',
                      backgroundColor: '#ff0000',
                      transform: 'rotate(-45deg)',
                    }}
                  />
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-block',
                    width: '16px',
                    height: '16px',
                    backgroundColor: '#000',
                    borderRadius: '2px',
                  }}
                />
              )}
              {autoLabel ?? (mode === 'highlight' ? 'No Color' : 'Automatic')}
            </button>
            <div style={S_DIVIDER} />
            <div style={S_SECTION_LABEL}>Theme Colors</div>
            <ThemeColorMatrix
              matrix={matrix}
              selectedColor={value}
              theme={theme}
              onSelect={handleThemeCellSelect}
            />
            <div style={S_DIVIDER} />
            <div style={S_SECTION_LABEL}>Standard Colors</div>
            <StandardColorRow
              selectedColor={value}
              theme={theme}
              onSelect={handleStandardColorSelect}
            />
            <div style={S_DIVIDER} />
            <div style={S_SECTION_LABEL}>Custom Color</div>
            <div style={S_CUSTOM_ROW}>
              <span style={{ fontSize: '12px', color: '#666' }}>#</span>
              <input
                type="text"
                style={S_HEX_INPUT}
                value={customHex}
                onChange={(e) =>
                  setCustomHex(e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomApply();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                placeholder="FF0000"
                maxLength={6}
                aria-label="Custom hex color"
              />
              <button
                type="button"
                style={{
                  ...S_APPLY_BTN,
                  opacity: /^[0-9A-Fa-f]{6}$/.test(customHex) ? 1 : 0.4,
                  cursor: /^[0-9A-Fa-f]{6}$/.test(customHex) ? 'pointer' : 'default',
                }}
                onClick={handleCustomApply}
                onMouseDown={(e) => e.preventDefault()}
                disabled={!/^[0-9A-Fa-f]{6}$/.test(customHex)}
              >
                Apply
              </button>
            </div>
          </>
        </div>
      )}
    </div>
  );
}

export default AdvancedColorPicker;
