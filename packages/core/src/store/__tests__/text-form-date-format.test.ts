import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  paragraphTextOf,
  readOoxmlPart,
  textFormFieldsOf,
  validateTreeOp,
  type OoxmlParagraphNode,
} from '../index.ts';

import { parseTextFormDate } from '../store/text-form-date-format.ts';
function dateField(value: string, format: string) {
  const opened = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="DateInput"/><w:textInput><w:type w:val="date"/><w:default w:val="7"/><w:format w:val="${format}"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${value}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  const body = opened.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const paragraph = body.children[0] as OoxmlParagraphNode;
  const field = textFormFieldsOf(paragraph)[0]!;
  return { part: opened.part, paragraph, field };
}

for (const [order, format, expected] of [
  ['dmy', 'MM/dd/yyyy', '02/01/2030'],
  ['dmy', 'dd/MM/yyyy', '01/02/2030'],
  ['dmy', 'MMMM d, yyyy', 'February 1, 2030'],
  ['mdy', 'dd/MM/yyyy', '02/01/2030'],
] as const) {
  test(`date input ${order} is independent of output ${format}`, () => {
    const { part, paragraph, field } = dateField('1/2/2030', format);
    const op = {
      op: 'commitTextFormField',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      dateInputOrder: order,
    } as const;
    expect(validateTreeOp(part, op)).toBeNull();
    const result = applyTreeOp(part, op);
    expect(result.ok).toBe(true);
    if (result.ok) expect(paragraphTextOf(result.part, paragraph.id)).toBe(expected);
    const defaults = {
      op: 'setTextFormFieldDefault',
      paragraphId: paragraph.id,
      fieldNodeId: field.fieldNodeId,
      text: '1/2/2030',
      dateInputOrder: order,
    } as const;
    expect(validateTreeOp(part, defaults)).toBeNull();
    const edited = applyTreeOp(part, defaults);
    if (edited.ok) expect(paragraphTextOf(edited.part, paragraph.id)).toBe(expected);
    expect(edited.ok).toBe(true);
  });
}
test('date input falls back when preferred slash order is invalid', () => {
  for (const order of ['mdy', 'dmy'] as const) {
    for (const value of ['12/31/2030', '31/12/2030']) {
      expect(parseTextFormDate(value, order)).toEqual({ year: 2030, month: 12, day: 31 });
    }
    expect(parseTextFormDate('2/30/2030', order)).toBeNull();
  }
});
test('date input supports ISO and the two-digit year cutoff', () => {
  expect(parseTextFormDate('2030-02-01', 'dmy')).toEqual({ year: 2030, month: 2, day: 1 });
  expect(parseTextFormDate('1/2/29', 'dmy')).toEqual({ year: 2029, month: 2, day: 1 });
  expect(parseTextFormDate('1/2/30', 'dmy')).toEqual({ year: 1930, month: 2, day: 1 });
});
test('date input defaults to mdy and rejects invalid operation policy', () => {
  const { part, paragraph, field } = dateField('1/2/2030', 'dd/MM/yyyy');
  const op = {
    op: 'commitTextFormField',
    paragraphId: paragraph.id,
    fieldNodeId: field.fieldNodeId,
  } as const;
  const result = applyTreeOp(part, op);
  expect(result.ok).toBe(true);
  if (result.ok) expect(paragraphTextOf(result.part, paragraph.id)).toBe('02/01/2030');
  const invalid = { ...op, dateInputOrder: 'invalid' } as unknown as typeof op;
  expect(validateTreeOp(part, invalid)).toBe('invalidArgs');
  expect(applyTreeOp(part, invalid).ok).toBe(false);
});
