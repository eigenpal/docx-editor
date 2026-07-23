// Parser breadth: text recovery from hyperlinks, tables, block SDT, multiple w:t
// per run, and w:br/w:tab (document-engine task 2.7 partial; fixes OOXML-review
// gaps 2–4). No text is dropped from these OOXML structures.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { parseDocx } from '../src/index.ts';
import { bodyStoryId, type ParagraphRecord, type TableRecord } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(bodyInner: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml':
      strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
  });
}

function texts(bytes: Uint8Array): string[] {
  const r = parseDocx(bytes);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.model.stories
    .get(bodyStoryId(r.model))!
    .blocks.map((b) => (b as ParagraphRecord).runs.map((run) => run.text).join(''));
}

describe('run-wrapper recovery', () => {
  test('hyperlink runs are recovered', () => {
    expect(texts(docx('<w:p><w:hyperlink><w:r><w:t>linktext</w:t></w:r></w:hyperlink></w:p>'))).toEqual(['linktext']);
  });
  test('tracked-change (w:ins) runs are recovered', () => {
    expect(texts(docx('<w:p><w:ins><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>'))).toEqual(['inserted']);
  });
});

describe('intra-run recovery', () => {
  test('multiple w:t per run and w:br/w:tab are recovered in order', () => {
    expect(texts(docx('<w:p><w:r><w:t>AB</w:t><w:br/><w:t>CD</w:t><w:tab/><w:t>EF</w:t></w:r></w:p>'))).toEqual(['AB\nCD\tEF']);
  });
});

describe('table + block-SDT text recovery', () => {
  test('a table becomes a structural block with recursively addressable cell text', () => {
    const body =
      '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
      '<w:tbl><w:tr>' +
      '<w:tc><w:p><w:r><w:t>cell1</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>cell2</w:t></w:r></w:p></w:tc>' +
      '</w:tr></w:tbl>' +
      '<w:p><w:r><w:t>after</w:t></w:r></w:p>';
    const r = parseDocx(docx(body));
    if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
    const blocks = r.model.stories.get(bodyStoryId(r.model))!.blocks;
    // The table is exactly ONE block between the two paragraphs (no flattening).
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'table', 'paragraph']);
    const t = blocks[1] as TableRecord;
    const cell = (c: number) => (t.rows[0].cells[c].blocks[0] as ParagraphRecord).runs.map((run) => run.text).join('');
    expect(cell(0)).toBe('cell1');
    expect(cell(1)).toBe('cell2');
  });
  test('block SDT content is recovered (table-free doc still flattens SDT)', () => {
    expect(texts(docx('<w:sdt><w:sdtContent><w:p><w:r><w:t>sdttext</w:t></w:r></w:p></w:sdtContent></w:sdt>'))).toEqual(['sdttext']);
  });
});
