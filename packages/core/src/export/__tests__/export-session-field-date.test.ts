// `fieldDate` on `openDocumentForExport`: DATE fields with a `\@` picture (ECMA-376 Part 1,
// 17.16.5.13, 17.16.4.1) export that moment in the body and in footers, the source keeps its
// saved results, and a session without the option exports the saved results.

import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { strToU8, zipSync } from 'fflate';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { openDocumentForExport, type OpenDocumentForExportOptions } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
/** Thursday 5 March 2026, 14:07 local time. */
const MOMENT = new Date(2026, 2, 5, 14, 7);

const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const dateField = (picture: string, cached: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> DATE \\@ "${picture}" </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  text(cached) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function letter(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(
      `<w:ftr xmlns:w="${W}"><w:p>${text('Printed ')}${dateField('dd/MM/yyyy', '01/01/2020')}</w:p></w:ftr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p>${dateField('d MMMM yyyy', '1 January 2020')}</w:p>` +
        '<w:sectPr><w:footerReference w:type="default" r:id="rId1"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
  });
}

function spanText(layout: SemanticLayout): string {
  const parts: string[] = [];
  forEachSemanticSpan(layout, ({ span }) => parts.push(span.text));
  return parts.join('');
}

async function exported(options: OpenDocumentForExportOptions = {}): Promise<string> {
  const opened = openDocumentForExport(letter(), options);
  if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
  try {
    return spanText(await opened.session.layout());
  } finally {
    opened.session.dispose();
  }
}

describe('fieldDate on openDocumentForExport', () => {
  test('the default exports the saved results', async () => {
    const shown = await exported();
    expect(shown).toContain('1 January 2020');
    expect(shown).toContain('01/01/2020');
    expect(shown).not.toContain('2026');
  });

  test('exports the date in the body and the footer', async () => {
    const shown = await exported({ fieldDate: MOMENT });
    expect(shown).toContain('5 March 2026');
    expect(shown).toContain('05/03/2026');
    expect(shown).not.toContain('2020');
  });

  test('keeps the date it opened with when the caller mutates its Date', async () => {
    const date = new Date(MOMENT.getTime());
    const opened = openDocumentForExport(letter(), { fieldDate: date });
    if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
    date.setFullYear(2031);
    try {
      expect(spanText(await opened.session.layoutFor('proposed'))).toContain('5 March 2026');
    } finally {
      opened.session.dispose();
    }
  });

  test('accepts a Date from another realm', async () => {
    const foreign = runInNewContext('new Date(2026, 2, 5, 14, 7)') as Date;
    expect(foreign instanceof Date).toBe(false);
    expect(await exported({ fieldDate: foreign })).toContain('5 March 2026');
  });

  test('refuses a value that is not a valid date', () => {
    expect(() => openDocumentForExport(letter(), { fieldDate: new Date(Number.NaN) })).toThrow(
      'Invalid fieldDate'
    );
    expect(() =>
      openDocumentForExport(letter(), { fieldDate: '2026-03-05' as unknown as Date })
    ).toThrow(TypeError);
  });
});
