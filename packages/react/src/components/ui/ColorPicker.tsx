/**
 * Color Picker Component
 *
 * A color picker for the DOCX editor supporting:
 * - Grid of common colors
 * - Text color button (foreground)
 * - Highlight color button (background)
 * - Shows current color of selection
 */

import { useState, useCallback, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ColorValue, Theme } from '@eigenpal/docx-core/types/document';
import { resolveHighlightColor } from '@eigenpal/docx-core/utils/colorResolver';
import { useFixedDropdown } from './useFixedDropdown';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Color option for the color grid
 */
export interface ColorOption {
  /** Display name for the color (used as fallback) */
  name: string;
  /** i18n key for the color name (used with t() when available) */
  nameKey?: TranslationKey;
  /** Hex value (without #) */
  hex: string;
  /** Is this a theme color? */
  isTheme?: boolean;
  /** Theme color slot if applicable */
  themeSlot?: string;
}

/**
 * Props for the ColorPicker component
 */
export interface ColorPickerProps {
  /** Current color value */
  value?: string;
  /** Callback when color is selected */
  onChange?: (color: string) => void;
  /** Type of color picker */
  type?: 'text' | 'highlight';
  /** Theme for resolving theme colors */
  theme?: Theme | null;
  /** Custom colors to display */
  colors?: ColorOption[];
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Placeholder/tooltip text */
  title?: string;
  /** Custom button content */
  children?: ReactNode;
  /** Width of the dropdown */
  dropdownWidth?: number;
  /** Show "No Color" option */
  showNoColor?: boolean;
  /** Show "More Colors" option for custom input */
  showMoreColors?: boolean;
}

/**
 * Props for the ColorGrid component
 */
export interface ColorGridProps {
  /** Colors to display in the grid */
  colors: ColorOption[];
  /** Currently selected color (hex) */
  selectedColor?: string;
  /** Callback when a color is clicked */
  onSelect: (color: ColorOption) => void;
  /** Number of columns in the grid */
  columns?: number;
  /** Cell size in pixels */
  cellSize?: number;
}

// ============================================================================
// DEFAULT COLORS
// ============================================================================

/**
 * Standard Word text colors
 */
const TEXT_COLORS: ColorOption[] = [
  // Row 1: Theme colors (would be resolved from theme)
  { name: 'Black', nameKey: 'colorPicker.colors.black', hex: '000000' },
  { name: 'Dark Red', nameKey: 'colorPicker.colors.darkRed', hex: '7F0000' },
  { name: 'Dark Orange', nameKey: 'colorPicker.colors.darkOrange', hex: 'FF6600' },
  { name: 'Dark Yellow', nameKey: 'colorPicker.colors.darkYellow', hex: '808000' },
  { name: 'Dark Green', nameKey: 'colorPicker.colors.darkGreen', hex: '006400' },
  { name: 'Dark Teal', nameKey: 'colorPicker.colors.darkTeal', hex: '008080' },
  { name: 'Dark Blue', nameKey: 'colorPicker.colors.darkBlue', hex: '000080' },
  { name: 'Dark Purple', nameKey: 'colorPicker.colors.darkPurple', hex: '4B0082' },
  { name: 'Dark Gray', nameKey: 'colorPicker.colors.darkGray', hex: '404040' },
  { name: 'Gray', nameKey: 'colorPicker.colors.gray', hex: '808080' },

  // Row 2: Standard colors
  { name: 'Red', nameKey: 'colorPicker.colors.red', hex: 'FF0000' },
  { name: 'Orange', nameKey: 'colorPicker.colors.orange', hex: 'FF9900' },
  { name: 'Yellow', nameKey: 'colorPicker.colors.yellow', hex: 'FFFF00' },
  { name: 'Light Green', nameKey: 'colorPicker.colors.lightGreen', hex: '00FF00' },
  { name: 'Cyan', nameKey: 'colorPicker.colors.cyan', hex: '00FFFF' },
  { name: 'Light Blue', nameKey: 'colorPicker.colors.lightBlue', hex: '0066FF' },
  { name: 'Blue', nameKey: 'colorPicker.colors.blue', hex: '0000FF' },
  { name: 'Purple', nameKey: 'colorPicker.colors.purple', hex: '9900FF' },
  { name: 'Magenta', nameKey: 'colorPicker.colors.magenta', hex: 'FF00FF' },
  { name: 'Pink', nameKey: 'colorPicker.colors.pink', hex: 'FF66FF' },

  // Row 3: Tints
  { name: 'Light Red', nameKey: 'colorPicker.colors.lightRed', hex: 'FFCCCC' },
  { name: 'Light Orange', nameKey: 'colorPicker.colors.lightOrange', hex: 'FFE5CC' },
  { name: 'Light Yellow', nameKey: 'colorPicker.colors.lightYellow', hex: 'FFFFCC' },
  { name: 'Pale Green', nameKey: 'colorPicker.colors.paleGreen', hex: 'CCFFCC' },
  { name: 'Light Cyan', nameKey: 'colorPicker.colors.lightCyan', hex: 'CCFFFF' },
  { name: 'Sky Blue', nameKey: 'colorPicker.colors.skyBlue', hex: 'CCE5FF' },
  { name: 'Light Blue 2', nameKey: 'colorPicker.colors.lightBlue2', hex: 'CCCCFF' },
  { name: 'Lavender', nameKey: 'colorPicker.colors.lavender', hex: 'E5CCFF' },
  { name: 'Light Magenta', nameKey: 'colorPicker.colors.lightMagenta', hex: 'FFCCFF' },
  { name: 'White', nameKey: 'colorPicker.colors.white', hex: 'FFFFFF' },
];

/**
 * Standard Word highlight colors
 */
const HIGHLIGHT_COLORS: ColorOption[] = [
  { name: 'No Color', nameKey: 'colorPicker.noColor', hex: '' },
  { name: 'Yellow', nameKey: 'colorPicker.colors.yellow', hex: 'FFFF00' },
  { name: 'Bright Green', nameKey: 'colorPicker.colors.brightGreen', hex: '00FF00' },
  { name: 'Cyan', nameKey: 'colorPicker.colors.cyan', hex: '00FFFF' },
  { name: 'Magenta', nameKey: 'colorPicker.colors.magenta', hex: 'FF00FF' },
  { name: 'Blue', nameKey: 'colorPicker.colors.blue', hex: '0000FF' },
  { name: 'Red', nameKey: 'colorPicker.colors.red', hex: 'FF0000' },
  { name: 'Dark Blue', nameKey: 'colorPicker.colors.darkBlue', hex: '00008B' },
  { name: 'Teal', nameKey: 'colorPicker.colors.teal', hex: '008080' },
  { name: 'Green', nameKey: 'colorPicker.colors.green', hex: '008000' },
  { name: 'Violet', nameKey: 'colorPicker.colors.violet', hex: '800080' },
  { name: 'Dark Red', nameKey: 'colorPicker.colors.darkRed', hex: '8B0000' },
  { name: 'Dark Yellow', nameKey: 'colorPicker.colors.darkYellow', hex: '808000' },
  { name: 'Gray 50%', nameKey: 'colorPicker.colors.grey50', hex: '808080' },
  { name: 'Gray 25%', nameKey: 'colorPicker.colors.grey25', hex: 'C0C0C0' },
  { name: 'Black', nameKey: 'colorPicker.colors.black', hex: '000000' },
];

// ============================================================================
// STYLES
// ============================================================================

const PICKER_CONTAINER_STYLE: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

const BUTTON_STYLE: CSSProperties = {
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

const BUTTON_HOVER_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: 'var(--doc-bg-hover)',
};

const BUTTON_ACTIVE_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: 'var(--doc-primary-light)',
  color: 'var(--doc-primary)',
};

const BUTTON_DISABLED_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  cursor: 'default',
  opacity: 0.38,
};

const COLOR_INDICATOR_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0',
};

const COLOR_BAR_STYLE: CSSProperties = {
  width: '14px',
  height: '3px',
  borderRadius: '0',
  marginTop: '-2px',
};

const GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: '2px',
};

const GRID_CELL_STYLE: CSSProperties = {
  width: '20px',
  height: '20px',
  border: '1px solid #ccc',
  borderRadius: '2px',
  cursor: 'pointer',
  transition: 'transform 0.1s, border-color 0.1s',
  padding: 0,
};

const GRID_CELL_HOVER_STYLE: CSSProperties = {
  ...GRID_CELL_STYLE,
  transform: 'scale(1.1)',
  borderColor: '#333',
  zIndex: 1,
};

const GRID_CELL_SELECTED_STYLE: CSSProperties = {
  ...GRID_CELL_STYLE,
  borderWidth: '2px',
  borderColor: '#0066cc',
  boxShadow: '0 0 0 1px #0066cc',
};

const NO_COLOR_CELL_STYLE: CSSProperties = {
  ...GRID_CELL_STYLE,
  position: 'relative',
  backgroundColor: '#fff',
};

const NO_COLOR_LINE_STYLE: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '-2px',
  right: '-2px',
  height: '2px',
  backgroundColor: '#ff0000',
  transform: 'rotate(-45deg)',
};

const SECTION_LABEL_STYLE: CSSProperties = {
  fontSize: '11px',
  color: '#666',
  marginBottom: '4px',
  marginTop: '8px',
};

const CUSTOM_COLOR_SECTION_STYLE: CSSProperties = {
  marginTop: '8px',
  paddingTop: '8px',
  borderTop: '1px solid #eee',
};

const CUSTOM_COLOR_INPUT_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const HEX_INPUT_STYLE: CSSProperties = {
  width: '70px',
  height: '24px',
  padding: '2px 6px',
  border: '1px solid #ccc',
  borderRadius: '3px',
  fontSize: '12px',
};

const APPLY_BUTTON_STYLE: CSSProperties = {
  height: '24px',
  padding: '0 8px',
  border: '1px solid #ccc',
  borderRadius: '3px',
  backgroundColor: '#f5f5f5',
  fontSize: '12px',
  cursor: 'pointer',
};

// ============================================================================
// ICONS (using Material Symbols)
// ============================================================================

import { MaterialSymbol } from './MaterialSymbol';

const TextColorIcon = () => <MaterialSymbol name="format_color_text" size={18} />;

const HighlightIcon = () => <MaterialSymbol name="ink_highlighter" size={18} />;

const ChevronDownIcon = () => <MaterialSymbol name="arrow_drop_down" size={14} />;

// ============================================================================
// COLOR GRID COMPONENT
// ============================================================================

/**
 * Color grid for displaying selectable colors
 */
export function ColorGrid({
  colors,
  selectedColor,
  onSelect,
  columns = 10,
  cellSize = 20,
}: ColorGridProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { t } = useTranslation();

  const gridStyle: CSSProperties = {
    ...GRID_STYLE,
    gridTemplateColumns: `repeat(${columns}, ${cellSize}px)`,
  };

  return (
    <div style={gridStyle} className="docx-color-grid" role="grid">
      {colors.map((color, index) => {
        const isSelected = selectedColor?.toUpperCase() === color.hex.toUpperCase();
        const isHovered = hoveredIndex === index;
        const isNoColor = color.hex === '';
        const displayName = color.nameKey ? t(color.nameKey) : color.name;

        const cellStyle: CSSProperties = {
          ...(isSelected
            ? GRID_CELL_SELECTED_STYLE
            : isHovered
              ? GRID_CELL_HOVER_STYLE
              : GRID_CELL_STYLE),
          width: `${cellSize}px`,
          height: `${cellSize}px`,
        };

        if (!isNoColor) {
          cellStyle.backgroundColor = `#${color.hex}`;
        }

        return (
          <button
            key={`${color.hex}-${index}`}
            type="button"
            style={isNoColor ? { ...NO_COLOR_CELL_STYLE, ...cellStyle } : cellStyle}
            onClick={() => onSelect(color)}
            onMouseDown={(e) => e.preventDefault()} // Prevent focus stealing from editor
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            title={displayName}
            role="gridcell"
            aria-label={displayName}
            aria-selected={isSelected}
          >
            {isNoColor && <span style={NO_COLOR_LINE_STYLE} />}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Color picker component with dropdown grid
 */
export function ColorPicker({
  value,
  onChange,
  type = 'text',
  theme: _theme,
  colors,
  disabled = false,
  className,
  style,
  title,
  children,
  dropdownWidth = 230,
  showNoColor = true,
  showMoreColors = true,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [customHex, setCustomHex] = useState('');
  const { t } = useTranslation();

  const onClose = useCallback(() => setIsOpen(false), []);
  const { containerRef, dropdownRef, dropdownStyle } = useFixedDropdown({
    isOpen,
    onClose,
  });

  // Get default colors based on type
  const defaultColors = useMemo(() => {
    if (type === 'highlight') {
      return HIGHLIGHT_COLORS;
    }
    const baseColors = [...TEXT_COLORS];
    if (showNoColor) {
      // Add "Automatic" option at the beginning for text color
      baseColors.unshift({ name: 'Automatic', nameKey: 'colorPicker.automatic', hex: '000000' });
    }
    return baseColors;
  }, [type, showNoColor]);

  const displayColors = colors || defaultColors;

  // Resolve current color for display
  const resolvedColor = useMemo(() => {
    if (!value) {
      return type === 'text' ? '#000000' : 'transparent';
    }
    // If value is already a hex color
    if (value.startsWith('#')) {
      return value;
    }
    // If it's a highlight color name
    if (type === 'highlight') {
      const resolved = resolveHighlightColor(value);
      return resolved || 'transparent';
    }
    // Otherwise treat as hex without #
    return `#${value}`;
  }, [value, type]);

  /**
   * Handle color selection from grid
   */
  const handleColorSelect = useCallback(
    (color: ColorOption) => {
      onChange?.(color.hex);
      setIsOpen(false);
    },
    [onChange]
  );

  /**
   * Handle custom color input
   */
  const handleCustomColorApply = useCallback(() => {
    const hex = customHex.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/i.test(hex)) {
      onChange?.(hex);
      setIsOpen(false);
      setCustomHex('');
    }
  }, [customHex, onChange]);

  /**
   * Toggle dropdown
   */
  const toggleDropdown = useCallback(() => {
    if (!disabled) {
      setIsOpen((prev) => !prev);
    }
  }, [disabled]);

  // Determine button style
  const buttonStyle: CSSProperties = disabled
    ? BUTTON_DISABLED_STYLE
    : isOpen
      ? BUTTON_ACTIVE_STYLE
      : isHovered
        ? BUTTON_HOVER_STYLE
        : BUTTON_STYLE;

  const defaultTitle =
    type === 'text' ? t('formattingBar.fontColor') : t('formattingBar.highlightColor');

  return (
    <div
      ref={containerRef}
      className={`docx-color-picker docx-color-picker-${type} ${className || ''}`}
      style={{ ...PICKER_CONTAINER_STYLE, ...style }}
    >
      <button
        type="button"
        className="docx-color-picker-button"
        style={buttonStyle}
        onClick={toggleDropdown}
        onMouseDown={(e) => e.preventDefault()} // Prevent focus stealing from editor
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        disabled={disabled}
        title={title || defaultTitle}
        aria-label={title || defaultTitle}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {children || (
          <div style={COLOR_INDICATOR_STYLE}>
            {type === 'text' ? <TextColorIcon /> : <HighlightIcon />}
            <div
              style={{
                ...COLOR_BAR_STYLE,
                backgroundColor: resolvedColor === 'transparent' ? '#fff' : resolvedColor,
                border: resolvedColor === 'transparent' ? '1px solid #ccc' : 'none',
              }}
            />
          </div>
        )}
        <ChevronDownIcon />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="docx-color-picker-dropdown"
          style={{
            ...dropdownStyle,
            padding: '8px',
            backgroundColor: '#fff',
            border: '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            width: dropdownWidth,
          }}
          role="dialog"
          aria-label={t('colorPicker.ariaLabel', { type: type === 'text' ? 'Font' : 'Highlight' })}
          onMouseDown={(e) => e.preventDefault()} // Prevent focus stealing from editor
        >
          {type === 'highlight' && (
            <div style={SECTION_LABEL_STYLE}>{t('colorPicker.highlightColors')}</div>
          )}

          <ColorGrid
            colors={displayColors}
            selectedColor={value}
            onSelect={handleColorSelect}
            columns={type === 'highlight' ? 8 : 10}
          />

          {showMoreColors && type === 'text' && (
            <div style={CUSTOM_COLOR_SECTION_STYLE}>
              <div style={SECTION_LABEL_STYLE}>{t('colorPicker.customColor')}</div>
              <div style={CUSTOM_COLOR_INPUT_STYLE}>
                <span style={{ fontSize: '12px', color: '#666' }}>#</span>
                <input
                  type="text"
                  style={HEX_INPUT_STYLE}
                  value={customHex}
                  onChange={(e) =>
                    setCustomHex(e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCustomColorApply();
                    }
                  }}
                  placeholder="FF0000"
                  maxLength={6}
                  aria-label="Custom hex color"
                />
                <button
                  type="button"
                  style={APPLY_BUTTON_STYLE}
                  onClick={handleCustomColorApply}
                  disabled={!/^[0-9A-Fa-f]{6}$/.test(customHex)}
                >
                  {t('common.apply')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SPECIALIZED COMPONENTS
// ============================================================================

/**
 * Text color picker (font color)
 */
export function TextColorPicker(props: Omit<ColorPickerProps, 'type'>) {
  return <ColorPicker {...props} type="text" />;
}

/**
 * Highlight color picker (background color)
 */
export function HighlightColorPicker(props: Omit<ColorPickerProps, 'type'>) {
  return <ColorPicker {...props} type="highlight" showMoreColors={false} />;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get default text colors
 */
export function getTextColors(): ColorOption[] {
  return [...TEXT_COLORS];
}

/**
 * Get default highlight colors
 */
export function getHighlightColors(): ColorOption[] {
  return [...HIGHLIGHT_COLORS];
}

/**
 * Create a color option from hex
 */
export function createColorOption(hex: string, name?: string): ColorOption {
  const normalizedHex = hex.replace(/^#/, '').toUpperCase();
  return {
    hex: normalizedHex,
    name: name || `#${normalizedHex}`,
  };
}

/**
 * Check if a color is in the color list
 */
export function isColorInList(hex: string, colors: ColorOption[]): boolean {
  const normalizedHex = hex.replace(/^#/, '').toUpperCase();
  return colors.some((c) => c.hex.toUpperCase() === normalizedHex);
}

/**
 * Get color name from hex
 */
export function getColorName(hex: string, colors: ColorOption[] = TEXT_COLORS): string | null {
  const normalizedHex = hex.replace(/^#/, '').toUpperCase();
  const found = colors.find((c) => c.hex.toUpperCase() === normalizedHex);
  return found?.name || null;
}

/**
 * Parse color value from various formats
 */
export function parseColorValue(color: string | ColorValue | undefined | null): string {
  if (!color) return '';

  if (typeof color === 'string') {
    return color.replace(/^#/, '').toUpperCase();
  }

  if (color.rgb) {
    return color.rgb.toUpperCase();
  }

  if (color.themeColor) {
    // Would need theme to resolve, return placeholder
    return '';
  }

  return '';
}

/**
 * Check if a hex color is valid
 */
export function isValidHexColor(hex: string): boolean {
  const normalized = hex.replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(normalized);
}

/**
 * Get contrasting text color for a background
 */
export function getContrastColor(bgHex: string): string {
  const hex = bgHex.replace(/^#/, '');
  if (hex.length !== 6) return '#000000';

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

/**
 * Get theme colors for picker
 */
export function getThemeColorsForPicker(theme: Theme | null | undefined): ColorOption[] {
  if (!theme?.colorScheme) {
    return [];
  }

  const slots: Array<{ slot: string; name: string }> = [
    { slot: 'dk1', name: 'Dark 1' },
    { slot: 'lt1', name: 'Light 1' },
    { slot: 'dk2', name: 'Dark 2' },
    { slot: 'lt2', name: 'Light 2' },
    { slot: 'accent1', name: 'Accent 1' },
    { slot: 'accent2', name: 'Accent 2' },
    { slot: 'accent3', name: 'Accent 3' },
    { slot: 'accent4', name: 'Accent 4' },
    { slot: 'accent5', name: 'Accent 5' },
    { slot: 'accent6', name: 'Accent 6' },
  ];

  return slots
    .filter((s) => theme.colorScheme![s.slot as keyof typeof theme.colorScheme])
    .map((s) => ({
      name: s.name,
      hex: theme.colorScheme![s.slot as keyof typeof theme.colorScheme] || '',
      isTheme: true,
      themeSlot: s.slot,
    }));
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ColorPicker;
