import { describe, expect, test } from 'bun:test';
import { resolveThemeColorHex } from '@docx-editor.dev/core/editor';
import { resolveColor } from '../colorResolver.ts';

// Independent ECMA expectations — reference/quick-ref/themes-colors.md:110-133
//   tint:  final = (tintByte/255)*white + (1 - tintByte/255)*theme
//   shade: final = (shadeByte/255)*theme
function channelRound(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function ecmaTintHex(baseHex: string, themeRetained: number): string {
  const tintByte = channelRound((1 - themeRetained) * 255);
  const t = tintByte / 255;
  const r = parseInt(baseHex.slice(0, 2), 16);
  const g = parseInt(baseHex.slice(2, 4), 16);
  const b = parseInt(baseHex.slice(4, 6), 16);
  const byte = (n: number) => channelRound(n).toString(16).toUpperCase().padStart(2, '0');
  return `${byte(t * 255 + (1 - t) * r)}${byte(t * 255 + (1 - t) * g)}${byte(t * 255 + (1 - t) * b)}`;
}

function ecmaShadeHex(baseHex: string, themeRetained: number): string {
  const shadeByte = channelRound(themeRetained * 255);
  const s = shadeByte / 255;
  const r = parseInt(baseHex.slice(0, 2), 16);
  const g = parseInt(baseHex.slice(2, 4), 16);
  const b = parseInt(baseHex.slice(4, 6), 16);
  const byte = (n: number) => channelRound(n).toString(16).toUpperCase().padStart(2, '0');
  return `${byte(s * r)}${byte(s * g)}${byte(s * b)}`;
}

const CUSTOM_THEME = {
  accent2: 'ED7D31',
  accent1: '4472C4',
} as const;

describe('React color resolver with custom theme (ECMA reference)', () => {
  test('accent2 tint 25% retained matches independent ECMA arithmetic', () => {
    const expected = ecmaTintHex(CUSTOM_THEME.accent2, 0.25);
    const color = { kind: 'theme' as const, slot: 'accent2', tint: 0.25 };
    const themeEntries = [{ slot: 'accent2' as const, hex: CUSTOM_THEME.accent2 }];
    const resolved = resolveThemeColorHex(color, themeEntries);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe(expected);
    expect(resolveColor(color, { colorScheme: CUSTOM_THEME })).toBe(`#${expected}`);
  });

  test('accent2 shade 50% retained matches independent ECMA arithmetic', () => {
    const expected = ecmaShadeHex(CUSTOM_THEME.accent2, 0.5);
    const color = { kind: 'theme' as const, slot: 'accent2', shade: 0.5 };
    const themeEntries = [{ slot: 'accent2' as const, hex: CUSTOM_THEME.accent2 }];
    const resolved = resolveThemeColorHex(color, themeEntries);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe(expected);
    expect(resolveColor(color, { colorScheme: CUSTOM_THEME })).toBe(`#${expected}`);
  });

  test('per-channel rounding on accent1 tint 50%', () => {
    const expected = ecmaTintHex(CUSTOM_THEME.accent1, 0.5);
    expect(expected).toBe('A2B9E2');
    const color = { kind: 'theme' as const, slot: 'accent1', tint: 0.5 };
    expect(resolveColor(color, { colorScheme: CUSTOM_THEME })).toBe(`#${expected}`);
  });

  test('both modifiers resolve with tint precedence in React shared resolver', () => {
    const tintOnly = ecmaTintHex(CUSTOM_THEME.accent2, 0.8);
    const shadeOnly = ecmaShadeHex(CUSTOM_THEME.accent2, 0.5);
    expect(tintOnly).not.toBe(shadeOnly);
    const color = { kind: 'theme' as const, slot: 'accent2', tint: 0.8, shade: 0.5 };
    const themeEntries = [{ slot: 'accent2' as const, hex: CUSTOM_THEME.accent2 }];
    const resolved = resolveThemeColorHex(color, themeEntries);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.hex).toBe(tintOnly);
    expect(resolveColor(color, { colorScheme: CUSTOM_THEME })).toBe(`#${tintOnly}`);
  });
});
