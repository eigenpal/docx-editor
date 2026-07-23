// Structural table parse + lossless re-emit (fidelity slice 1, task 2.7). This is a
// READ-ONLY semantic table projection with verbatim fragment reuse: unedited table
// documents re-serialize with a byte-identical document.xml part (NOT full-ZIP
// identity — recompression can change container bytes, so we assert the XML part).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseDocx, documentXml } from '../src/package/opc.ts';
import { DocumentStore, ORIGIN_IDS, bodyStoryId, type TableRecord, type ParagraphRecord, type PackageModel, type Story, type Block } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** Minimal DOCX around a body-inner XML string. */
function docx(bodyInner: string, roots = `xmlns:w="${W}"`): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${roots}><w:body>${bodyInner}</w:body></w:document>`),
  });
}

function bodyBlocks(model: PackageModel) {
  return model.stories.get(bodyStoryId(model))!.blocks;
}

function cellText(t: TableRecord, r: number, c: number): string {
  return (t.rows[r].cells[c].blocks[0] as ParagraphRecord).runs.map((run) => run.text).join('');
}

/** Parse then serialize; return the model plus original vs re-emitted document.xml. */
function roundTrip(bytes: Uint8Array) {
  const orig = strFromU8(unzipSync(bytes)['word/document.xml']);
  const r = parseDocx(bytes);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return { model: r.model, orig, out: documentXml(r.model) };
}

describe('real fixtures round-trip (XML-part identical)', () => {
  for (const fx of ['with-tables', 'repeated-table-header']) {
    test(`${fx}.docx: document.xml is byte-identical after parse->serialize`, () => {
      const bytes = readFileSync(`${import.meta.dir}/../../../e2e/fixtures/${fx}.docx`);
      const { orig, out } = roundTrip(bytes);
      expect(out).toBe(orig);
    });
  }

  test('a w:tbl becomes exactly one structural block; cell text is recursively addressable', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../../e2e/fixtures/with-tables.docx`);
    const { model } = roundTrip(bytes);
    const tables = bodyBlocks(model).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1); // exactly one block for the table
    const t = tables[0] as TableRecord;
    expect(t.rows).toHaveLength(3);
    expect(cellText(t, 0, 0)).toBe('A1'); // recursively addressable cell text
    expect(cellText(t, 2, 2)).toBe('C3');
  });
});

describe('surrounding body content stays ordered', () => {
  test('paragraph, table, paragraph keep their order as three blocks', () => {
    const bytes = docx(
      '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>after</w:t></w:r></w:p>',
    );
    const { model, orig, out } = roundTrip(bytes);
    const blocks = bodyBlocks(model);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'table', 'paragraph']);
    expect((blocks[0] as ParagraphRecord).runs[0].text).toBe('before');
    expect((blocks[2] as ParagraphRecord).runs[0].text).toBe('after');
    expect(out).toBe(orig);
  });
});

describe('namespace-qualified unknown children survive save/reopen', () => {
  test('an mc: element inside a table and text between blocks round-trip verbatim', () => {
    const inner =
      '<w:p><w:r><w:t>p1</w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr><mc:Fallback>keep me</mc:Fallback></w:tblPr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const bytes = docx(inner, `xmlns:w="${W}" xmlns:mc="${MC}"`);
    const { orig, out } = roundTrip(bytes);
    expect(out).toBe(orig); // the mc:Fallback (declared only on the root) survives
    expect(out).toContain('<mc:Fallback>keep me</mc:Fallback>');
  });
});

describe('merged, nested, and lexical-width tables', () => {
  test('gridSpan and vMerge are modeled and re-emit verbatim', () => {
    const inner =
      '<w:tbl>' +
      '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr>' +
      '<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>' +
      '</w:tr></w:tbl>';
    const { model, orig, out } = roundTrip(docx(inner));
    const t = bodyBlocks(model).find((b) => b.kind === 'table') as TableRecord;
    expect(t.rows[0].cells[0].props?.gridSpan).toBe(2);
    expect(t.rows[1].cells[0].props?.vMerge).toEqual({ val: 'restart' });
    expect(t.rows[1].cells[1].props?.vMerge).toEqual({}); // bare <w:vMerge/> kept distinct
    expect(out).toBe(orig);
  });

  test('a table nested in a cell is one nested block; outer table is one block', () => {
    const inner =
      '<w:tbl><w:tr><w:tc>' +
      '<w:p><w:r><w:t>outer</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:tc></w:tr></w:tbl>';
    const { model, orig, out } = roundTrip(docx(inner));
    const outer = bodyBlocks(model).filter((b) => b.kind === 'table');
    expect(outer).toHaveLength(1);
    const cell = (outer[0] as TableRecord).rows[0].cells[0];
    expect(cell.blocks.map((b) => b.kind)).toEqual(['paragraph', 'table']);
    expect(((cell.blocks[1] as TableRecord).rows[0].cells[0].blocks[0] as ParagraphRecord).runs[0].text).toBe('inner');
    expect(out).toBe(orig);
  });

  test('unusual lexical widths survive exactly (never rounded to a number)', () => {
    const inner =
      '<w:tbl><w:tblPr><w:tblW w:w="2.5%" w:type="pct"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="05000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="05000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const { model, orig, out } = roundTrip(docx(inner));
    const t = bodyBlocks(model).find((b) => b.kind === 'table') as TableRecord;
    expect(t.props?.width).toEqual({ type: 'pct', value: '2.5%' });
    expect(t.grid?.[0]).toEqual({ w: '05000' }); // leading zero preserved lexically
    expect(out).toBe(orig);
  });
});

describe('editing a preserved table document', () => {
  const bytes = () => readFileSync(`${import.meta.dir}/../../../e2e/fixtures/with-tables.docx`);

  test('editing a preserved top-level paragraph fails closed (no lossy regeneration)', () => {
    const parsed = parseDocx(bytes());
    if (!parsed.ok) throw new Error('parse failed');
    const store = new DocumentStore(parsed.model);
    const bodyId = bodyStoryId(store.currentModel);
    const para = store.currentModel.stories.get(bodyId)!.blocks.find((b) => b.kind === 'paragraph') as ParagraphRecord;
    // Regenerating minimal runs would drop w:pPr/hyperlinks/fields, so any edit to a
    // preserved block fails closed until ownership-aware regeneration exists.
    store.transact(ORIGIN_IDS.mutationHuman, (ctx) => ctx.apply({ op: 'setParagraphRuns', paragraphId: para.id, runs: [{ text: 'EDITED' }] }));
    expect(() => documentXml(store.currentModel)).toThrow(/fail closed/);
  });

  test('a structural op (append a block) fails closed on serialize', () => {
    const parsed = parseDocx(bytes());
    if (!parsed.ok) throw new Error('parse failed');
    const store = new DocumentStore(parsed.model);
    store.transact(ORIGIN_IDS.mutationHuman, (ctx) => ctx.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) }));
    expect(() => documentXml(store.currentModel)).toThrow(/structural change/);
  });

  test('a decoy <w:body>/<w:tbl> inside a prolog comment does not fool the scanner', () => {
    // The real table must still be found and re-emitted verbatim; the comment is inert.
    const inner = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>real</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const xml = `<?xml version="1.0"?><!-- decoy <w:body><w:tbl></w:tbl> --><w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`;
    const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) });
    const r = parseDocx(bytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(bodyBlocks(r.model).filter((b) => b.kind === 'table')).toHaveLength(1);
      expect(documentXml(r.model)).toBe(xml);
    }
  });

  test('malformed table XML (mismatched close) is rejected, not mis-preserved', () => {
    // <w:tc> closed as </w:td>: lenient reader accepts it; strict span scanner rejects.
    const inner = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:td></w:tr></w:tbl>';
    const r = parseDocx(docx(inner));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('xml-error');
  });

  test('an unclosed table is rejected', () => {
    const inner = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr>'; // missing </w:tbl>
    const r = parseDocx(docx(inner));
    expect(r.ok).toBe(false);
  });

  test('a close tag with a quoted ">" (malformed, attributes on end tag) is rejected', () => {
    const inner = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl foo=">">';
    const r = parseDocx(docx(inner));
    expect(r.ok).toBe(false); // quote-aware close-tag scan does not truncate the range
  });

  test('a valid non-w: prefix WordprocessingML document fails closed (no silent data loss)', () => {
    const xml = `<?xml version="1.0"?><x:document xmlns:x="${W}"><x:body><x:tbl><x:tr><x:tc><x:p><x:r><x:t>hi</x:t></x:r></x:p></x:tc></x:tr></x:tbl></x:body></x:document>`;
    const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) });
    const r = parseDocx(bytes);
    expect(r.ok).toBe(false); // rejected rather than returning an empty, lossy model
    if (!r.ok) expect(r.reason).toBe('xml-error');
  });

  test('a non-numeric gridSpan does not crash parseDocx (returns a result)', () => {
    const inner = '<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="notnum"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const r = parseDocx(docx(inner));
    expect(r.ok).toBe(true); // NaN never reaches the model or the hash
    if (r.ok) {
      const t = bodyBlocks(r.model).find((b) => b.kind === 'table') as TableRecord;
      expect(t.rows[0].cells[0].props?.gridSpan).toBeUndefined(); // dropped, not NaN
    }
  });

  test('editing a table cell fails closed (table regeneration is not implemented)', () => {
    const parsed = parseDocx(bytes());
    if (!parsed.ok) throw new Error('parse failed');
    const model = parsed.model;
    const bodyId = bodyStoryId(model);
    const body = model.stories.get(bodyId)!;
    // Change a cell's content while keeping the table id/order (a cell edit).
    const changed: Block[] = body.blocks.map((b) => {
      if (b.kind !== 'table') return b;
      const t = b as TableRecord;
      const firstCell = t.rows[0].cells[0];
      const newCell = { ...firstCell, blocks: [{ kind: 'paragraph' as const, id: (firstCell.blocks[0] as ParagraphRecord).id, runs: [{ text: 'CHANGED' }] }] };
      const newRow = { ...t.rows[0], cells: [newCell, ...t.rows[0].cells.slice(1)] };
      return { ...t, rows: [newRow, ...t.rows.slice(1)] };
    });
    const story: Story = { ...body, blocks: changed };
    const edited: PackageModel = { ...model, stories: new Map(model.stories).set(bodyId, story) };
    expect(() => documentXml(edited)).toThrow(/fail closed/);
  });
});
