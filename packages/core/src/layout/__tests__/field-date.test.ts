// DATE and TIME fields show `fieldDate` through their `\@` picture when a host passes one, because
// their value is the current moment (ECMA-376 Part 1, 17.16.5.13, 17.16.5.65). Without it, every
// field keeps its saved result.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, createLayoutSession, layoutSemanticDocument } from '../index.ts';
import { formatDateField, parseDateFieldInstruction } from '../field-date.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
/** Thursday 5 March 2026, 14:07 local time. */
const MOMENT = new Date(2026, 2, 5, 14, 7);

const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;

function complexField(instruction: string, cached: string): string {
  return (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    (cached ? text(cached) : '') +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  );
}

const simpleField = (instruction: string, cached: string) =>
  `<w:fldSimple w:instr=" ${instruction.replaceAll('"', '&quot;')} ">${text(cached)}</w:fldSimple>`;

function format(instruction: string): string | null {
  const spec = parseDateFieldInstruction(instruction);
  return spec ? formatDateField(spec, MOMENT) : null;
}

function partOf(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function painted(
  body: string | OoxmlPart,
  options: Parameters<typeof layoutSemanticDocument>[2]
): string {
  const part = typeof body === 'string' ? partOf(body) : body;
  const layout = layoutSemanticDocument(part, 1, options);
  return layout.pages
    .flatMap((page) => page.fragments)
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
}

describe('DATE and TIME pictures', () => {
  test('format the date and time codes', () => {
    expect(format('DATE \\@ "dd MMMM yyyy"')).toBe('05 March 2026');
    expect(format('DATE \\@ "d MMMM yyyy"')).toBe('5 March 2026');
    expect(format('DATE \\@ "d/MM/yyyy"')).toBe('5/03/2026');
    expect(format('DATE \\@ "dd/MM/yy"')).toBe('05/03/26');
    expect(format('DATE \\@ "dddd, dd MMMM yyyy"')).toBe('Thursday, 05 March 2026');
    expect(format('DATE \\@ "ddd d MMM"')).toBe('Thu 5 Mar');
    expect(format('DATE \\@ M/d/yyyy \\* MERGEFORMAT')).toBe('3/5/2026');
    expect(format('TIME \\@ "HH:mm"')).toBe('14:07');
    // 17.16.4.1 shows `h:mm am/pm` as `5:28 PM`: both spellings are upper case.
    expect(format('time \\@ "h:mm am/pm"')).toBe('2:07 PM');
    expect(format('TIME \\@ "hh:mm AM/PM"')).toBe('02:07 PM');
    expect(format(`DATE \\@ "'Dated' d MMMM"`)).toBe('Dated 5 March');
  });

  test('show midnight and noon on the 12-hour clock', () => {
    const spec = parseDateFieldInstruction('TIME \\@ "h AM/PM"')!;
    expect(formatDateField(spec, new Date(2026, 0, 1, 0, 30))).toBe('12 AM');
    expect(formatDateField(spec, new Date(2026, 0, 1, 12, 30))).toBe('12 PM');
  });

  test('show names only in an English run', () => {
    const spec = parseDateFieldInstruction('DATE \\@ "dddd d MMMM"')!;
    const lang = (val: string, extra: object = {}) => ({
      kind: 'property' as const,
      localName: 'lang',
      attributes: { val, ...extra },
    });
    const at = (props: readonly object[]) =>
      formatDateField(spec, MOMENT, props as Parameters<typeof formatDateField>[2]);
    expect(at([])).toBe('Thursday 5 March');
    expect(at([lang('en-GB')])).toBe('Thursday 5 March');
    expect(at([lang('fr-FR')])).toBeNull();
    // The cascade lists the run's own value last, and it wins.
    expect(at([lang('fr-FR'), lang('en-US')])).toBe('Thursday 5 March');
    expect(at([lang('en-US'), lang('de-DE')])).toBeNull();
    // A complex-script run reads `w:bidi`.
    expect(
      at([lang('en-US', { bidi: 'ar-SA' }), { kind: 'property', localName: 'rtl' }])
    ).toBeNull();
    // Numbers do not depend on the language.
    const numeric = parseDateFieldInstruction('DATE \\@ "dd/MM/yyyy h AM/PM"')!;
    expect(formatDateField(numeric, MOMENT, [lang('pl-PL')] as never)).toBe('05/03/2026 2 PM');
  });

  test('leave the fields they cannot match inert', () => {
    for (const instruction of [
      'DATE',
      'DATE \\* MERGEFORMAT',
      'DATE \\@ "dd/MM/yyyy" \\l',
      'DATE \\@ "dd/MM/yyyy" \\h',
      'DATE \\@ "dd/MM/yyyy" \\* Upper',
      'DATE \\@ "d MMMM yyyy" \\@ "d/M/yy"',
      'DATE \\@ "HH:mm:ss"',
      'DATE \\@ "yyy"',
      'DATE \\@ "\'unterminated"',
      'DATE \\@ "unterminated',
      'CREATEDATE \\@ "dd/MM/yyyy"',
      'SAVEDATE \\@ "dd/MM/yyyy"',
      'PRINTDATE \\@ "dd/MM/yyyy"',
      `DATE \\@ "${'d'.repeat(5000)}"`,
    ]) {
      expect(parseDateFieldInstruction(instruction)).toBeNull();
    }
  });
});

describe('DATE fields in layout', () => {
  const body =
    `<w:p>${text('Dated ')}${complexField('DATE \\@ "d MMMM yyyy"', '1 January 2020')}</w:p>` +
    `<w:p>${text('At ')}${simpleField('TIME \\@ "HH:mm"', '09:00')}</w:p>` +
    `<w:p>${text('Raw ')}${complexField('DATE', '01/01/2020')}</w:p>`;

  test('show the saved results without a field date', () => {
    expect(painted(body, { measurer })).toBe('Dated 1 January 2020At 09:00Raw 01/01/2020');
  });

  test('show the field date with one', () => {
    expect(painted(body, { measurer, fieldDate: MOMENT })).toBe(
      'Dated 5 March 2026At 14:07Raw 01/01/2020'
    );
  });

  test('show the field date over an empty saved result', () => {
    const empty = `<w:p>${complexField('DATE \\@ "dd/MM/yyyy"', '')}</w:p>`;
    expect(painted(empty, { measurer, fieldDate: MOMENT })).toBe('05/03/2026');
  });

  test('keep the saved result of a name in a run of another language', () => {
    const french = (instruction: string, cached: string) =>
      complexField(instruction, cached).replaceAll(
        '<w:r>',
        '<w:r><w:rPr><w:lang w:val="fr-FR"/></w:rPr>'
      );
    const mixed =
      `<w:p>${french('DATE \\@ "d MMMM yyyy"', '1 janvier 2020')}</w:p>` +
      `<w:p>${french('DATE \\@ "dd/MM/yyyy"', '01/01/2020')}</w:p>`;
    expect(painted(mixed, { measurer, fieldDate: MOMENT })).toBe('1 janvier 202005/03/2026');
  });

  test('keep the saved results while saved results are editable text', () => {
    expect(painted(body, { measurer, fieldDate: MOMENT, fieldResults: 'editable' })).toBe(
      'Dated 1 January 2020At 09:00Raw 01/01/2020'
    );
  });

  test('do not reuse a cached layout made for another date', () => {
    const part = partOf(body);
    const options = { measurer, session: createLayoutSession(), producer: 'date' };
    expect(painted(part, { ...options, fieldDate: MOMENT })).toContain('5 March 2026');
    expect(painted(part, { ...options, fieldDate: new Date(2026, 3, 1, 8, 0) })).toContain(
      '1 April 2026'
    );
    expect(painted(part, options)).toContain('1 January 2020');
  });
});
