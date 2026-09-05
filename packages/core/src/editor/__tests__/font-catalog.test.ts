// The offerable font catalog: configured families merged with document-declared ones.
//
// What these tests pin down: the catalog is never empty (the default face is always
// offerable), substitution WORD-names are offered while their stand-in faces are not,
// host-registered families join, document fonts merge with configuration-first casing,
// and invalid names drop at this boundary like every other catalog derivation.

import { describe, expect, test } from 'bun:test';
import { availableFontFamilies, configuredDefaultFontFamily } from '../font-catalog.ts';

const face = (family: string, weight = 400, style: 'normal' | 'italic' = 'normal') => ({
  family,
  weight,
  style,
});

const source = (family: string) => ({
  request: face(family),
  id: `test:${family}`,
  bytes: new Uint8Array(0),
  hash: 'x',
  faceIndex: 0,
});

describe('configuredDefaultFontFamily', () => {
  test('answers Word default when nothing is configured', () => {
    expect(configuredDefaultFontFamily(undefined)).toBe('Calibri');
    expect(configuredDefaultFontFamily({})).toBe('Calibri');
  });

  test('answers the configured face, but never an invalid name', () => {
    expect(
      configuredDefaultFontFamily({ defaultFont: { family: 'Aptos', sizeHalfPoints: 24 } })
    ).toBe('Aptos');
    expect(
      configuredDefaultFontFamily({
        defaultFont: { family: 'bad"family;url(', sizeHalfPoints: 24 },
      })
    ).toBe('Calibri');
  });
});

describe('availableFontFamilies', () => {
  test('a blank document with no configuration still offers the default face', () => {
    expect(availableFontFamilies(undefined, [])).toEqual(['Calibri']);
  });

  test('substitution Word-names are offered; their stand-in faces are not', () => {
    const catalog = availableFontFamilies(
      {
        sources: [source('Carlito'), source('Liberation Serif')],
        substitutions: [
          { from: face('Calibri'), to: face('Carlito') },
          { from: face('Times New Roman'), to: face('Liberation Serif') },
        ],
      },
      []
    );
    expect(catalog).toEqual(['Calibri', 'Times New Roman']);
  });

  test('host-registered families that stand in for nothing are offered', () => {
    expect(availableFontFamilies({ sources: [source('Inter')] }, [])).toEqual(['Calibri', 'Inter']);
  });

  test('document fonts merge, dedup case-insensitively with configured casing winning', () => {
    const catalog = availableFontFamilies(
      { substitutions: [{ from: face('Arial'), to: face('Liberation Sans') }] },
      ['arial', 'Georgia', 'CALIBRI']
    );
    expect(catalog).toEqual(['Arial', 'Calibri', 'Georgia']);
  });

  test('invalid document names are dropped, never repaired', () => {
    const catalog = availableFontFamilies(undefined, ['Georgia', 'x'.repeat(65), 'bad;name']);
    expect(catalog).toEqual(['Calibri', 'Georgia']);
  });

  test('a symbol-only face is not offered, even once a resolver supplies it', () => {
    // The editor asks the resolver for the face a `w:sym` names, so an app CAN answer it —
    // and a face that arrives that way must not become a text choice.
    const catalog = availableFontFamilies(
      { sources: [source('Wingdings')] },
      ['Georgia'],
      ['Wingdings']
    );
    expect(catalog).toEqual(['Calibri', 'Georgia']);
  });

  test('the default face is offered even when the document names it only in a symbol', () => {
    // The catalog's whole reason to exist is that a picker is never a dead control.
    expect(availableFontFamilies(undefined, [], ['Calibri'])).toEqual(['Calibri']);
  });

  test('a face the document also declares stays offered, symbol use or not', () => {
    const catalog = availableFontFamilies(
      { sources: [source('MS Gothic')] },
      ['MS Gothic'],
      ['MS Gothic']
    );
    expect(catalog).toEqual(['Calibri', 'MS Gothic']);
  });
});
