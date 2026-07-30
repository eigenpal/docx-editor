/**
 * Paragraph-style preview + option resolution — shared between the React and
 * Vue toolbars so the style-picker dropdown looks and behaves identically.
 *
 * Pure logic only: no i18n and no framework CSS types. The returned preview is
 * a plain `{ fontSize, lineHeight, fontWeight?, fontStyle?, color? }` object,
 * which is structurally assignable to both React's `CSSProperties` and Vue's
 * inline-style record, so neither adapter needs a cast. Name localization stays
 * in the adapters (they own the i18n `t()` boundary).
 * @packageDocumentation
 * @public
 */
import type { Style } from '../core-compat';

/**
 * Inline preview style for a paragraph-style dropdown item.
 * @public
 */
export interface StylePreviewProps {
  fontSize: string;
  lineHeight: string;
  fontWeight?: 'bold';
  fontStyle?: 'italic';
  color?: string;
}

/**
 * A resolved paragraph-style option (document order, with extracted visual
 * fields). Adapters add their own localized label on top of `name`.
 * @public
 */
export interface ResolvedStyleOption {
  styleId: string;
  name: string;
  priority: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

/** Dropdown preview sizes (px) for well-known styles, matching Google Docs. @public */
export const STYLE_PREVIEW_SIZES: Record<string, number> = {
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

/** Styles rendered bold in the dropdown preview by default. @public */
export const STYLE_DEFAULT_BOLD: ReadonlySet<string> = new Set([
  'Title',
  'Heading1',
  'Heading2',
  'Heading3',
]);

/** Default preview text color (hex, no `#`) for styles that don't set one. @public */
export const STYLE_DEFAULT_COLOR: Record<string, string> = { Subtitle: '666666' };

/** Google-Docs heading preview color. @public */
export const HEADING_COLOR = '#4a6c8c';

/**
 * Build the inline preview style for a style option. `fontSize` is in
 * half-points (OOXML); known styles use {@link STYLE_PREVIEW_SIZES} instead.
 * @public
 */
export function getStylePreviewProps(input: {
  styleId: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}): StylePreviewProps {
  const known = STYLE_PREVIEW_SIZES[input.styleId];
  const fontSize = known
    ? `${known}px`
    : `${Math.min(Math.max(input.fontSize ? input.fontSize / 2 : 11, 11), 20)}px`;
  const props: StylePreviewProps = { fontSize, lineHeight: '1.3' };
  if (input.bold ?? STYLE_DEFAULT_BOLD.has(input.styleId)) props.fontWeight = 'bold';
  if (input.italic) props.fontStyle = 'italic';
  const color = input.color ?? STYLE_DEFAULT_COLOR[input.styleId];
  if (color) props.color = `#${color}`;
  else if (input.styleId.startsWith('Heading')) props.color = HEADING_COLOR;
  return props;
}

/**
 * Filter the document's styles to the visible paragraph styles, extract their
 * visual fields, and sort by UI priority — the list a toolbar style picker
 * shows. Returns `[]` when there are no styles (adapters fall back to presets).
 * @public
 */
export function resolveParagraphStyleOptions(styles: Style[] | undefined): ResolvedStyleOption[] {
  if (!styles || styles.length === 0) return [];
  return styles
    .filter((s) => s.type === 'paragraph')
    .filter((s) => (s.qFormat ? true : !(s.hidden || s.semiHidden)))
    .map((s) => ({
      styleId: s.styleId,
      name: s.name || s.styleId,
      priority: s.uiPriority ?? 99,
      fontSize: s.rPr?.fontSize,
      bold: s.rPr?.bold,
      italic: s.rPr?.italic,
      color: s.rPr?.color?.rgb,
    }))
    .sort((a, b) => a.priority - b.priority);
}
