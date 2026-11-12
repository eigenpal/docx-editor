// The Format shape pane, headless: the text of each field, the check of what the user types, and
// the one command that each committed field or picked color sends (`setShapeFill` or
// `setShapeOutline`). The React and Vue panes render from these, so both check the same input
// with the same keys. The color grid is the Chart pane's (`chartColorGrid`); a theme color
// resolves to its `RRGGBB` here, because the shape commands write `RRGGBB` only. DOM-free.

import type {
  ShapeFillState,
  ShapeFormatState,
  ShapeOutlineState,
} from '../store/package/shape-format.ts';
import { shapeColorHex } from '../store/package/shape-format.ts';
import {
  CHART_THEME_SLOTS,
  chartColorGrid,
  chartColorLabel,
  chartPickHex,
  type ChartColorPick,
  type ChartTranslate,
} from './chart-pane.ts';
import type { SelectedShapeCommand } from './selected-shape.ts';

/** The outline widths the pane offers, in points. @public */
export const SHAPE_OUTLINE_WIDTHS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];

/** The widest outline the shape commands write, in points. */
const MAX_OUTLINE_PT = 1584;

/**
 * One change of the Format shape pane. `color` is a color grid pick (`accent1`,
 * `accent1:40`, `#4472C4`) or typed text: `#RRGGBB`, `RRGGBB`, or a CSS color name. `text` is
 * what the user typed in a number field. @public
 */
export type ShapePaneChange =
  | { readonly type: 'fillColor'; readonly color: string }
  | { readonly type: 'noFill' }
  | { readonly type: 'fillTransparency'; readonly text: string }
  | { readonly type: 'outlineColor'; readonly color: string }
  | { readonly type: 'noOutline' }
  | { readonly type: 'outlineWidth'; readonly text: string };

/** The i18n key of why the pane refuses typed text. @public */
export type ShapePaneError =
  | 'shape.pane.errors.color'
  | 'shape.pane.errors.transparency'
  | 'shape.pane.errors.width'
  | 'shape.pane.errors.noSolidFill';

/** The command of a change, or the i18n key of why the typed text is refused. @public */
export type ShapePaneResult =
  | { readonly ok: true; readonly command: SelectedShapeCommand }
  | { readonly ok: false; readonly error: ShapePaneError };

const fail = (error: ShapePaneError): ShapePaneResult => ({ ok: false, error });

/** The number in a field: `,` reads as a decimal point and a trailing unit is dropped. */
function parseNumber(text: string, unit: RegExp): number | null {
  const t = text.trim().replace(unit, '').trim().replace(',', '.');
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

/**
 * `RRGGBB` of a color grid pick or of typed color text, or null when it names no color.
 * `themeHexes` comes from `chartThemeHexes(editor.getDocumentThemeColors())`. @public
 */
export function shapePaneColorHex(color: string, themeHexes: readonly string[]): string | null {
  const text = color.trim();
  const theme = text.split(':')[0] as (typeof CHART_THEME_SLOTS)[number];
  if (CHART_THEME_SLOTS.includes(theme) && /^[a-z0-9]+(:-?\d+)?$/.test(text))
    return chartPickHex(text as ChartColorPick, themeHexes).slice(1);
  return shapeColorHex(text);
}

/**
 * The command of one pane change for a shape whose fill and outline are `format`, or why the
 * typed text is refused. @public
 */
export function shapePaneCommand(
  format: ShapeFormatState,
  change: ShapePaneChange,
  themeHexes: readonly string[]
): ShapePaneResult {
  switch (change.type) {
    case 'fillColor':
    case 'outlineColor': {
      const color = shapePaneColorHex(change.color, themeHexes);
      if (!color) return fail('shape.pane.errors.color');
      return {
        ok: true,
        command:
          change.type === 'fillColor'
            ? { type: 'setShapeFill', color }
            : { type: 'setShapeOutline', visible: true, color },
      };
    }
    case 'noFill':
      return { ok: true, command: { type: 'setShapeFill', visible: false } };
    case 'noOutline':
      return { ok: true, command: { type: 'setShapeOutline', visible: false } };
    case 'fillTransparency': {
      if (format.fill.type !== 'solid') return fail('shape.pane.errors.noSolidFill');
      const percent = parseNumber(change.text, /%$/);
      if (percent === null || percent < 0 || percent > 100)
        return fail('shape.pane.errors.transparency');
      return { ok: true, command: { type: 'setShapeFill', transparency: percent / 100 } };
    }
    case 'outlineWidth': {
      const widthPt = parseNumber(change.text, /pt$/i);
      if (widthPt === null || widthPt < 0.25 || widthPt > MAX_OUTLINE_PT)
        return fail('shape.pane.errors.width');
      // A width shows the outline, as picking a weight for a shape with no line does.
      return { ok: true, command: { type: 'setShapeOutline', visible: true, widthPt } };
    }
  }
}

/** The i18n key that names a fill: `Gradient`, `No fill`, and so on. @public */
export function shapeFillLabelKey(
  fill: ShapeFillState
): `shape.pane.fillTypes.${ShapeFillState['type']}` {
  return `shape.pane.fillTypes.${fill.type}`;
}

/** Whether the pane can show a fill's color and transparency: a solid fill or no fill. @public */
export const shapeFillEditable = (fill: ShapeFillState): boolean =>
  fill.type === 'solid' || fill.type === 'none';

/** `#RRGGBB` as the hex field shows it, or empty for no color. @public */
export const shapeHexText = (color: string | null): string =>
  color && /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color.toUpperCase()}` : '';

/** The transparency field's text: a whole percent, or empty when the fill is not solid. @public */
export const shapeTransparencyText = (fill: ShapeFillState): string =>
  fill.type === 'solid' ? String(Math.round(fill.transparency * 100)) : '';

/** The width field's text in points, or empty when the shapes of a group disagree. @public */
export const shapeWidthText = (widthPt: number | null): string =>
  widthPt === null ? '' : String(Math.round(widthPt * 100) / 100);

/**
 * Whether a swatch of `swatchHex` (`#RRGGBB`) shows the shape's color `color` (`RRGGBB`):
 * the grid marks it as the current color. @public
 */
export const shapeSwatchCurrent = (swatchHex: string, color: string | null): boolean =>
  color !== null && swatchHex.replace(/^#/, '').toUpperCase() === color.toUpperCase();

/**
 * The grid pick that shows `color` (`RRGGBB`): the first theme color, tint, shade, or standard
 * color that paints it, else `#RRGGBB`. Null for no color. @public
 */
export function shapeColorPick(
  color: string | null,
  themeHexes: readonly string[]
): ChartColorPick | null {
  if (!color || !/^[0-9A-Fa-f]{6}$/.test(color)) return null;
  const grid = chartColorGrid(themeHexes);
  const found = [...grid.theme.flat(), ...grid.standard].find((swatch) =>
    shapeSwatchCurrent(swatch.hex, color)
  );
  return found?.pick ?? `#${color.toUpperCase()}`;
}

/** What the fill's color button says: a color name, No fill, Gradient, and so on. @public */
export function shapeFillSummary(
  fill: ShapeFillState,
  themeHexes: readonly string[],
  t: ChartTranslate
): string {
  const pick = fill.type === 'solid' ? shapeColorPick(fill.color, themeHexes) : null;
  return pick ? chartColorLabel(pick, t) : t(shapeFillLabelKey(fill));
}

/** What the outline's color button says: a color name, No line, or Mixed. @public */
export function shapeOutlineSummary(
  outline: ShapeOutlineState,
  themeHexes: readonly string[],
  t: ChartTranslate
): string {
  if (outline.visible === false) return t('shape.pane.noOutline');
  const pick = outline.visible ? shapeColorPick(outline.color, themeHexes) : null;
  return pick ? chartColorLabel(pick, t) : t('shape.pane.fillTypes.mixed');
}
