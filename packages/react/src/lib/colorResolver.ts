/**
 * Color resolution for the editor chrome.
 *
 * Delegates tint/shade/hex/theme resolution to the shared core lowerer so chrome
 * and table command planning cannot disagree.
 */

import type {
  ColorValue,
  Theme,
  ThemeColorScheme,
} from '@docx-editor.dev/core-contract/contracts/editor';
import {
  applyThemeShade,
  applyThemeTint,
  resolveThemeColorHex,
  validateThemeModifier,
} from '@docx-editor.dev/core-contract/editor';

/** Office default theme color scheme, used when a document supplies none. */
const DEFAULT_THEME_COLORS: Readonly<Record<string, string>> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
};

/** The fixed `w:highlight` name → hex table (ST_HighlightColor). */
const HIGHLIGHT_COLORS: Readonly<Record<string, string>> = {
  black: '000000',
  blue: '0000FF',
  cyan: '00FFFF',
  darkBlue: '00008B',
  darkCyan: '008B8B',
  darkGray: 'A9A9A9',
  darkGreen: '006400',
  darkMagenta: '8B008B',
  darkRed: '8B0000',
  darkYellow: '808000',
  green: '00FF00',
  lightGray: 'D3D3D3',
  magenta: 'FF00FF',
  red: 'FF0000',
  white: 'FFFFFF',
  yellow: 'FFFF00',
  none: '',
};

const THEME_COLOR_ALIASES: Readonly<Record<string, string>> = {
  dk1: 'dk1',
  lt1: 'lt1',
  dk2: 'dk2',
  lt2: 'lt2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  hyperlink: 'hlink',
  followedHyperlink: 'folHlink',
  background1: 'lt1',
  text1: 'dk1',
  background2: 'lt2',
  text2: 'dk2',
  tx1: 'dk1',
  tx2: 'dk2',
  bg1: 'lt1',
  bg2: 'lt2',
};

function resolveThemeSlotHex(theme: Theme | null | undefined, slot: string): string {
  const key = THEME_COLOR_ALIASES[slot] ?? THEME_COLOR_ALIASES[slot.toLowerCase()] ?? slot;
  const scheme: ThemeColorScheme | undefined = theme?.colorScheme;
  const fromScheme = scheme?.[key];
  if (typeof fromScheme === 'string' && fromScheme) return fromScheme;
  return DEFAULT_THEME_COLORS[key] ?? '000000';
}

function normalizeHex(value: string): string | undefined {
  const hex = value.replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(hex)) return hex;
  if (/^[0-9A-F]{3}$/.test(hex))
    return hex
      .split('')
      .map((c) => c + c)
      .join('');
  return undefined;
}

/**
 * Resolve a contract `ColorValue` to a CSS color string (`#RRGGBB`).
 * `auto` and missing values resolve to `defaultColor`.
 */
export function resolveColor(
  color: ColorValue | undefined | null,
  theme: Theme | null | undefined,
  defaultColor: string = '000000'
): string {
  if (!color || color.kind === 'auto') return `#${defaultColor}`;
  if (color.kind === 'hex') return `#${normalizeHex(color.value) ?? defaultColor}`;
  const entries = Object.entries(theme?.colorScheme ?? DEFAULT_THEME_COLORS).map(([slot, hex]) => ({
    slot,
    hex: String(hex),
  }));
  const resolved = resolveThemeColorHex(
    color,
    entries as Parameters<typeof resolveThemeColorHex>[1]
  );
  return `#${resolved.ok ? resolved.hex : resolveThemeSlotHex(theme, color.slot)}`;
}

/**
 * Resolve any `ColorValue` to a 6-char uppercase hex string without `#`, or
 * `undefined` when the value is unset/`auto`/unresolvable.
 */
export function resolveColorToHex(
  color: ColorValue | undefined | null,
  theme: Theme | null | undefined
): string | undefined {
  if (!color || color.kind === 'auto') return undefined;
  if (color.kind === 'hex') return normalizeHex(color.value);
  return resolveColor(color, theme).slice(1);
}

/** Resolve a `w:highlight` name to CSS, or `''` for `none`/unknown. */
export function resolveHighlightColor(highlight: string | undefined): string {
  if (!highlight || highlight === 'none') return '';
  const hex = HIGHLIGHT_COLORS[highlight];
  return hex ? `#${hex}` : '';
}

export interface ThemeMatrixCell {
  hex: string;
  themeSlot: string;
  tint?: number;
  shade?: number;
  label: string;
}

const THEME_MATRIX_COLUMNS: Array<{ slot: string; name: string }> = [
  { slot: 'lt1', name: 'Background 1' },
  { slot: 'dk1', name: 'Text 1' },
  { slot: 'lt2', name: 'Background 2' },
  { slot: 'dk2', name: 'Text 2' },
  { slot: 'accent1', name: 'Accent 1' },
  { slot: 'accent2', name: 'Accent 2' },
  { slot: 'accent3', name: 'Accent 3' },
  { slot: 'accent4', name: 'Accent 4' },
  { slot: 'accent5', name: 'Accent 5' },
  { slot: 'accent6', name: 'Accent 6' },
];

const THEME_MATRIX_ROWS: Array<{
  type: 'base' | 'tint' | 'shade';
  keep: number;
  labelSuffix: string;
}> = [
  { type: 'base', keep: 1, labelSuffix: '' },
  { type: 'tint', keep: 0.2, labelSuffix: ', Lighter 80%' },
  { type: 'tint', keep: 0.4, labelSuffix: ', Lighter 60%' },
  { type: 'tint', keep: 0.6, labelSuffix: ', Lighter 40%' },
  { type: 'shade', keep: 0.75, labelSuffix: ', Darker 25%' },
  { type: 'shade', keep: 0.5, labelSuffix: ', Darker 50%' },
];

export function generateThemeTintShadeMatrix(
  colorScheme?: ThemeColorScheme | null
): ThemeMatrixCell[][] {
  const scheme = colorScheme ?? DEFAULT_THEME_COLORS;

  return THEME_MATRIX_ROWS.map((row) =>
    THEME_MATRIX_COLUMNS.map((col) => {
      const baseHex = scheme[col.slot] ?? DEFAULT_THEME_COLORS[col.slot] ?? '000000';

      const hex =
        row.type === 'base'
          ? baseHex.toUpperCase()
          : row.type === 'tint'
            ? applyThemeTint(baseHex, row.keep)
            : applyThemeShade(baseHex, row.keep);

      const cell: ThemeMatrixCell = {
        hex,
        themeSlot: col.slot,
        label: `${col.name}${row.labelSuffix}`,
      };
      if (row.type === 'tint') cell.tint = row.keep;
      else if (row.type === 'shade') cell.shade = row.keep;
      return cell;
    })
  );
}

export { applyThemeShade, applyThemeTint, validateThemeModifier };
