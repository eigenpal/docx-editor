// Structural table parse + lossless re-emit (fidelity slice 1, task 2.7). This is a
// READ-ONLY semantic table projection with verbatim fragment reuse: unedited table
// documents re-serialize with a byte-identical document.xml part (NOT full-ZIP
// identity — recompression can change container bytes, so we assert the XML part).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseDocx } from '../src/package/docx/read.ts';
import { documentXml } from '../src/package/docx/write.ts';
import { DocumentStore, ORIGIN_IDS, bodyStoryId, type TableRecord, type ParagraphRecord, type PackageModel, type Story, type Block } from '../src/index.ts';
import { authoredStateDigest } from '../src/package/authored-digest.ts';

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

describe('theme-relative cell shading is modeled (so the content hash distinguishes it)', () => {
  function tableWithShd(shd: string): PackageModel {
    const inner = `<w:tbl><w:tr><w:tc><w:tcPr>${shd}</w:tcPr><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const r = parseDocx(docx(inner));
    if (!r.ok) throw new Error('parse failed');
    return r.model;
  }
  test('two tables differing ONLY by w:themeFill get different authored-state digests', () => {
    const a = tableWithShd('<w:shd w:val="clear" w:themeFill="accent1"/>');
    const b = tableWithShd('<w:shd w:val="clear" w:themeFill="accent2"/>');
    expect(authoredStateDigest(a)).not.toBe(authoredStateDigest(b));
    // A matching theme fill still hashes equal (the field is modeled, not ignored wholesale).
    const a2 = tableWithShd('<w:shd w:val="clear" w:themeFill="accent1"/>');
    expect(authoredStateDigest(a)).toBe(authoredStateDigest(a2));
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

  test('editing a fully-captured top-level paragraph patches it; table stays verbatim', () => {
    const parsed = parseDocx(bytes());
    if (!parsed.ok) throw new Error('parse failed');
    const store = new DocumentStore(parsed.model);
    const bodyId = bodyStoryId(store.currentModel);
    const para = store.currentModel.stories.get(bodyId)!.blocks.find((b) => b.kind === 'paragraph') as ParagraphRecord;
    // Selective preservation: an edit to a fully-captured top-level paragraph regenerates
    // ONLY that paragraph in place; the table and every other byte stay verbatim.
    store.transact(ORIGIN_IDS.mutationHuman, (ctx) => ctx.apply({ op: 'setParagraphRuns', paragraphId: para.id, runs: [{ text: 'EDITED' }] }));
    const out = documentXml(store.currentModel);
    expect(out).toContain('EDITED');
    expect(out).toContain('<w:tbl>'); // the table survives untouched
  });

  test('a structural op on a table document fails closed on serialize (table not regenerable)', () => {
    const parsed = parseDocx(bytes());
    if (!parsed.ok) throw new Error('parse failed');
    const store = new DocumentStore(parsed.model);
    // A structural body edit would regenerate the block region, but this document's body
    // holds a table (not a fully-captured paragraph) — so it fails closed.
    store.transact(ORIGIN_IDS.mutationHuman, (ctx) => ctx.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) }));
    expect(() => documentXml(store.currentModel)).toThrow(/fail closed/);
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

  test('a table wrapped in w:customXml is preserved (descended, not silently lost)', () => {
    const inner =
      '<w:customXml w:element="Foo"><w:customXmlPr/>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>wrapped</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:customXml>';
    const { model, orig, out } = roundTrip(docx(inner));
    // The table is projected as a structural block AND the document round-trips verbatim.
    expect(bodyBlocks(model).filter((b) => b.kind === 'table')).toHaveLength(1);
    expect(out).toBe(orig);
  });

  test('a table in an unsupported wrapper fails closed (never silently dropped)', () => {
    // w:foreign is not a known block wrapper; the deep-table safety net rejects it.
    const inner = '<w:foreign><w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:foreign>';
    const r = parseDocx(docx(inner));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('xml-error');
  });

  test('a reachable table PLUS a hidden-wrapper table fails closed (count invariant)', () => {
    const inner =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>reachable</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:foreign><w:tbl><w:tr><w:tc><w:p><w:r><w:t>hidden</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:foreign>';
    const r = parseDocx(docx(inner)); // one table activates preservation; the hidden one must not slip through
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('xml-error');
  });

  test('a descendant-re-prefixed WordprocessingML table (t:tbl) fails closed', () => {
    // The w: namespace URI is re-bound to prefix `t` on a descendant, not the root.
    const xml =
      `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:r><w:t>p</w:t></w:r></w:p>` +
      `<t:tbl xmlns:t="${W}"><t:tr><t:tc><t:p><t:r><t:t>x</t:t></t:r></t:p></t:tc></t:tr></t:tbl>` +
      `</w:body></w:document>`;
    const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) });
    const r = parseDocx(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('xml-error');
  });

  test('sdt-wrapped rows and cell content inside a table are projected (not empty)', () => {
    const inner =
      '<w:tbl>' +
      '<w:sdt><w:sdtContent>' + // an sdt wrapping the row
      '<w:tr><w:tc>' +
      '<w:sdt><w:sdtContent><w:p><w:r><w:t>wrapped-cell</w:t></w:r></w:p></w:sdtContent></w:sdt>' + // sdt wrapping cell content
      '</w:tc></w:tr>' +
      '</w:sdtContent></w:sdt>' +
      '</w:tbl>';
    const { model, orig, out } = roundTrip(docx(inner));
    const t = bodyBlocks(model).find((b) => b.kind === 'table') as TableRecord;
    expect(t.rows).toHaveLength(1); // the sdt-wrapped row is projected
    expect(cellText(t, 0, 0)).toBe('wrapped-cell'); // the sdt-wrapped cell content is projected
    expect(out).toBe(orig);
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

  // Edit cell [0,0] of the (only) table, keeping table id/order and everything else.
  function editFirstCell(model: PackageModel, text: string): PackageModel {
    const bodyId = bodyStoryId(model);
    const body = model.stories.get(bodyId)!;
    const changed: Block[] = body.blocks.map((b) => {
      if (b.kind !== 'table') return b;
      const t = b as TableRecord;
      const c00 = t.rows[0].cells[0];
      const newCell = { ...c00, blocks: [{ kind: 'paragraph' as const, id: (c00.blocks[0] as ParagraphRecord).id, runs: [{ text }] }] };
      const newRow = { ...t.rows[0], cells: [newCell, ...t.rows[0].cells.slice(1)] };
      return { ...t, rows: [newRow, ...t.rows.slice(1)] };
    });
    return { ...model, stories: new Map(model.stories).set(bodyId, { ...body, blocks: changed }) };
  }

  test('editing a simple cell paragraph serializes the edit and reopens; the rest stays verbatim', () => {
    const parsed = parseDocx(bytes());
    if (!parsed.ok) throw new Error('parse failed');
    const orig = strFromU8(unzipSync(bytes())['word/document.xml']);
    const out = documentXml(editFirstCell(parsed.model, 'EDITED'));

    expect(out).toContain('EDITED'); // the edit is serialized
    expect(out).not.toContain('>A1<'); // the old cell text was replaced
    // Only the edited cell changed — every other cell + the surrounding text is verbatim.
    for (const kept of ['B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3', 'Document with tables', 'End of document']) {
      expect(out).toContain(kept);
    }
    // Reopen: the edited cell reads back as "EDITED", structure intact (3x3).
    const re = parseDocx(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(out) }));
    expect(re.ok).toBe(true);
    if (re.ok) {
      const t = re.model.stories.get(bodyStoryId(re.model))!.blocks.find((b) => b.kind === 'table') as TableRecord;
      expect(t.rows).toHaveLength(3);
      expect(cellText(t, 0, 0)).toBe('EDITED');
      expect(cellText(t, 1, 1)).toBe('B2');
    }
  });

  test('a table-cell edit changes the authored-state digest and survives a reopen digest-equal', () => {
    const parsed = parseDocx(bytes());
    if (!parsed.ok) throw new Error('parse failed');
    const edited = editFirstCell(parsed.model, 'EDITED');
    // The edit changes authored state, so the digest MUST differ from the unedited model (the old
    // baseline-slice digest would have collapsed them to equal).
    expect(authoredStateDigest(edited)).not.toBe(authoredStateDigest(parsed.model));
    // And the edit round-trips: save -> reopen -> the reopened model digests the same as the edit.
    const out = documentXml(edited);
    const re = parseDocx(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(out) }));
    if (!re.ok) throw new Error('reopen failed');
    expect(authoredStateDigest(re.model)).toBe(authoredStateDigest(edited));
  });

  test('a structural table change (adding a row) still fails closed', () => {
    const parsed = parseDocx(bytes());
    if (!parsed.ok) throw new Error('parse failed');
    const bodyId = bodyStoryId(parsed.model);
    const body = parsed.model.stories.get(bodyId)!;
    const changed: Block[] = body.blocks.map((b) => {
      if (b.kind !== 'table') return b;
      const t = b as TableRecord;
      return { ...t, rows: [...t.rows, t.rows[0]] }; // duplicate the first row -> structural change
    });
    const edited: PackageModel = { ...parsed.model, stories: new Map(parsed.model.stories).set(bodyId, { ...body, blocks: changed }) };
    expect(() => documentXml(edited)).toThrow(/fail closed/);
  });
});

describe('cell-edit fails closed on non-fully-captured paragraphs (review findings 1-3)', () => {
  function tableWithCell00(cell00: string): PackageModel {
    const inner = `<w:tbl><w:tr><w:tc>${cell00}</w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const r = parseDocx(docx(inner));
    if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
    return r.model;
  }
  function editCell00(model: PackageModel, text: string): PackageModel {
    const bid = bodyStoryId(model);
    const body = model.stories.get(bid)!;
    const blocks = body.blocks.map((b) => {
      if (b.kind !== 'table') return b;
      const t = b as TableRecord;
      const c00 = t.rows[0].cells[0];
      const p = c00.blocks[0] as ParagraphRecord;
      const nc = { ...c00, blocks: [{ ...p, runs: [{ text }] }] };
      return { ...t, rows: [{ ...t.rows[0], cells: [nc, ...t.rows[0].cells.slice(1)] }, ...t.rows.slice(1)] };
    });
    return { ...model, stories: new Map(model.stories).set(bid, { ...body, blocks }) };
  }

  test('editing a cell whose original has a w:tab fails closed (would flatten the tab)', () => {
    const m = tableWithCell00('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>c</w:t></w:r></w:p>');
    expect(() => documentXml(editCell00(m, 'EDITED'))).toThrow(/fail closed/);
  });
  test('editing a cell with explicit-off bold fails closed (would flip it to enabled)', () => {
    const m = tableWithCell00('<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>a</w:t></w:r></w:p>');
    expect(() => documentXml(editCell00(m, 'EDITED'))).toThrow(/fail closed/);
  });
  test('editing a cell containing an empty run fails closed (would drop it)', () => {
    const m = tableWithCell00('<w:p><w:r/><w:r><w:t>a</w:t></w:r></w:p>');
    expect(() => documentXml(editCell00(m, 'EDITED'))).toThrow(/fail closed/);
  });
  test('editing a cell whose run has multiple w:t fails closed (segmentation collapses)', () => {
    const m = tableWithCell00('<w:p><w:r><w:t>a</w:t><w:t>b</w:t></w:r></w:p>');
    expect(() => documentXml(editCell00(m, 'EDITED'))).toThrow(/fail closed/);
  });
  test('editing a cell whose original carries a comment/PI fails closed (readXml drops it)', () => {
    // readXml strips comments/PIs, so paragraphFullyCaptured on the parsed node would MISS them;
    // the raw-slice guard must reject so regeneration never silently deletes the comment.
    expect(() => documentXml(editCell00(tableWithCell00('<w:p><!--keep--><w:r><w:t>a</w:t></w:r></w:p>'), 'EDITED'))).toThrow(
      /fail closed/,
    );
    expect(() => documentXml(editCell00(tableWithCell00('<w:p><?pi x?><w:r><w:t>a</w:t></w:r></w:p>'), 'EDITED'))).toThrow(
      /fail closed/,
    );
  });
});
