// The font compatibility notice's detection: which document families render substituted.

import { describe, expect, test } from 'bun:test';
import {
  createLocalFontProbe,
  detectFontSubstitutions,
  fontResolverFamilies,
} from '../font-availability.ts';

/** A canvas-like context where only `widths`-listed families change the measurement. */
function fakeContext(resolvedFamilies: readonly string[]) {
  let font = '';
  return {
    set font(value: string) {
      font = value;
    },
    get font() {
      return font;
    },
    measureText(text: string) {
      const resolved = resolvedFamilies.some((family) => font.includes(`"${family}"`));
      return { width: text.length * (resolved ? 7 : 10) };
    },
  };
}

describe('createLocalFontProbe', () => {
  test('a family that changes the measurement resolves; one that does not is substituted', () => {
    const probe = createLocalFontProbe(fakeContext(['Calibri']));
    expect(probe('Calibri')).toBe(true);
    expect(probe('Aptos')).toBe(false);
  });

  test('no canvas means no evidence: every family reports resolved', () => {
    const probe = createLocalFontProbe(null);
    expect(probe('Aptos')).toBe(true);
  });

  test('a hostile family name is never probed and never reported', () => {
    const context = fakeContext([]);
    const probe = createLocalFontProbe(context);
    expect(probe('Aptos"; url(evil)')).toBe(true);
    expect(context.font).toBe('');
  });
});

describe('detectFontSubstitutions', () => {
  test('covered and resolvable families drop out; the rest keep catalog order', () => {
    const families = ['Aptos', 'Calibri', 'EmbeddedFace', 'Wingdings X'];
    const covered = (family: string) => family === 'EmbeddedFace';
    const resolves = (family: string) => family === 'Calibri';
    expect(detectFontSubstitutions(families, covered, resolves)).toEqual(['Aptos', 'Wingdings X']);
  });

  test('everything resolved answers empty', () => {
    expect(
      detectFontSubstitutions(
        ['A', 'B'],
        () => false,
        () => true
      )
    ).toEqual([]);
  });

  test('a metric-compatible twin in the fallback stack is not a reportable substitution', () => {
    // Calibri is missing but Carlito — its metric twin, and the next entry in the stack
    // both measurement and paint use — resolves. Advances are identical, so wrap and
    // pagination match Word and there is no fidelity loss to report.
    expect(
      detectFontSubstitutions(
        ['Calibri', 'Aptos'],
        () => false,
        (family) => family === 'Carlito'
      )
    ).toEqual(['Aptos']);
  });

  test('a family whose twin is also missing is still reported', () => {
    expect(
      detectFontSubstitutions(
        ['Calibri'],
        () => false,
        () => false
      )
    ).toEqual(['Calibri']);
  });

  test('the twin lookup is case-insensitive, like the document catalog', () => {
    expect(
      detectFontSubstitutions(
        ['calibri'],
        () => false,
        (family) => family === 'Carlito'
      )
    ).toEqual([]);
  });
});

describe('fontResolverFamilies', () => {
  test('declared families come first, symbol faces after, with no duplicate', () => {
    expect(fontResolverFamilies(['Garamond', 'MS Gothic'], ['Wingdings', 'ms gothic'], 64)).toEqual(
      ['Garamond', 'MS Gothic', 'Wingdings']
    );
  });

  test('a document that fills the bound with declared families still asks for its symbols', () => {
    // Without the reservation a template naming `cap` faces crowds every symbol face out,
    // so an app could never supply the face a private-use glyph needs.
    const declared = Array.from({ length: 64 }, (_, index) => `Face ${index}`);
    const families = fontResolverFamilies(declared, ['Wingdings'], 64);
    expect(families).toHaveLength(64);
    expect(families.at(-1)).toBe('Wingdings');
    expect(families[0]).toBe('Face 0');
  });

  test('the bound is never exceeded, and symbol faces never take it whole', () => {
    // The reservation is a floor on what steps aside, so a tight bound still leads with the
    // face the text renders in.
    const symbols = Array.from({ length: 20 }, (_, index) => `Symbol ${index}`);
    const families = fontResolverFamilies(['Garamond'], symbols, 4);
    expect(families).toHaveLength(4);
    expect(families[0]).toBe('Garamond');
  });

  test('a symbol face the cut would drop is still asked for, declared or not', () => {
    // Word writes the symbol face on the run as well, so a checkbox face is usually
    // declared too — and `documentFonts()` sorts by code point, which puts Wingdings past
    // the cut in any long list.
    const declared = [...Array.from({ length: 70 }, (_, index) => `Face ${index}`), 'Wingdings'];
    expect(fontResolverFamilies(declared, ['Wingdings'], 64)).toContain('Wingdings');
  });

  test('a symbol face the bound already carries costs the declared list nothing', () => {
    const declared = ['MS Gothic', ...Array.from({ length: 63 }, (_, index) => `Face ${index}`)];
    const families = fontResolverFamilies(declared, ['MS Gothic'], 64);
    expect(families).toHaveLength(64);
    expect(families.at(-1)).toBe('Face 62');
  });

  test('room left over after the reservation still goes to the remaining symbol faces', () => {
    const symbols = Array.from({ length: 10 }, (_, index) => `Symbol ${index}`);
    expect(fontResolverFamilies(['Garamond'], symbols, 64)).toHaveLength(11);
  });
});
