// DATE and TIME fields show `fieldDate` through their `\@` picture when a host passes one, because
// their value is the current moment (ECMA-376 Part 1, 17.16.5.13, 17.16.5.65). Without it, every
// field keeps its saved result.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, createLayoutSession, layoutSemanticDocument } from '../index.ts';
import { formatDateField, parseDateFieldInstruction } from '../field-date.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

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

function readStyles(inner: string) {
  const read = readOoxmlPart(`<w:styles xmlns:w="${W}">${inner}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
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
      'DATE \\@ "HH:mm:s"',
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

  test('take the language of the instruction run, not of the result run', () => {
    const lang = (value: string) => `<w:rPr><w:lang w:val="${value}"/></w:rPr>`;
    const field = (instructionLang: string, resultLang: string) =>
      `<w:p><w:r>${instructionLang}<w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r>${instructionLang}<w:instrText xml:space="preserve"> DATE \\@ "d MMMM" </w:instrText></w:r>` +
      `<w:r>${instructionLang}<w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r>${resultLang}<w:t>saved</w:t></w:r>` +
      `<w:r>${instructionLang}<w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    expect(painted(field(lang('fr-FR'), ''), { measurer, fieldDate: MOMENT })).toBe('saved');
    expect(painted(field(lang('fr-FR'), lang('en-US')), { measurer, fieldDate: MOMENT })).toBe(
      'saved'
    );
    expect(painted(field(lang('en-US'), lang('fr-FR')), { measurer, fieldDate: MOMENT })).toBe(
      '5 March'
    );
  });

  test('take the language of the live instruction run, not of a deleted one', () => {
    const run = (lang: string, inner: string) =>
      `<w:r><w:rPr><w:lang w:val="${lang}"/></w:rPr>${inner}</w:r>`;
    const tracked =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      `<w:del w:id="1" w:author="A">${run('en-US', '<w:delInstrText xml:space="preserve"> DATE \\@ "d MMMM" </w:delInstrText>')}</w:del>` +
      `<w:ins w:id="2" w:author="A">${run('fr-FR', '<w:instrText xml:space="preserve"> DATE \\@ "d MMMM" </w:instrText>')}</w:ins>` +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      text('saved') +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    expect(painted(tracked, { measurer, fieldDate: MOMENT })).toBe('saved');
    // A fully deleted instruction takes the language of its deleted run.
    const deleted =
      `<w:p>${run('fr-FR', '<w:fldChar w:fldCharType="begin"/>')}` +
      `<w:del w:id="1" w:author="A">${run('en-US', '<w:delInstrText xml:space="preserve"> DATE \\@ "d MMMM" </w:delInstrText>')}</w:del>` +
      run('fr-FR', '<w:fldChar w:fldCharType="separate"/>') +
      text('saved') +
      // Stray instruction text in the result does not decide the language.
      run('fr-FR', '<w:instrText>X</w:instrText>') +
      run('fr-FR', '<w:fldChar w:fldCharType="end"/>') +
      '</w:p>';
    expect(painted(deleted, { measurer, fieldDate: MOMENT })).toBe('5 March');
    // A space-only first run does not decide the language.
    const spaced =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      run('fr-FR', '<w:instrText xml:space="preserve"> </w:instrText>') +
      run('en-US', '<w:instrText xml:space="preserve">DATE \\@ "d MMMM" </w:instrText>') +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      text('saved') +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    expect(painted(spaced, { measurer, fieldDate: MOMENT })).toBe('5 March');
  });

  test('keep the saved result of a picture built from a nested field', () => {
    const nested =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> DATE \\@ "</w:instrText></w:r>' +
      complexField('QUOTE dd', 'dd') +
      '<w:r><w:instrText xml:space="preserve">/MM" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      text('saved') +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    expect(painted(nested, { measurer, fieldDate: MOMENT })).toBe('saved');
  });

  test('keep spaces and tabs inside a quoted picture', () => {
    expect(format('DATE \\@ "d  MMMM\tyyyy"')).toBe('5  March\t2026');
    expect(format('DATE\t\\@\t"yyyy"')).toBe('2026');
    expect(format('DATE \\@ "d\nMMMM"')).toBe('5 March');
  });

  test('show each line break in a picture as one space, a CR LF pair too', () => {
    expect(format('DATE \\@ "d\r\nM"')).toBe('5 3');
    expect(format('DATE \\@ "d\rM"')).toBe('5 3');
    expect(format('DATE \\@ "d\r\n\r\nM"')).toBe('5  3');
    expect(format(`DATE \\@ "d'\r\n'M"`)).toBe('5 3');
  });

  test('format year synonyms and seconds', () => {
    const spec = parseDateFieldInstruction('DATE \\@ "y Y YY YYYY HH:mm:ss"')!;
    expect(formatDateField(spec, new Date(2026, 2, 5, 14, 7, 9))).toBe('26 26 26 2026 14:07:09');
  });

  test('keep the saved result for Thai picture items and SEQ references', () => {
    expect(format('DATE \\@ "\u0E27\u0E27/\u0E14\u0E14/\u0E1B\u0E1B\u0E1B\u0E1B"')).toBeNull();
    expect(format('DATE \\@ "d `Figure` M"')).toBeNull();
    // Letters outside the codes keep the saved result; other scripts and punctuation are literal.
    expect(format('DATE \\@ "yyy"')).toBeNull();
    expect(format('DATE \\@ "s"')).toBeNull();
    expect(format('DATE \\@ "d\u2013M\u00b7d\u5e74M"')).toBe('5\u20133\u00b75\u5e743');
  });

  test('read backslash escapes inside a quoted picture', () => {
    // 17.16.1: `\\` is one backslash and `\"` a double quote.
    expect(format('DATE \\@ "d\\\\M"')).toBe('5\\3');
    expect(format('DATE \\@ "d\\"M"')).toBe('5"3');
    expect(format('DATE \\@ "d\'\\\\\'M"')).toBe('5\\3');
    // A backslash before another character is dropped.
    expect(format('DATE \\@ "d\\M"')).toBe('53');
    expect(format('DATE \\@ "d\\xM"')).toBeNull();
  });

  test('add no text for empty quotes', () => {
    expect(format(`DATE \\@ "d''M"`)).toBe('53');
    // 17.16.4.1: a picture item `'text'` includes its text, and empty quotes include none.
    expect(format(`DATE \\@ "''"`)).toBe('');
  });

  test('take the language of a simple field from its result run when no style sets one', () => {
    const field = (lang: string) =>
      `<w:p><w:fldSimple w:instr=" DATE \\@ &quot;d MMMM&quot; "><w:r><w:rPr><w:lang w:val="${lang}"/></w:rPr><w:t>5 mars</w:t></w:r></w:fldSimple></w:p>`;
    const styleCascade = buildStyleCascadeTable(
      readStyles('<w:style w:type="paragraph" w:default="1" w:styleId="Normal"/>')
    );
    for (const options of [
      { measurer, fieldDate: MOMENT },
      { measurer, fieldDate: MOMENT, styleCascade },
    ]) {
      expect(painted(field('fr-FR'), options)).toBe('5 mars');
      expect(painted(field('en-GB'), options)).toBe('5 March');
    }
  });

  test('take the language of a simple field from the paragraph style over the result run', () => {
    const styleCascade = buildStyleCascadeTable(
      readStyles(
        '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault></w:docDefaults>' +
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="English"><w:name w:val="English"/><w:rPr><w:lang w:val="en-US"/></w:rPr></w:style>'
      )
    );
    const field = `<w:fldSimple w:instr=" DATE \\@ &quot;d MMMM&quot; "><w:r><w:rPr><w:lang w:val="en-US"/></w:rPr><w:t>saved</w:t></w:r></w:fldSimple>`;
    const options = { measurer, fieldDate: MOMENT, styleCascade };
    // The result run and the paragraph mark say en-US; the defaults say fr-FR.
    expect(
      painted(`<w:p><w:pPr><w:rPr><w:lang w:val="en-US"/></w:rPr></w:pPr>${field}</w:p>`, options)
    ).toBe('saved');
    // An English default wins over a French result run.
    const englishDefaults = buildStyleCascadeTable(
      readStyles(
        '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults>'
      )
    );
    expect(
      painted(`<w:p>${field.replace('w:val="en-US"', 'w:val="fr-FR"')}</w:p>`, {
        ...options,
        styleCascade: englishDefaults,
      })
    ).toBe('5 March');
    // The paragraph style names the language.
    expect(painted(`<w:p><w:pPr><w:pStyle w:val="English"/></w:pPr>${field}</w:p>`, options)).toBe(
      '5 March'
    );
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
