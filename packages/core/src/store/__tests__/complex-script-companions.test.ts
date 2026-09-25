// Formatting writes reach the complex-script lane only on runs that use it.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, runPropertyEdits, type OoxmlPart } from '@docx-editor.dev/core/store';
import { complexScriptAt, mergedRunWrite } from '../store/direct-properties.ts';
import { withComplexScriptCompanions } from '../store/complex-script-companions.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PARAGRAPH = '/word/document.xml#0.0.0';

function load(rPr: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr>${rPr}</w:rPr><w:t>abc</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const names = (
  part: OoxmlPart,
  incoming: { localName: string; attributes?: Record<string, string> }
) =>
  runPropertyEdits(part, PARAGRAPH, 0, 3, incoming)[0]!.properties.map(
    (property) =>
      `${property.localName}${property.attributes?.val ? `=${property.attributes.val}` : ''}`
  );

describe('complex-script companions', () => {
  test('bold, italic and size on a w:rtl run write both halves', () => {
    const rtl = load('<w:rtl/>');
    expect(names(rtl, { localName: 'b' })).toEqual(['b', 'bCs']);
    expect(names(rtl, { localName: 'i', attributes: { val: '0' } })).toEqual(['i=0', 'iCs=0']);
    expect(names(rtl, { localName: 'sz', attributes: { val: '28' } })).toEqual([
      'sz=28',
      'szCs=28',
    ]);
  });

  test('a left-to-right run gets exactly what was asked for', () => {
    expect(names(load(''), { localName: 'b' })).toEqual(['b']);
    expect(names(load('<w:rtl w:val="0"/>'), { localName: 'b' })).toEqual(['b']);
  });

  test('w:cs runs pair too, and a font pick fills the cs slot', () => {
    const forced = load('<w:cs/><w:rFonts w:cstheme="minorBidi"/>');
    const font = runPropertyEdits(forced, PARAGRAPH, 0, 3, {
      localName: 'rFonts',
      attributes: { ascii: 'Arial', hAnsi: 'Arial' },
    })[0]!.properties.find((property) => property.localName === 'rFonts');
    // The explicit slot clears the theme reference that would outrank it.
    expect(font?.attributes).toEqual({ ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' });
  });

  test('an entry the write already names is not duplicated', () => {
    const out = withComplexScriptCompanions(true, [
      { localName: 'b' },
      { localName: 'bCs', attributes: { val: '0' } },
    ]);
    expect(out).toEqual([{ localName: 'b' }, { localName: 'bCs', attributes: { val: '0' } }]);
  });

  test('armed caret formatting merges the same way, keyed on the run at the caret', () => {
    const rtl = load('<w:rtl/>');
    const complex = complexScriptAt(rtl, PARAGRAPH, 3);
    expect(complex).toBe(true);
    expect(complexScriptAt(load(''), PARAGRAPH, 3)).toBe(false);
    expect(mergedRunWrite([], [{ localName: 'b' }], complex)).toEqual([
      { localName: 'b' },
      { localName: 'bCs' },
    ]);
  });
});
