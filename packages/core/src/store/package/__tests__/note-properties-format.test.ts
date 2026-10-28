import { describe, expect, it } from 'bun:test';
import { resolveEndnoteProperties, resolveFootnoteProperties } from '../note-properties';

describe('a section note number format', () => {
  it('is the default when the section authors note properties without a format, whatever the document says', () => {
    const resolved = resolveFootnoteProperties(
      { numRestart: 'eachSect' },
      { numFmt: 'chicago', numRestart: 'eachSect' }
    );
    expect(resolved.numFmt).toBe('decimal');
    expect(resolved.numRestart).toBe('eachSect');
  });

  it('is the section format when the section names one', () => {
    expect(resolveFootnoteProperties({ numFmt: 'chicago' }, { numFmt: 'decimal' }).numFmt).toBe(
      'chicago'
    );
  });

  it('is the document format for a section with no note properties of its own', () => {
    expect(resolveFootnoteProperties(undefined, { numFmt: 'chicago' }).numFmt).toBe('chicago');
    expect(resolveEndnoteProperties(undefined, undefined).numFmt).toBe('lowerRoman');
  });

  it('keeps the endnote default for a section that authors endnote properties without a format', () => {
    expect(resolveEndnoteProperties({ numRestart: 'eachSect' }, { numFmt: 'decimal' }).numFmt).toBe(
      'lowerRoman'
    );
  });
});
