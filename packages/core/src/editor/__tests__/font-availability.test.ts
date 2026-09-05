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

  test('the bound is never exceeded, however many symbol faces a file names', () => {
    const symbols = Array.from({ length: 20 }, (_, index) => `Symbol ${index}`);
    expect(fontResolverFamilies(['Garamond'], symbols, 4)).toHaveLength(4);
  });
});
