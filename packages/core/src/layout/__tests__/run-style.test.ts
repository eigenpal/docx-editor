// The accepted run property boundary, resolved for layout (task 7.2).

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RUN_STYLE,
  displayText,
  eastAsiaSlotStyle,
  resolveRunStyle,
  runStylesEqual,
} from '../run-style.ts';

const resolve = (localName: string, attributes?: Record<string, string>) =>
  resolveRunStyle([attributes ? { localName, attributes } : { localName }]);

describe('every D8 run property resolves', () => {
  test('Word falls back to 10pt when no style level authors a size', () => {
    expect(resolveRunStyle([]).fontSizePt).toBe(10);
  });

  test('font family from ascii, falling back to hAnsi', () => {
    expect(resolve('rFonts', { ascii: 'Calibri' }).fontFamily).toBe('Calibri');
    expect(resolve('rFonts', { hAnsi: 'Georgia' }).fontFamily).toBe('Georgia');
    // Without a theme there is nothing to resolve a theme-only reference against.
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

  test('fixture underline variants resolve without collapsing thick or double', () => {
    expect(resolve('u', { val: 'thick' }).underline).toEqual({ variant: 'thick', color: null });
    expect(resolve('u', { val: 'double' }).underline).toEqual({ variant: 'double', color: null });
    expect(resolve('u', { val: 'dotted' }).underline).toEqual({ variant: 'dotted', color: null });
    expect(resolve('u', { val: 'dash' }).underline).toEqual({ variant: 'dash', color: null });
  });

  test('strike and double strike are separate properties', () => {
    expect(resolve('strike').strike).toBe(true);
    expect(resolve('dstrike').doubleStrike).toBe(true);
    expect(resolve('strike').doubleStrike).toBe(false);
  });

  test('strike and dstrike can both be present; paint chooses double', () => {
    const style = resolveRunStyle([{ localName: 'strike' }, { localName: 'dstrike' }]);
    expect(style.strike).toBe(true);
    expect(style.doubleStrike).toBe(true);
  });

  test('a hostile underline colour is dropped at resolve', () => {
    expect(resolve('u', { val: 'single', color: 'javascript:alert(1)' }).underline).toEqual({
      variant: 'single',
      color: null,
    });
  });

  test('highlight, and none meaning absent', () => {
    expect(resolve('highlight', { val: 'yellow' }).highlight).toBe('yellow');
    expect(resolve('highlight', { val: 'none' }).highlight).toBeNull();
  });

  test('character shading is a strict hex fill', () => {
    expect(resolve('shd', { val: 'clear', fill: 'FFEEAA' }).shading).toBe('FFEEAA');
    expect(resolve('shd', { val: 'clear', fill: 'auto' }).shading).toBeNull();
    expect(resolve('shd', { val: 'nil', fill: 'FFEEAA' }).shading).toBeNull();
    expect(resolve('shd', { val: 'clear', fill: 'url(x)' }).shading).toBeNull();
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

describe('a w:rFonts theme reference resolves against the theme part', () => {
  // Word writes the body font as `w:asciiTheme="minorHAnsi"`, usually in `w:docDefaults`,
  // so in a themed document EVERY run reaches here with no explicit family. Leaving those
  // unresolved put the whole document on the surface's fallback face.
  const theme = { major: 'Aharoni', minor: 'Grandview' };
  const themed = (attributes: Record<string, string>) =>
    resolveRunStyle([{ localName: 'rFonts', attributes }], theme).fontFamily;

  test('minor is body text, major is headings', () => {
    expect(themed({ asciiTheme: 'minorHAnsi' })).toBe('Grandview');
    expect(themed({ asciiTheme: 'majorHAnsi' })).toBe('Aharoni');
    // The `*Ascii` spellings name the same two slots.
    expect(themed({ asciiTheme: 'minorAscii' })).toBe('Grandview');
    expect(themed({ hAnsiTheme: 'majorAscii' })).toBe('Aharoni');
  });

  test('the theme attribute overrides the explicit name beside it', () => {
    // Word writes both: the concrete name is there for readers that cannot resolve a
    // theme, and following it would ignore a retheme the author can see (§17.3.2.26).
    expect(themed({ ascii: 'Calibri', asciiTheme: 'minorHAnsi' })).toBe('Grandview');
  });

  test('an unresolvable slot falls back to the explicit name, not to nothing', () => {
    // `minorBidi` names the `a:cs` face this lane does not read.
    expect(themed({ ascii: 'Calibri', asciiTheme: 'minorBidi' })).toBe('Calibri');
    // A theme whose slot is empty leaves the run inheriting rather than naming null.
    expect(
      resolveRunStyle([{ localName: 'rFonts', attributes: { asciiTheme: 'minorHAnsi' } }], {
        major: null,
        minor: null,
      }).fontFamily
    ).toBeNull();
  });
});

describe('the w:rFonts eastAsia slot resolves beside the Latin one', () => {
  const theme = {
    major: 'Aharoni',
    minor: 'Grandview',
    majorEastAsia: 'MS Gothic',
    minorEastAsia: 'SimSun',
  };
  const resolved = (attributes: Record<string, string>, themeFonts = theme) =>
    resolveRunStyle([{ localName: 'rFonts', attributes }], themeFonts);

  test('an explicit w:eastAsia resolves without touching the Latin family', () => {
    const style = resolved({ eastAsia: 'SimSun' });
    expect(style.fontFamilyEastAsia).toBe('SimSun');
    expect(style.fontFamily).toBeNull();
  });

  test('a Latin-only rFonts leaves the eastAsia slot inherited', () => {
    expect(resolved({ ascii: 'Arial' }).fontFamilyEastAsia).toBeNull();
  });

  test('w:eastAsiaTheme resolves against the a:ea typefaces', () => {
    expect(resolved({ eastAsiaTheme: 'minorEastAsia' }).fontFamilyEastAsia).toBe('SimSun');
    expect(resolved({ eastAsiaTheme: 'majorEastAsia' }).fontFamilyEastAsia).toBe('MS Gothic');
  });

  test('the theme attribute overrides the explicit name beside it (§17.3.2.26)', () => {
    expect(
      resolved({ eastAsia: 'PMingLiU', eastAsiaTheme: 'minorEastAsia' }).fontFamilyEastAsia
    ).toBe('SimSun');
  });

  test('an unresolvable theme slot falls back to the explicit name, not to nothing', () => {
    expect(
      resolved(
        { eastAsia: 'PMingLiU', eastAsiaTheme: 'minorEastAsia' },
        { major: null, minor: null }
      ).fontFamilyEastAsia
    ).toBe('PMingLiU');
  });

  test('styles differing only in the eastAsia face are not equal', () => {
    expect(
      runStylesEqual(resolved({ eastAsia: 'SimSun' }), resolved({ eastAsia: 'MS Mincho' }))
    ).toBe(false);
  });
});

describe('eastAsiaSlotStyle derives the face an eastAsia piece uses', () => {
  test('swaps the eastAsia family into fontFamily and memoizes per style object', () => {
    const style = resolveRunStyle([
      { localName: 'rFonts', attributes: { ascii: 'Arial', eastAsia: 'SimSun' } },
    ]);
    const derived = eastAsiaSlotStyle(style);
    expect(derived.fontFamily).toBe('SimSun');
    expect(derived.fontSizePt).toBe(style.fontSizePt);
    expect(eastAsiaSlotStyle(style)).toBe(derived);
  });

  test('answers the style itself when the slot adds nothing', () => {
    expect(eastAsiaSlotStyle(DEFAULT_RUN_STYLE)).toBe(DEFAULT_RUN_STYLE);
    const same = resolveRunStyle([
      { localName: 'rFonts', attributes: { ascii: 'SimSun', eastAsia: 'SimSun' } },
    ]);
    expect(eastAsiaSlotStyle(same)).toBe(same);
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
    expect(runStylesEqual(resolve('u', { val: 'single' }), resolve('u', { val: 'double' }))).toBe(
      false
    );
  });

  test('thick underline is not equal to single', () => {
    expect(runStylesEqual(resolve('u', { val: 'single' }), resolve('u', { val: 'thick' }))).toBe(
      false
    );
  });

  test('strike is not equal to double strike', () => {
    expect(runStylesEqual(resolve('strike'), resolve('dstrike'))).toBe(false);
  });
});
