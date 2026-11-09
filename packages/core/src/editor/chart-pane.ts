// The Chart pane, headless: the text of each field, the check of what the user types, and the
// one command that each committed field, or each add or remove, sends: the chart's data
// (`setChartData`), its type (`setChartType`), its elements (`setChartFormat`), and its colors
// (`setChartColor`). The React and Vue panes render from these, so both check the same input
// with the same keys. DOM-free, except `focusChartSwatch`, which takes the grid element.

import type { EditorCommand } from '../contracts/editor.ts';
import type {
  ChartColor,
  ChartColorEntry,
  ChartData,
  ChartFormat,
  ChartLegendPosition,
  ChartThemeColor,
  ChartType,
} from '../contracts/chart.ts';
import { CHART_TYPES } from '../store/package/chart-edit/type.ts';
import {
  MAX_CHART_LABEL,
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
} from '../store/package/chart-edit/data-model.ts';

export { MAX_CHART_POINTS, MAX_CHART_SERIES };

/**
 * The key of the chart and its grid labels, which keeps the pane's unsaved field text while it
 * stays the same. @public
 */
export function chartPaneDraftKey(drawingNodeId: string, data: ChartData): string {
  return JSON.stringify([
    drawingNodeId,
    data.kind,
    data.categories.map((category) => category.label),
    data.series.map((series) => series.name),
  ]);
}

/**
 * Whether the pane keeps its unsaved field text from `previous` to `next`: the chart and its
 * labels stay in place, and categories or series are only added at the end. @public
 */
export function chartPaneDraftContinues(previous: string, next: string): boolean {
  if (previous === next) return true;
  type Scope = [string, string, string[], string[]];
  const before = JSON.parse(previous) as Scope;
  const after = JSON.parse(next) as Scope;
  return (
    before[0] === after[0] &&
    before[1] === after[1] &&
    before[2].length <= after[2].length &&
    before[3].length <= after[3].length &&
    before[2].every((label, index) => label === after[2][index]) &&
    before[3].every((name, index) => name === after[3][index])
  );
}

/** One change of the Chart pane's data: a committed field, or an add or a remove. @public */
export type ChartPaneChange =
  | {
      readonly type: 'value';
      readonly series: number;
      readonly category: number;
      readonly text: string;
    }
  | { readonly type: 'seriesName'; readonly series: number; readonly text: string }
  | { readonly type: 'label'; readonly category: number; readonly text: string }
  | { readonly type: 'addSeries'; readonly name: string }
  | { readonly type: 'removeSeries'; readonly series: number }
  | { readonly type: 'addCategory'; readonly label: string }
  | { readonly type: 'removeCategory'; readonly category: number };

/** The command of a change, or the i18n key of why the typed text is refused. @public */
export type ChartPaneResult =
  | { readonly ok: true; readonly command: EditorCommand }
  | {
      readonly ok: false;
      readonly error:
        | 'chart.data.fieldErrors.number'
        | 'chart.data.fieldErrors.xNumber'
        | 'chart.data.fieldErrors.tooLong'
        | 'chart.data.fieldErrors.limit';
    };

/** A value as its field shows it: empty for no value. @public */
export const chartValueText = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

/** The number a value field holds, null when it is empty, or undefined for other text. @public */
export function parseChartValue(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Whether the categories of `data` are numbers that the pane checks: the X values of a
 * scatter chart, unless the chart names them as text. @public
 */
export function chartPaneNumericX(data: Pick<ChartData, 'kind' | 'categories'>): boolean {
  return (
    data.kind === 'xy' && data.categories.every((c) => typeof parseChartValue(c.label) === 'number')
  );
}

/**
 * The label of a new category: the next X value of a scatter chart with number X values, else
 * `fallback`. @public
 */
export function nextChartCategoryLabel(
  data: Pick<ChartData, 'kind' | 'categories'>,
  fallback: string
): string {
  if (!chartPaneNumericX(data)) return fallback;
  let max = 0;
  for (const c of data.categories) max = Math.max(max, Number(parseChartValue(c.label)));
  return String(Math.floor(max) + 1);
}

const fail = (error: Extract<ChartPaneResult, { ok: false }>['error']): ChartPaneResult => ({
  ok: false,
  error,
});

/**
 * The `setChartData` command of one change to the chart's current data, or why the typed text
 * is refused. Every series and category keeps its `source`, so formatting stays with it.
 * @public
 */
export function chartPaneCommand(
  drawingNodeId: string,
  data: ChartData,
  change: ChartPaneChange
): ChartPaneResult {
  const numericX = chartPaneNumericX(data);
  let categories: { label: string; source?: number }[] = data.categories.map((c) => ({ ...c }));
  let series: { name: string; values: (number | null)[]; source?: number }[] = data.series.map(
    (s) => ({ ...s, values: [...s.values] })
  );
  switch (change.type) {
    case 'value': {
      const v = parseChartValue(change.text);
      const target = series[change.series];
      if (v === undefined || !target || change.category >= categories.length)
        return fail('chart.data.fieldErrors.number');
      target.values[change.category] = v;
      break;
    }
    case 'seriesName': {
      const target = series[change.series];
      if (!target || change.text.length > MAX_CHART_LABEL)
        return fail('chart.data.fieldErrors.tooLong');
      target.name = change.text;
      break;
    }
    case 'label': {
      const target = categories[change.category];
      if (!target || change.text.length > MAX_CHART_LABEL)
        return fail('chart.data.fieldErrors.tooLong');
      const x = parseChartValue(change.text);
      if (numericX && typeof x !== 'number') return fail('chart.data.fieldErrors.xNumber');
      target.label = numericX ? String(x) : change.text;
      break;
    }
    case 'addSeries':
      if (series.length >= MAX_CHART_SERIES) return fail('chart.data.fieldErrors.limit');
      series = [...series, { name: change.name, values: categories.map(() => null) }];
      break;
    case 'removeSeries':
      if (series.length <= 1 || !series[change.series]) return fail('chart.data.fieldErrors.limit');
      series = series.filter((_, i) => i !== change.series);
      break;
    case 'addCategory':
      if (categories.length >= MAX_CHART_POINTS) return fail('chart.data.fieldErrors.limit');
      categories = [...categories, { label: change.label }];
      series = series.map((s) => ({ ...s, values: [...s.values, null] }));
      break;
    case 'removeCategory':
      if (categories.length <= 1 || !categories[change.category])
        return fail('chart.data.fieldErrors.limit');
      categories = categories.filter((_, i) => i !== change.category);
      series = series.map((s) => ({
        ...s,
        values: s.values.filter((_, i) => i !== change.category),
      }));
      break;
  }
  return {
    ok: true,
    command: { type: 'setChartData', drawingNodeId, data: { kind: data.kind, categories, series } },
  };
}

/**
 * The index of the row that gets the focus after a row is removed at `removed` from a list of
 * `count` rows: the next row, or the last one. @public
 */
export const chartRowFocusAfterRemove = (removed: number, count: number): number =>
  Math.max(0, Math.min(removed, count - 2));

// --- The chart's type and elements ------------------------------------------------------------

/** The chart types the pane offers, in the order of its type list. @public */
export const CHART_TYPE_CHOICES: readonly ChartType[] = CHART_TYPES;

/** The legend positions the pane offers. @public */
export const CHART_LEGEND_CHOICES: readonly ChartLegendPosition[] = [
  'none',
  'top',
  'bottom',
  'left',
  'right',
];

/** Whether a chart plots X values by Y values: its axis titles are X and Y. */
const plotsXy = (format: ChartFormat): boolean =>
  format.type === 'scatter' || format.type === 'scatterLines';

/**
 * The note after a type change, when the new type drops what the user set: the colors move
 * between series and points, or the axes and their titles go. Undo restores them. Null when
 * the new type keeps everything. @public
 */
export function chartTypeChangeNote(
  before: ChartFormat,
  after: ChartFormat
): 'chart.format.typeChangeRemoved' | null {
  const colors = before.colorsBy !== after.colorsBy && before.colors.some((c) => c.color !== null);
  const titles =
    after.axisTitles === null && !!(before.axisTitles?.category || before.axisTitles?.value);
  return colors || titles ? 'chart.format.typeChangeRemoved' : null;
}

/**
 * The hint before a type change: the chart has colors or axis titles that some types cannot
 * keep. Null when it has none. @public
 */
export function chartTypeHint(format: ChartFormat): 'chart.format.typeChangeHint' | null {
  const colors = format.colors.some((c) => c.color !== null);
  const titles = !!(format.axisTitles?.category || format.axisTitles?.value);
  return colors || titles ? 'chart.format.typeChangeHint' : null;
}

/** The note of a pie chart with more than one series: it draws the first one only. @public */
export function chartSeriesNote(
  format: ChartFormat,
  seriesCount: number
): 'chart.format.pieFirstSeries' | null {
  return format.type === 'pie' && seriesCount > 1 ? 'chart.format.pieFirstSeries' : null;
}

/** The labels of the two axis title fields: category and value, or X and Y. @public */
export function chartAxisTitleLabels(format: ChartFormat): {
  readonly category: 'chart.format.categoryAxisTitle' | 'chart.format.xAxisTitle';
  readonly value: 'chart.format.valueAxisTitle' | 'chart.format.yAxisTitle';
} {
  return plotsXy(format)
    ? { category: 'chart.format.xAxisTitle', value: 'chart.format.yAxisTitle' }
    : { category: 'chart.format.categoryAxisTitle', value: 'chart.format.valueAxisTitle' };
}

/**
 * The `setChartFormat` command of a typed title: an empty or blank title turns the title (or
 * the axis title) off. Null when the text is what the chart shows already. @public
 */
export function chartTitleCommand(
  drawingNodeId: string,
  format: ChartFormat,
  field: 'title' | 'categoryAxisTitle' | 'valueAxisTitle',
  text: string
): EditorCommand | null {
  const next = text.trim() === '' ? null : text;
  const now =
    field === 'title'
      ? format.title
      : field === 'categoryAxisTitle'
        ? (format.axisTitles?.category ?? null)
        : (format.axisTitles?.value ?? null);
  if (next === now) return null;
  return { type: 'setChartFormat', drawingNodeId, format: { [field]: next } };
}

// --- Colors -----------------------------------------------------------------------------------

/** The theme colors of a color list, in the order of the theme color row. @public */
export const CHART_THEME_SLOTS: readonly ChartThemeColor[] = [
  'bg1',
  'tx1',
  'bg2',
  'tx2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
];

/** The i18n key of each theme color's name. */
const THEME_NAME_KEYS: Readonly<Record<ChartThemeColor, string>> = {
  bg1: 'colorPicker.theme.background1',
  tx1: 'colorPicker.theme.text1',
  bg2: 'colorPicker.theme.background2',
  tx2: 'colorPicker.theme.text2',
  accent1: 'colorPicker.theme.accent1',
  accent2: 'colorPicker.theme.accent2',
  accent3: 'colorPicker.theme.accent3',
  accent4: 'colorPicker.theme.accent4',
  accent5: 'colorPicker.theme.accent5',
  accent6: 'colorPicker.theme.accent6',
};

/** The standard colors of the grid, with the i18n key of each name. @public */
export const CHART_STANDARD_COLORS: readonly { readonly hex: string; readonly nameKey: string }[] =
  [
    { hex: '#C00000', nameKey: 'colorPicker.colors.darkRed' },
    { hex: '#FF0000', nameKey: 'colorPicker.colors.red' },
    { hex: '#FFC000', nameKey: 'colorPicker.colors.orange' },
    { hex: '#FFFF00', nameKey: 'colorPicker.colors.yellow' },
    { hex: '#92D050', nameKey: 'colorPicker.colors.lightGreen' },
    { hex: '#00B050', nameKey: 'colorPicker.colors.green' },
    { hex: '#00B0F0', nameKey: 'colorPicker.colors.lightBlue' },
    { hex: '#0070C0', nameKey: 'colorPicker.colors.blue' },
    { hex: '#002060', nameKey: 'colorPicker.colors.darkBlue' },
    { hex: '#7030A0', nameKey: 'colorPicker.colors.purple' },
  ];

/** Six hex digits, the only color text that reaches a swatch style. */
const HEX6 = /^[0-9A-F]{6}$/;

/** The default theme colors, for a document with no theme, in `CHART_THEME_SLOTS` order. */
const DEFAULT_THEME_HEXES: readonly string[] = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
];

/**
 * The theme colors of a document, `RRGGBB` in `CHART_THEME_SLOTS` order, from
 * `editor.getDocumentThemeColors()`; the default theme when the document has none. @public
 */
export function chartThemeHexes(
  entries: readonly { readonly hex: string }[] | undefined
): readonly string[] {
  const hexes = (entries ?? []).map((entry) => entry.hex.replace(/^#/, '').toUpperCase());
  return hexes.length === DEFAULT_THEME_HEXES.length && hexes.every((hex) => HEX6.test(hex))
    ? hexes
    : DEFAULT_THEME_HEXES;
}

/**
 * A color list's value: the automatic color (`auto`), a theme color, a theme tint or shade
 * (`accent1:40` is Lighter 40%, `accent1:-25` Darker 25%), or `#RRGGBB`. @public
 */
export type ChartColorPick =
  'auto' | ChartThemeColor | `${ChartThemeColor}:${number}` | `#${string}`;

/** The pick of a chart color. @public */
export function chartColorPickOf(color: ChartColor): ChartColorPick {
  if (typeof color === 'string') return `#${color.replace(/^#/, '').toUpperCase()}`;
  return color.shift ? `${color.theme}:${color.shift}` : color.theme;
}

/** The chart color of a pick, or null for `auto`. @public */
export function chartColorOfPick(pick: ChartColorPick): ChartColor | null {
  if (pick === 'auto') return null;
  if (pick.startsWith('#')) return pick;
  const [theme, shift] = pick.split(':') as [ChartThemeColor, string?];
  return shift ? { theme, shift: Number(shift) } : { theme };
}

/** The pick of one series' or point's color: `auto` for its automatic color. @public */
export const chartColorPick = (entry: ChartColorEntry): ChartColorPick =>
  entry.color === null ? 'auto' : chartColorPickOf(entry.color);

/**
 * The picks a color list offers: Automatic, the ten theme colors, and the current pick when
 * the grid chose it (a tint, a shade, or a standard color). @public
 */
export function chartColorPicks(value: ChartColorPick): readonly ChartColorPick[] {
  const listed = value === 'auto' || (CHART_THEME_SLOTS as readonly string[]).includes(value);
  return ['auto', ...CHART_THEME_SLOTS, ...(listed ? [] : [value])];
}

/** The `setChartColor` command of a pick for series or point `index`. @public */
export function chartColorCommand(
  drawingNodeId: string,
  index: number,
  pick: ChartColorPick
): EditorCommand {
  return { type: 'setChartColor', drawingNodeId, index, color: chartColorOfPick(pick) };
}

/** A translator, as the adapters pass theirs. */
/** A translator, as the adapters pass theirs to the chart helpers. @public */
export type ChartTranslate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The name of a pick: Automatic, a theme color with its tint or shade, a standard color by
 * name ("Purple"), or the hex code of any other color. @public
 */
export function chartColorLabel(pick: ChartColorPick, t: ChartTranslate): string {
  if (pick === 'auto') return t('colorPicker.automatic');
  if (pick.startsWith('#')) {
    const standard = CHART_STANDARD_COLORS.find((c) => c.hex === pick.toUpperCase());
    return standard ? t(standard.nameKey) : pick.toUpperCase();
  }
  const [theme, shift] = pick.split(':') as [ChartThemeColor, string?];
  const name = t(THEME_NAME_KEYS[theme]);
  const n = Number(shift ?? 0);
  if (n > 0) return t('chart.format.colorLighter', { color: name, percent: n });
  if (n < 0) return t('chart.format.colorDarker', { color: name, percent: -n });
  return name;
}

/**
 * `RRGGBB` of `hex` with the luminance transform that `colorXml` writes: `lumMod` of
 * `100 - |shift|` percent, and `lumOff` of `shift` percent for a tint (ECMA-376 Part 1,
 * 20.1.2.3.20 and 20.1.2.3.21), on the HSL lightness.
 */
function shifted(hex: string, shift: number): string {
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  const lum = Math.max(0, Math.min(1, l * (1 - Math.abs(shift) / 100) + Math.max(0, shift) / 100));
  const c = (1 - Math.abs(2 * lum - 1)) * s;
  const x = c * (1 - Math.abs(((((h % 6) + 6) % 6) % 2) - 1));
  const m = lum - c / 2;
  const sector = Math.floor(((h % 6) + 6) % 6);
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector]!;
  return rgb
    .map((v) =>
      Math.max(0, Math.min(255, Math.round((v + m) * 255)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

/**
 * The `#RRGGBB` that a pick paints, from the document's theme colors (`chartThemeHexes`).
 * `auto` paints `automatic`, the series' automatic color. @public
 */
export function chartPickHex(
  pick: ChartColorPick,
  themeHexes: readonly string[],
  automatic?: ChartColor
): string {
  if (pick === 'auto')
    return automatic ? chartPickHex(chartColorPickOf(automatic), themeHexes) : '#000000';
  if (pick.startsWith('#')) {
    const hex = pick.slice(1).toUpperCase();
    return HEX6.test(hex) ? `#${hex}` : '#000000';
  }
  const [theme, shift] = pick.split(':') as [ChartThemeColor, string?];
  const base = themeHexes[CHART_THEME_SLOTS.indexOf(theme)] ?? '000000';
  const n = Math.max(-100, Math.min(100, Number(shift ?? 0)));
  return `#${shifted(base, Number.isFinite(n) ? n : 0)}`;
}

/** The tint and shade steps under one theme color, by the color's lightness. */
function steps(hex: string): readonly number[] {
  const channels = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const lightness = (Math.max(...channels) + Math.min(...channels)) / 2 / 255;
  if (lightness === 1) return [-5, -15, -25, -35, -50];
  if (lightness === 0) return [50, 35, 25, 15, 5];
  if (lightness >= 0.8) return [-10, -25, -50, -75, -90];
  return [80, 60, 40, -25, -50];
}

/** One swatch of the color grid. @public */
export interface ChartSwatch {
  readonly pick: ChartColorPick;
  /** The color the swatch paints, `#RRGGBB`. */
  readonly hex: string;
}

/**
 * The color grid: one row of theme colors, five rows of their tints and shades (one column per
 * theme color), and the row of standard colors. @public
 */
export function chartColorGrid(themeHexes: readonly string[]): {
  readonly theme: readonly (readonly ChartSwatch[])[];
  readonly standard: readonly ChartSwatch[];
} {
  const base = CHART_THEME_SLOTS.map((slot) => ({
    pick: slot as ChartColorPick,
    hex: chartPickHex(slot, themeHexes),
  }));
  const ladders = CHART_THEME_SLOTS.map((_, i) => steps(themeHexes[i] ?? '000000'));
  const variants = [0, 1, 2, 3, 4].map((row) =>
    CHART_THEME_SLOTS.map((slot, column) => {
      const pick = `${slot}:${ladders[column]![row]!}` as ChartColorPick;
      return { pick, hex: chartPickHex(pick, themeHexes) };
    })
  );
  const standard = CHART_STANDARD_COLORS.map((c) => ({
    pick: c.hex as ChartColorPick,
    hex: c.hex,
  }));
  return { theme: [base, ...variants], standard };
}

/**
 * Focus the current swatch of an opened color grid, or its first swatch, and scroll the whole
 * grid into view. The current swatch carries `aria-pressed="true"`. @public
 */
export function focusChartSwatch(grid: HTMLElement | null): void {
  if (!grid) return;
  const current =
    grid.querySelector<HTMLElement>('[aria-pressed="true"]') ??
    grid.querySelector<HTMLElement>('button');
  if (current?.classList.contains('docx-chart-pane__swatch')) rovingSwatch(grid, current);
  else rovingSwatch(grid, swatchesOf(grid)[0] ?? null);
  current?.focus({ preventScroll: true });
  grid.scrollIntoView?.({ block: 'nearest' });
}

/** The columns of every swatch row of the color grid. */
const SWATCH_COLUMNS = 10;

const swatchesOf = (grid: HTMLElement): HTMLElement[] => [
  ...grid.querySelectorAll<HTMLElement>('.docx-chart-pane__swatch'),
];

/** Keep one swatch in the Tab order, so Tab leaves the grid in one step. */
function rovingSwatch(grid: HTMLElement, active: HTMLElement | null): void {
  for (const swatch of swatchesOf(grid)) swatch.tabIndex = swatch === active ? 0 : -1;
}

/**
 * Move the focus in an opened color grid for an arrow key, Home or End. The swatches are rows of
 * ten; Up from the first row goes to Automatic. Returns whether the key moved the focus, so the
 * caller can prevent the default action. @public
 */
export function moveChartSwatchFocus(grid: HTMLElement | null, key: string): boolean {
  if (!grid) return false;
  const swatches = swatchesOf(grid);
  const auto = grid.querySelector<HTMLElement>('.docx-chart-pane__grid-auto');
  const active = grid.ownerDocument.activeElement;
  const at = swatches.findIndex((swatch) => swatch === active);
  const rtl = grid.ownerDocument.defaultView?.getComputedStyle(grid).direction === 'rtl';
  const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[key];
  let next: HTMLElement | null | undefined;
  if (at < 0) {
    if (active !== auto || (key !== 'ArrowDown' && key !== 'Home')) return false;
    next = swatches[0];
  } else if (step !== undefined) next = swatches[at + step];
  else if (key === 'ArrowDown') next = swatches[at + SWATCH_COLUMNS];
  else if (key === 'ArrowUp') next = at < SWATCH_COLUMNS ? auto : swatches[at - SWATCH_COLUMNS];
  else if (key === 'Home') next = swatches[0];
  else if (key === 'End') next = swatches[swatches.length - 1];
  else return false;
  if (!next) return true;
  if (next !== auto) rovingSwatch(grid, next);
  next.focus({ preventScroll: true });
  return true;
}

/** The frames that {@link focusChartPane} waits for a hidden pane to show. */
const PANE_FOCUS_FRAMES = 3;

/**
 * Move the focus to the first enabled field of the Chart pane, unless the pane has it already.
 * The pane calls it for a pane request that asks for the focus (Edit chart). A pane in a hidden
 * tab cannot take the focus, so it tries again for a few frames while the host shows the tab.
 * @public
 */
export function focusChartPane(pane: HTMLElement | null): void {
  if (!pane) return;
  const doc = pane.ownerDocument;
  const attempt = (framesLeft: number): void => {
    if (!pane.isConnected || pane.contains(doc.activeElement)) return;
    const field = pane.querySelector<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled)'
    );
    if (!field) return;
    field.focus();
    if (doc.activeElement === field || framesLeft === 0) return;
    doc.defaultView?.requestAnimationFrame(() => attempt(framesLeft - 1));
  };
  attempt(PANE_FOCUS_FRAMES);
}
