// The accepted run property boundary, resolved for layout (task 7.2).

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RUN_STYLE,
  displayText,
  resolveRunStyle,
  runStylesEqual,
} from '../run-style.ts';

const resolve = (localName: string, attributes?: Record<string, string>) =>
  resolveRunStyle([attributes ? { localName, attributes } : { localName }]);

describe('every D8 run property resolves', () => {
  test('font family from ascii, falling back to hAnsi', () => {
    expect(resolve('rFonts', { ascii: 'Calibri' }).fontFamily).toBe('Calibri');
    expect(resolve('rFonts', { hAnsi: 'Georgia' }).fontFamily).toBe('Georgia');
    // A theme-only reference resolves through the theme part, a deferred lane.
    expect(resolve('rFonts', { asciiTheme: 'minorHAnsi' }).fontFamily).toBeNull();
  });

  test('half-point size becomes points', () => {
    expect(resolve('sz', { val: '22' }).fontSizePt).toBe(11);
    expect(resolve('sz', { val: '36' }).fontSizePt).toBe(18);
  });

  test('colour, and auto meaning inherited', () => {
    expect(resolve('color', { val: 'c00000' }).color).toBe('C00000');
    expect(resolve('color', { val: 'auto' }).color).toBeNull();
  });

  test('bold and italic honour toggle semantics', () => {
    expect(resolve('b').bold).toBe(true);
    expect(resolve('b', { val: '0' }).bold).toBe(false);
    expect(resolve('i', { val: 'off' }).italic).toBe(false);
  });

  test('underline keeps its variant and colour', () => {
    expect(resolve('u').underline).toEqual({ variant: 'single', color: null });
    expect(resolve('u', { val: 'wave', color: 'FF0000' }).underline).toEqual({
      variant: 'wave',
      color: 'FF0000',
    });
    expect(resolve('u', { val: 'none' }).underline).toBeNull();
  });

  test('strike and double strike are separate properties', () => {
    expect(resolve('strike').strike).toBe(true);
    expect(resolve('dstrike').doubleStrike).toBe(true);
    expect(resolve('strike').doubleStrike).toBe(false);
  });

  test('highlight, and none meaning absent', () => {
    expect(resolve('highlight', { val: 'yellow' }).highlight).toBe('yellow');
    expect(resolve('highlight', { val: 'none' }).highlight).toBeNull();
  });

  test('vertical alignment and baseline shift', () => {
    expect(resolve('vertAlign', { val: 'superscript' }).verticalAlign).toBe('superscript');
    expect(resolve('vertAlign', { val: 'subscript' }).verticalAlign).toBe('subscript');
    // `w:position` is signed half-points; positive raises.
    expect(resolve('position', { val: '12' }).baselineShiftPt).toBe(6);
    expect(resolve('position', { val: '-8' }).baselineShiftPt).toBe(-4);
  });

  test('caps and small caps', () => {
    expect(resolve('caps').caps).toBe(true);
    expect(resolve('smallCaps').smallCaps).toBe(true);
  });

  test('character spacing in twips, horizontal scaling, kerning', () => {
    expect(resolve('spacing', { val: '20' }).characterSpacingPt).toBe(1);
    expect(resolve('spacing', { val: '-10' }).characterSpacingPt).toBe(-0.5);
    expect(resolve('w', { val: '150' }).horizontalScalePercent).toBe(150);
    expect(resolve('kern', { val: '16' }).kerningMinPt).toBe(8);
  });

  test('an unresolvable value leaves the default rather than guessing', () => {
    // A wrong measurement moves every glyph after it; a missing one is visible at once.
    expect(resolve('sz', { val: 'large' }).fontSizePt).toBe(DEFAULT_RUN_STYLE.fontSizePt);
    expect(resolve('w', { val: '0' }).horizontalScalePercent).toBe(100);
    expect(resolve('color', { val: 'notacolour' }).color).toBeNull();
  });

  test('later properties win, as a single rPr is read in order', () => {
    const style = resolveRunStyle([
      { localName: 'sz', attributes: { val: '22' } },
      { localName: 'sz', attributes: { val: '44' } },
    ]);
    expect(style.fontSizePt).toBe(22);
  });
});

describe('drawn text', () => {
  test('caps uppercases what is measured and painted', () => {
    expect(displayText('hello', resolve('caps'))).toBe('HELLO');
  });

  test('small caps does NOT change the characters', () => {
    // It selects different glyphs; uppercasing here would corrupt what a copy produces.
    expect(displayText('hello', resolve('smallCaps'))).toBe('hello');
  });
});

describe('style equality drives span merging', () => {
  test('identical properties compare equal regardless of order', () => {
    const a = resolveRunStyle([{ localName: 'b' }, { localName: 'i' }]);
    const b = resolveRunStyle([{ localName: 'i' }, { localName: 'b' }]);
    expect(runStylesEqual(a, b)).toBe(true);
  });

  test('a differing underline variant is not equal', () => {
    expect(
      runStylesEqual(resolve('u', { val: 'single' }), resolve('u', { val: 'double' }))
    ).toBe(false);
  });
});
