// The inert field instruction allowlist and the insertComplexField op, a trust boundary of its own.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { storyParagraphs } from '../package/story-blocks.ts';
import { inertFieldInstruction } from '../store/inert-field-instruction.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(): { part: OoxmlPart; paragraphId: string } {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>See here</w:t></w:r></w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!read.ok) throw new Error('fixture');
  const body = read.part.root.children.find((node) => node.kind === 'body')!;
  return { part: read.part, paragraphId: storyParagraphs(body)[0]!.id };
}

describe('inertFieldInstruction', () => {
  test('normalizes admitted instructions', () => {
    expect(inertFieldInstruction('  ref   _Ref1  \\h ')).toBe('REF _Ref1 \\h');
    expect(inertFieldInstruction('STYLEREF "Heading 1" \\n')).toBe('STYLEREF "Heading 1" \\n');
    expect(inertFieldInstruction('DATE \\@ "d MMMM yyyy"')).toBe('DATE \\@ "d MMMM yyyy"');
    expect(inertFieldInstruction('SEQ Table \\* ARABIC')).toBe('SEQ Table \\* ARABIC');
    expect(inertFieldInstruction('PAGE')).toBe('PAGE');
  });

  for (const refused of [
    'DDE Excel Sheet1 R1C1',
    'DDEAUTO Excel Sheet1 R1C1',
    'INCLUDETEXT "a.docx"',
    'INCLUDEPICTURE "https://example.com/a.png"',
    'IMPORT "a.png"',
    'LINK Excel.Sheet.8 "a.xlsx"',
    'MACROBUTTON Run Click',
    'AUTOTEXT Entry',
    'HYPERLINK "https://example.com"',
    'REF _Ref1 INCLUDETEXT',
    'REF "includetext"',
    'REF "https://example.com"',
    'REF',
    'SEQ \\h',
    'PAGE \\* roman',
    'REF _Ref1\t\\h',
    'REF _Ref1 ',
    'REF _Ref1 "a\\b"',
    'REF <w:r/>',
    `REF _Ref1 ${'\\h '.repeat(100)}`,
    '',
    42,
  ]) {
    test(`refuses ${JSON.stringify(refused).slice(0, 40)}`, () => {
      expect(inertFieldInstruction(refused)).toBeNull();
    });
  }
});

describe('insertComplexField', () => {
  test('writes four runs into one tracked insertion', () => {
    const { part: before, paragraphId } = part();
    const result = applyTreeOp(before, {
      op: 'insertComplexField',
      paragraphId,
      offset: 4,
      instruction: 'REF _Ref1 \\h',
      revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain(
      '<w:ins w:author="Ada" w:date="2026-01-01T00:00:00Z" w:id="0"><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\h </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:ins>'
    );
    expect(xml).not.toContain('fldSimple');
  });

  test('writes the same field shape without a revision', () => {
    const { part: before, paragraphId } = part();
    const result = applyTreeOp(before, {
      op: 'insertComplexField',
      paragraphId,
      offset: 4,
      instruction: 'SEQ Figure',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('<w:instrText xml:space="preserve"> SEQ Figure </w:instrText>');
    expect(xml).not.toMatch(/<w:ins[ >]/);
  });

  for (const instruction of ['DDE Excel Sheet1 R1C1', 'ref _Ref1', 'REF a & b']) {
    test(`refuses ${instruction} at the store boundary`, () => {
      const { part: before, paragraphId } = part();
      const result = applyTreeOp(before, {
        op: 'insertComplexField',
        paragraphId,
        offset: 4,
        instruction,
      });
      expect(result).toMatchObject({ ok: false, reason: 'invalidArgs' });
    });
  }
});
