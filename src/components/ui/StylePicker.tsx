/**
 * Style Picker Component (Radix UI)
 *
 * A dropdown selector for applying named paragraph styles using Radix Select.
 * Shows each style with its visual appearance (font size, bold, color).
 */

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger } from './Select';
import { cn } from '../../lib/utils';
import type { Style, StyleType, Theme } from '../../types/document';

// ============================================================================
// TYPES
// ============================================================================

export interface StyleOption {
  styleId: string;
  name: string;
  type: StyleType;
  isDefault?: boolean;
  qFormat?: boolean;
  priority?: number;
  /** Font size in half-points for visual preview */
  fontSize?: number;
  /** Bold styling */
  bold?: boolean;
  /** Italic styling */
  italic?: boolean;
  /** Text color (RGB hex) */
  color?: string;
}

export interface StylePickerProps {
  value?: string;
  onChange?: (styleId: string) => void;
  styles?: Style[];
  theme?: Theme | null;
  disabled?: boolean;
  className?: string;
  width?: number | string;
}

// ============================================================================
// DEFAULT STYLES (matching Google Docs order and appearance)
// ============================================================================

const DEFAULT_STYLES: StyleOption[] = [
  {
    styleId: 'Normal',
    name: 'Normal text',
    type: 'paragraph',
    isDefault: true,
    priority: 0,
    qFormat: true,
    fontSize: 22, // 11pt
  },
  {
    styleId: 'Title',
    name: 'Title',
    type: 'paragraph',
    priority: 1,
    qFormat: true,
    fontSize: 52, // 26pt
    bold: true,
  },
  {
    styleId: 'Subtitle',
    name: 'Subtitle',
    type: 'paragraph',
    priority: 2,
    qFormat: true,
    fontSize: 30, // 15pt
    color: '666666', // Gray
  },
  {
    styleId: 'Heading1',
    name: 'Heading 1',
    type: 'paragraph',
    priority: 3,
    qFormat: true,
    fontSize: 40, // 20pt
    bold: true,
  },
  {
    styleId: 'Heading2',
    name: 'Heading 2',
    type: 'paragraph',
    priority: 4,
    qFormat: true,
    fontSize: 32, // 16pt
    bold: true,
  },
  {
    styleId: 'Heading3',
    name: 'Heading 3',
    type: 'paragraph',
    priority: 5,
    qFormat: true,
    fontSize: 28, // 14pt
    bold: true,
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

/** Google Docs heading color */
const HEADING_COLOR = '#4a6c8c';

/** Preview sizes per style (px), matching Google Docs dropdown appearance */
const STYLE_PREVIEW_SIZES: Record<string, number> = {
  Title: 26,
  Subtitle: 18,
  Heading1: 24,
  Heading2: 18,
  Heading3: 16,
  Heading4: 14,
  Heading5: 13,
  Heading6: 13,
  Normal: 14,
};

/**
 * Get inline styles for a style option's visual preview.
 * Uses hardcoded preview sizes for well-known styles (Title, Heading1, etc.)
 * and derives a clamped size from the style's fontSize for custom styles.
 */
function getStylePreviewCSS(style: StyleOption): React.CSSProperties {
  const css: React.CSSProperties = {};

  // Use hardcoded size for well-known styles, otherwise derive from fontSize (half-points → px)
  const knownSize = STYLE_PREVIEW_SIZES[style.styleId];
  if (knownSize) {
    css.fontSize = `${knownSize}px`;
  } else {
    // fontSize is in half-points; convert to pt then clamp for dropdown readability
    const pt = style.fontSize ? style.fontSize / 2 : 11;
    const px = Math.min(Math.max(pt, 11), 20);
    css.fontSize = `${px}px`;
  }
  css.lineHeight = '1.3';

  if (style.bold) {
    css.fontWeight = 'bold';
  }

  if (style.italic) {
    css.fontStyle = 'italic';
  }

  // Use explicit color if provided, otherwise apply heading color for heading styles
  if (style.color) {
    css.color = `#${style.color}`;
  } else if (style.styleId.startsWith('Heading')) {
    css.color = HEADING_COLOR;
  }

  return css;
}

export function StylePicker({
  value,
  onChange,
  styles,
  disabled = false,
  className,
  width = 120,
}: StylePickerProps) {
  // Convert document styles to options with visual info
  const styleOptions = React.useMemo(() => {
    if (!styles || styles.length === 0) {
      return DEFAULT_STYLES;
    }

    // Show all paragraph styles that are visible:
    // - Not hidden and not semiHidden, OR
    // - Marked as qFormat (quick format / gallery style)
    const docStyles = styles
      .filter((s) => s.type === 'paragraph')
      .filter((s) => {
        if (s.qFormat) return true;
        if (s.hidden || s.semiHidden) return false;
        return true;
      })
      .map((s) => {
        const defaultStyle = DEFAULT_STYLES.find((d) => d.styleId === s.styleId);
        return {
          styleId: s.styleId,
          name: s.name || s.styleId,
          type: s.type,
          isDefault: s.default,
          qFormat: s.qFormat,
          priority: s.uiPriority ?? 99,
          // Extract visual properties from rPr, fall back to hardcoded defaults
          fontSize: s.rPr?.fontSize ?? defaultStyle?.fontSize,
          bold: s.rPr?.bold ?? defaultStyle?.bold,
          italic: s.rPr?.italic ?? defaultStyle?.italic,
          color: s.rPr?.color?.rgb ?? defaultStyle?.color,
        };
      });

    // Sort by priority
    return docStyles.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  }, [styles]);

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      onChange?.(newValue);
    },
    [onChange]
  );

  const currentValue = value || 'Normal';
  const displayName = styleOptions.find((s) => s.styleId === currentValue)?.name || currentValue;

  return (
    <Select value={currentValue} onValueChange={handleValueChange} disabled={disabled}>
      <SelectTrigger
        className={cn('h-8 text-sm', className)}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
        aria-label="Select paragraph style"
      >
        <span className="truncate">{displayName}</span>
      </SelectTrigger>
      <SelectContent className="min-w-[260px] max-h-[400px]">
        {styleOptions.map((style) => (
          <SelectItem key={style.styleId} value={style.styleId} className="py-2.5 px-3">
            <span style={getStylePreviewCSS(style)}>{style.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
