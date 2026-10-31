// Fields copied from a word processor paste as fields, so a table of contents stays one.
//
// The HTML follows the word processor's clipboard form: each field's begin marker, instruction
// and separator sit in a `supportFields` conditional comment, the result is ordinary HTML, and
// a later comment holds the end marker. Entries are hyperlinks to `_Toc` bookmarks, each with a
// nested PAGEREF field for its page number.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { detectBodyTocs, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '../docx-editor.ts';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { wordFieldRuns } from '../clipboard-html-fields.ts';
import { docx, paragraph } from './paginated-surface-fixtures.ts';

const field = (inner: string) => `<!--[if supportFields]>${inner}<![endif]-->`;
const begin = "<span style='mso-element:field-begin'></span>";
const separator = "<span style='mso-element:field-separator'></span>";
const end = "<span style='mso-element:field-end'></span>";

function entry(level: number, text: string, bookmark: string, page: number, first = false) {
  const open = first
    ? field(
        `${begin}<span style='mso-spacerun:yes'> </span>TOC \\o &quot;1-3&quot; \\h \\z \\u ${separator}`
      )
    : '';
  return (
    `<p class=MsoToc${level} style='tab-stops:right dotted 431.5pt'>${open}` +
    `<span class=MsoHyperlink><a href="#${bookmark}">${text}` +
    `<span style='color:windowtext;display:none;mso-hide:screen'><span style='mso-tab-count:1 dotted'>. . . </span></span>` +
    `<span style='color:windowtext;display:none;mso-hide:screen'>${field(`${begin} PAGEREF ${bookmark} \\h ${separator}`)}${page}${field(end)}</span>` +
    '</a></span></p>'
  );
}

const WORD_TOC =
  '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><body>' +
  entry(1, 'Introduction', '_Toc100000001', 1, true) +
  entry(2, 'Scope', '_Toc100000002', 2) +
  `<p class=MsoNormal>${field(end)}<o:p>&nbsp;</o:p></p>` +
  `<h1><a name="_Toc100000001">Introduction</a></h1><p class=MsoNormal>Body one.</p>` +
  `<h2><a name="_Toc100000002">Scope</a></h2><p class=MsoNormal>Body two.</p>` +
  '</body></html>';

function fragmentXml(html: string): string {
  const projected = projectExternalHtml(html);
  if (!projected.ok) throw new Error(projected.reason);
  return strFromU8(unzipSync(projected.fragmentBytes)['word/document.xml']!);
}

describe('word field comments', () => {
  test('a field comment becomes begin, instruction and separator runs', () => {
    const runs = wordFieldRuns(
      `[if supportFields]>${begin}<span style='mso-spacerun:yes'> </span>TOC \\o &quot;1-3&quot; \\h ${separator}<![endif]`,
      {}
    );
    expect(runs).toEqual([
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
      '<w:r><w:instrText xml:space="preserve"> TOC \\o &quot;1-3&quot; \\h </w:instrText></w:r>',
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    ]);
  });

  test('other comments and oversized instructions give no runs', () => {
    expect(wordFieldRuns('[if gte mso 9]><xml></xml><![endif]', {})).toEqual([]);
    expect(
      wordFieldRuns(`[if supportFields]>${begin} ${'x'.repeat(4000)} ${separator}<![endif]`, {})
    ).toEqual([]);
  });

  test('a pasted table of contents keeps its field, entry styles and page fields', () => {
    const xml = fragmentXml(WORD_TOC);
    const begins = xml.match(/w:fldCharType="begin"/g) ?? [];
    const ends = xml.match(/w:fldCharType="end"/g) ?? [];
    expect(begins.length).toBe(3);
    expect(ends.length).toBe(3);
    expect(xml).toContain('TOC \\o &quot;1-3&quot; \\h \\z \\u');
    expect(xml).toContain('PAGEREF _Toc100000002 \\h');
    expect(xml).toContain('<w:pStyle w:val="TOC1"/>');
    expect(xml).toContain('<w:pStyle w:val="TOC2"/>');
  });

  test('a selection that holds half a field keeps the text and drops the field', () => {
    const half =
      '<html xmlns:w="urn:schemas-microsoft-com:office:word"><body>' +
      entry(1, 'Introduction', '_Toc100000001', 1, true) +
      '</body></html>';
    const xml = fragmentXml(half);
    expect(xml).not.toContain('w:fldChar');
    expect(xml).not.toContain('w:instrText');
    expect(xml).toContain('Introduction');
  });
});

test('the pasted table of contents is a table of contents in the document', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(paragraph('Start')),
  });
  try {
    expect(editor.exec({ type: 'paste', text: 'fallback', html: WORD_TOC })).toMatchObject({
      ok: true,
    });
    const saved = readOoxmlPackage(new Uint8Array(await editor.save()));
    if (!saved.ok) throw new Error(saved.reason);
    const main = saved.package.parts.get(saved.package.mainDocumentPart)!;
    const tocs = detectBodyTocs(main);
    expect(tocs.length).toBe(1);
    // It updates like one: the entries are rebuilt from the pasted headings.
    expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toMatchObject({ ok: true });
    const refreshed = readOoxmlPackage(new Uint8Array(await editor.save()));
    if (!refreshed.ok) throw new Error(refreshed.reason);
    const after = refreshed.package.parts.get(refreshed.package.mainDocumentPart)!;
    expect(detectBodyTocs(after).length).toBe(1);
  } finally {
    editor.destroy();
  }
});
