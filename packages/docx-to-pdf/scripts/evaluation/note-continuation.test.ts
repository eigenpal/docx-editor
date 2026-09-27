import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { serializeOoxmlPart } from '../../../core/src/store/package/ooxml-tree.ts';
import { noticeFixture } from '../../../core/src/layout/__tests__/note-continuation-fixture.ts';
import { layoutSemanticDocument } from '../../../core/src/layout/semantic-layout.ts';
import { docx } from '../../test/fixture.ts';
import { exportPdf } from '../../src/index.ts';
import { recordLayoutText } from './layout-text.ts';

test('raw layout text includes the notice after note text with distinct source ownership', () => {
  const source = noticeFixture('Continued');
  const layout = layoutSemanticDocument(source.document, 0, source.options);
  const text = recordLayoutText({ ...layout, reviewArtifacts: [] });
  const lines = text.pages[0]!.lines;
  const notice = lines.find((l) => l.text === 'Continued');
  expect(notice?.story).toBe('note-separator');
  expect(lines.at(-1)).toBe(notice);
  const noticeParagraph = layout.pages[0]!.footnotes!.continuationNotice!.fragments.find(
    (f) => f.kind === 'paragraph'
  );
  expect(notice?.spans[0]?.sourceRange?.paragraphId).toBe(noticeParagraph?.paragraphId);
  expect(text.pages[1]!.lines.some((l) => l.text === 'Continued')).toBe(false);
});
function notePackage(noticeHeight = 12) {
  const source = noticeFixture('Continued', noticeHeight);
  return docx('', {
    'word/document.xml': serializeOoxmlPart(source.document),
    'word/footnotes.xml': serializeOoxmlPart(source.options.notes.footnotesPart),
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
  });
}

test('PDF paint includes an authored continuation notice on the split page only', async () => {
  const bytes = notePackage();
  const result = await exportPdf(bytes, {
    fidelityPolicy: 'best-effort',
    useSystemFonts: false,
    comments: false,
  });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const text = await (await pdf.getPage(n)).getTextContent();
      pages.push(text.items.map((i) => ('str' in i ? i.str : '')).join(' '));
    }
    expect(pages[0]).toContain('Continued');
    expect(pages.slice(1).join(' ')).not.toContain('Continued');
  } finally {
    await pdf.destroy();
  }
});

test('PDF export reports an oversized notice without dropping note text', async () => {
  const result = await exportPdf(notePackage(1000), {
    fidelityPolicy: 'best-effort',
    useSystemFonts: false,
    comments: false,
  });
  expect(result.diagnostics.some((d) => d.code === 'note-continuation-notice-height-cap')).toBe(
    true
  );
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    let text = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      text += content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
    }
    expect(text).toContain('Note line 6');
    expect(text).not.toContain('Continued');
  } finally {
    await pdf.destroy();
  }
});
