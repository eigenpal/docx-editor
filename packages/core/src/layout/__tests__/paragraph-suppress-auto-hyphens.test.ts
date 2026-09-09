import { describe, expect, test } from 'bun:test';
import { ACCEPTED_PARAGRAPH_PROPERTIES, type OoxmlProperty } from '@docx-editor.dev/core/store';
import { paragraphSuppressAutoHyphens } from '../paragraph-suppress-auto-hyphens.ts';

const flag = (val?: string): OoxmlProperty =>
  val === undefined
    ? { localName: 'suppressAutoHyphens' }
    : { localName: 'suppressAutoHyphens', attributes: { val } };

describe('paragraphSuppressAutoHyphens', () => {
  test('last-wins ST_OnOff, presence without val is on', () => {
    expect(paragraphSuppressAutoHyphens([])).toBe(false);
    expect(paragraphSuppressAutoHyphens([flag()])).toBe(true);
    expect(paragraphSuppressAutoHyphens([flag('1')])).toBe(true);
    expect(paragraphSuppressAutoHyphens([flag('true')])).toBe(true);
    expect(paragraphSuppressAutoHyphens([flag('on')])).toBe(true);
    expect(paragraphSuppressAutoHyphens([flag('0')])).toBe(false);
    expect(paragraphSuppressAutoHyphens([flag('false')])).toBe(false);
    expect(paragraphSuppressAutoHyphens([flag('off')])).toBe(false);
    expect(paragraphSuppressAutoHyphens([flag(), flag('0')])).toBe(false);
    expect(paragraphSuppressAutoHyphens([flag('0'), flag()])).toBe(true);
  });

  test('does not add suppressAutoHyphens to authorable paragraph properties', () => {
    expect(
      (ACCEPTED_PARAGRAPH_PROPERTIES as readonly string[]).includes('suppressAutoHyphens')
    ).toBe(false);
  });
});
