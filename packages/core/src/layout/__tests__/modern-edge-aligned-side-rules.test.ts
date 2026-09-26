import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';

// Compatibility mode 15 puts the OUTER edge of a left- or right-aligned table's side rule on
// the aligned edge. Captured `dxa` controls (0.5 to 6pt single and 3pt thick rules, 0 to
// 10.8pt margins, indents, fixed and autofit layout) centre every vertical rule on a grid
// line that sits half a rule inward, and measure each margin from the rule centre.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
interface Shape {
  readonly jc?: string;
  readonly cols?: readonly number[];
  readonly sz?: number;
  readonly outerSz?: number;
  readonly style?: string;
  readonly margin?: number;
  readonly fixed?: boolean;
  readonly extra?: string;
  readonly text?: string;
  readonly rows?: string;
  readonly widthType?: string;
}
function source(shape: Shape = {}) {
  const { cols = [2880], sz = 24, style = 'single', margin = 5.4, fixed = true } = shape;
  const outer = shape.outerSz ?? sz;
  const rule = (side: string, size: number) => `<w:${side} w:val="${style}" w:sz="${size}"/>`;
  const borders = `<w:tblBorders>${rule('top', sz)}${rule('left', outer)}${rule('bottom', sz)}${rule('right', outer)}${rule('insideH', sz)}${rule('insideV', sz)}</w:tblBorders>`;
  const width = cols.reduce((sum, col) => sum + col, 0);
  const cells = cols
    .map(
      (col, index) =>
        `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${shape.text ?? `C${index}`}</w:t></w:r></w:p></w:tc>`
    )
    .join('');
  const xml =
    `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="${shape.widthType ?? 'dxa'}"/>` +
    `${fixed ? '<w:tblLayout w:type="fixed"/>' : ''}${shape.jc ? `<w:jc w:val="${shape.jc}"/>` : ''}` +
    `${shape.extra ?? ''}${borders}<w:tblCellMar><w:left w:type="dxa" w:w="${margin * 20}"/>` +
    `<w:right w:type="dxa" w:w="${margin * 20}"/></w:tblCellMar></w:tblPr><w:tblGrid>` +
    `${cols.map((col) => `<w:gridCol w:w="${col}"/>`).join('')}</w:tblGrid>` +
    `${shape.rows ?? `<w:tr>${cells}</w:tr>`}</w:tbl>`;
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children.find((node) => node.kind === 'body')! as OoxmlElement;
  return { part: parsed.part, table: body.children[0]! as OoxmlElement };
}
function read(table: OoxmlElement, mode?: number, width = 300, depth = 0) {
  return readTableStructure(table, width, depth, undefined, 'proposed', undefined, mode)!;
}
function layout(
  part: ReturnType<typeof source>['part'],
  mode?: number,
  session = createLayoutSession(),
  width = 300
) {
  return layoutSemanticDocument(part, 0, {
    compatibilityMode: mode,
    measurer: createFixedMeasurer(6, 12),
    session,
    geometry: { width, height: 792, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
}
function firstTable(result: ReturnType<typeof layout>) {
  const fragment = result.pages[0]!.fragments[0]!;
  if (fragment.kind !== 'table') throw new Error('Expected table');
  return fragment;
}
function contentEdges(result: ReturnType<typeof layout>, cellIndex = 0) {
  const fragment = firstTable(result);
  const cell = fragment.rows[0]!.cells[cellIndex]!;
  const paragraph = cell.blocks[0]!;
  if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
  const line = paragraph.lines[0]!.box;
  const left = line.x - cell.box.x;
  return { cell, left, right: cell.box.width - left - line.width, lines: paragraph.lines.length };
}

for (const margin of [0, 5.4]) {
  for (const sz of [4, 24]) {
    const half = sz / 16;
    test(`mode 15 left dxa table moves its grid by half a ${sz / 8}pt rule at margin ${margin}`, () => {
      const { part, table } = source({ margin, sz });
      const before = serializeOoxmlPart(part);
      const structure = read(table, 15);
      expect(structure.outerRuleOffsetPt).toBe(half);
      expect(structure.rows[0]!.cells[0]!.centeredSideRules).toBe(true);
      expect(structure.rows[0]!.cells[0]!.centeredSidePaint).toBe(true);
      const result = layout(part, 15);
      expect(firstTable(result).box.x).toBe(half);
      const { cell, left, right } = contentEdges(result);
      expect(left).toBeCloseTo(Math.max(margin, half), 8);
      expect(right).toBeCloseTo(Math.max(margin, half), 8);
      const strokes = cell.borders!.strokes!;
      // The outer edge of the leading rule sits on the text column edge.
      expect(cell.box.x + strokes.find((edge) => edge.side === 'left')!.x).toBeCloseTo(0, 8);
      expect(strokes.find((edge) => edge.side === 'right')!.x).toBeCloseTo(144 - half, 8);
      expect(serializeOoxmlPart(part)).toBe(before);
    });
  }
}

test('mode 15 left table keeps its indent to the outer rule edge', () => {
  const { part } = source({ extra: '<w:tblInd w:w="360" w:type="dxa"/>' });
  expect(firstTable(layout(part, 15)).box.x).toBe(19.5);
  expect(contentEdges(layout(part, 15)).left).toBeCloseTo(5.4, 8);
});

test('thick rules, autofit layout, and an overflowing fixed left table take the same geometry', () => {
  for (const shape of [
    { style: 'thick' },
    { fixed: false },
    { jc: 'right', fixed: false },
    { cols: [6000] },
    { extra: '<w:tblInd w:w="3200" w:type="dxa"/>' },
  ] satisfies Shape[]) {
    const structure = read(source(shape).table, 15);
    expect(Math.abs(structure.outerRuleOffsetPt!)).toBe(1.5);
    expect(structure.rows[0]!.cells[0]!.centeredSideRules).toBe(true);
  }
  // A full-width fixed table keeps its outer rule edge on the margin and overflows the other.
  const full = layout(source({ cols: [6000] }).part, 15);
  expect(firstTable(full).box.x).toBe(1.5);
  expect(contentEdges(full).right).toBeCloseTo(5.4, 8);
});

test('mode 15 right dxa table moves its grid inward by half the trailing rule', () => {
  const { part, table } = source({ jc: 'right', cols: [1440, 1440] });
  expect(read(table, 15).outerRuleOffsetPt).toBe(-1.5);
  const result = layout(part, 15);
  const fragment = firstTable(result);
  expect(fragment.box.x).toBe(300 - 144 - 1.5);
  const last = fragment.rows[0]!.cells[1]!;
  const stroke = last.borders!.strokes!.find((edge) => edge.side === 'right')!;
  expect(last.box.x + stroke.x + stroke.width).toBeCloseTo(300, 8);
  for (const index of [0, 1]) {
    const edges = contentEdges(result, index);
    expect(edges.left).toBeCloseTo(5.4, 8);
    expect(edges.right).toBeCloseTo(5.4, 8);
  }
});

test('the reclaimed rule width changes where a mode 15 left table wraps', () => {
  // 24 characters of 10pt text (130.9pt) fit the 133.2pt budget, not the 130.2pt
  // full-stroke budget that mode 16 keeps.
  const { part } = source({ text: 'aaaaaaaaaaa aaaaaaaaaaaa' });
  expect(contentEdges(layout(part, 15)).lines).toBe(1);
  expect(contentEdges(layout(part, 16)).lines).toBe(2);
});

test('a vertical merge continuation does not block the shared grid line', () => {
  const merged = (vMerge: string, text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/>${vMerge}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const rows =
    `<w:tr>${merged('<w:vMerge w:val="restart"/>', 'A')}${merged('', 'B')}</w:tr>` +
    `<w:tr>${merged('<w:vMerge/>', '')}${merged('', 'C')}</w:tr>`;
  const { table } = source({ cols: [1440, 1440], rows });
  expect(read(table, 15).outerRuleOffsetPt).toBe(1.5);
});

test('mode 15 keeps the full-stroke inset and unshifted grid for shapes its controls do not cover', () => {
  const gridBefore =
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr>' +
    '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr>';
  for (const shape of [
    { style: 'double', sz: 6 },
    { cols: [1440, 1440], outerSz: 48 },
    { cols: [1440, 1440], rows: gridBefore },
    { widthType: 'auto' },
    { widthType: 'pct' },
    { jc: 'right', cols: [6000] },
    { fixed: false, cols: [5960] },
    { extra: '<w:tblCellSpacing w:w="20" w:type="dxa"/>' },
    {
      extra: '<w:tblpPr w:horzAnchor="margin" w:vertAnchor="text" w:tblpXSpec="left" w:tblpY="1"/>',
    },
    { extra: '<w:bidiVisual/>' },
  ] satisfies Shape[]) {
    const structure = read(source(shape).table, 15);
    expect(structure.outerRuleOffsetPt).toBeUndefined();
    expect(structure.rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
  }
  expect(read(source().table, 15, 300, 1).outerRuleOffsetPt).toBeUndefined();
  // An autofit table's whole outer box must fit: 144 + 3 in 147 fits, in 146.9 it does not.
  const autofit = source({ fixed: false }).table;
  expect(read(autofit, 15, 147).outerRuleOffsetPt).toBe(1.5);
  expect(read(autofit, 15, 146.9).outerRuleOffsetPt).toBeUndefined();
  const { part } = source({ jc: 'right', cols: [6000] });
  expect(firstTable(layout(part, 15)).box.x).toBe(0);
  expect(contentEdges(layout(part, 15)).left).toBeCloseTo(6.9, 8);
});

test('other modes and centred tables take no grid offset', () => {
  for (const mode of [undefined, 11, 12, 14, 16]) {
    const { part, table } = source();
    expect(read(table, mode).outerRuleOffsetPt).toBeUndefined();
    expect(firstTable(layout(part, mode)).box.x).toBe(0);
  }
  expect(read(source({ jc: 'center' }).table, 15).outerRuleOffsetPt).toBeUndefined();
  expect(firstTable(layout(source({ jc: 'center' }).part, 15)).box.x).toBe(78);
});

test('a retained session relays an edge-aligned table when the mode or width changes', () => {
  const { part, table } = source({ fixed: false });
  const session = createLayoutSession();
  for (const mode of [14, 15, 16, 15, 14])
    expect(layout(part, mode, session).pages).toEqual(layout(part, mode).pages);
  for (const width of [300, 146.9, 147, 300])
    expect(layout(part, 15, session, width).pages).toEqual(
      layout(part, 15, createLayoutSession(), width).pages
    );
  expect(firstTable(layout(part, 15, session, 146.9)).box.x).toBe(0);
  expect(read(table, 16).outerRuleOffsetPt).toBeUndefined();
  expect(read(table, 15).outerRuleOffsetPt).toBe(1.5);
});
