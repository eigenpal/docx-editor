import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { caretAt } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (content: string) => `<w:p><w:r>${content}</w:r></w:p>`;
const table = (content: string) =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`;
const text = (value: string) => `<w:t>${value}</w:t>`;
const pageBreak = '<w:br w:type="page"/>';

function part(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function layout(body: string) {
  return layoutSemanticDocument(part(body), 0, { measurer: createFixedMeasurer() });
}
function cellParagraph(result: SemanticLayout) {
  const block = result.pages[0]!.fragments[0]!;
  if (block.kind !== 'table') throw new Error('Expected table');
  const p = block.rows[0]!.cells[0]!.blocks[0]!;
  if (p.kind !== 'paragraph') throw new Error('Expected paragraph');
  return p;
}

describe('manual page breaks inside table cells', () => {
  test('leading, repeated, interior, and trailing breaks retain offsets without adding lines', () => {
    const control = cellParagraph(layout(table(paragraph(text('AlphaBeta')))));
    const result = layout(
      table(paragraph(pageBreak + pageBreak + text('Alpha') + pageBreak + text('Beta') + pageBreak))
    );
    const p = cellParagraph(result);
    expect(p.lines).toHaveLength(1);
    expect(p.box.height).toBe(control.box.height);
    expect(p.lines[0]!.box.width).toBe(control.lines[0]!.box.width);
    expect(p.lines[0]!.spans.map((s) => s.text).join('')).toBe('\f\fAlpha\fBeta\f');
    for (let offset = 0; offset <= 13; offset++) {
      expect(caretAt(result, { paragraphId: p.paragraphId, offset })).not.toBeNull();
    }
  });

  test('a cell with only page breaks keeps one empty paragraph line', () => {
    const control = cellParagraph(layout(table(paragraph(''))));
    const result = layout(table(paragraph(pageBreak + pageBreak)));
    const p = cellParagraph(result);
    expect(p.lines).toHaveLength(1);
    expect(p.box.height).toBe(control.box.height);
    expect(p.lines[0]!.spans.map((span) => span.text).join('')).toBe('\f\f');
    expect(caretAt(result, { paragraphId: p.paragraphId, offset: 2 })).not.toBeNull();
  });

  test('nested cells also ignore manual page breaks', () => {
    const result = layout(
      table(table(paragraph(text('Alpha') + pageBreak + text('Beta'))) + '<w:p/>')
    );
    const outer = result.pages[0]!.fragments[0]!;
    if (outer.kind !== 'table') throw new Error('Expected table');
    const nested = outer.rows[0]!.cells[0]!.blocks[0]!;
    if (nested.kind !== 'table') throw new Error('Expected nested table');
    const p = nested.rows[0]!.cells[0]!.blocks[0]!;
    if (p.kind !== 'paragraph') throw new Error('Expected nested paragraph');
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]!.spans.map((span) => span.text).join('')).toBe('Alpha\fBeta');
  });

  test('manual line breaks still add lines inside cells', () => {
    const p = cellParagraph(layout(table(paragraph(text('Alpha') + '<w:br/>' + text('Beta')))));
    expect(p.lines).toHaveLength(2);
  });

  test('body page breaks still start a new page', () => {
    const result = layout(paragraph(text('Alpha') + pageBreak + text('Beta')));
    expect(result.pages).toHaveLength(2);
  });

  test('an edit after an ignored break keeps incremental layout equal to a clean pass', () => {
    const before = part(table(paragraph(text('Alpha') + pageBreak + text('Beta'))));
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const measurer = createFixedMeasurer();
    const initial = layoutSemanticDocument(before, 0, { cache, session, measurer });
    const paragraphId = cellParagraph(initial).paragraphId;
    const edited = applyTreeOp(before, { op: 'insertText', paragraphId, offset: 6, text: 'new ' });
    if (!edited.ok) throw new Error(edited.reason);
    const incremental = layoutSemanticDocument(edited.part, 1, { cache, session, measurer });
    const clean = layoutSemanticDocument(edited.part, 1, { measurer: createFixedMeasurer() });
    expect(JSON.parse(JSON.stringify(incremental))).toEqual(JSON.parse(JSON.stringify(clean)));
    expect(
      cellParagraph(incremental)
        .lines[0]!.spans.map((s) => s.text)
        .join('')
    ).toBe('Alpha\fnew Beta');
  });
});
