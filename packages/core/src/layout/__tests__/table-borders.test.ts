// Table border three-state read, cascade, and collapsed conflict resolution.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { readTableStructure } from '../semantic-table.ts';
import {
  borderWeight,
  effectiveBorderSide,
  readBorderSide,
  resolveBorderConflict,
  resolveTableCellBorderGrid,
  type CellBorderBox,
  type TableBorderBox,
  type TableBorderSide,
} from '../table-borders.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function edge(
  style: 'single' | 'dashed' | 'dotted' | 'double' | 'triple',
  color: string | null,
  widthPt: number
): TableBorderSide {
  return { state: 'edge', style, color, widthPt };
}

const none: TableBorderSide = { state: 'none' };
const omitted: TableBorderSide = { state: 'omitted' };

function box(partial: Partial<CellBorderBox>): CellBorderBox {
  return {
    top: omitted,
    left: omitted,
    bottom: omitted,
    right: omitted,
    ...partial,
  };
}

describe('readBorderSide three-state', () => {
  test('omitted / none / edge, hostile color dropped, sz in eighths', () => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tr><w:tc><w:tcPr>
        <w:tcBorders>
          <w:top w:val="double" w:color="2E75B6" w:sz="24"/>
          <w:left w:val="none"/>
          <w:bottom w:val="single" w:color="javascript:alert(1)" w:sz="8"/>
          <w:right w:val="dashed" w:color="CC3333" w:sz="8"/>
        </w:tcBorders>
      </w:tcPr><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const body = read.part.root.children.find(
      (c) => c.kind !== 'textValue' && c.localName === 'body'
    );
    const table = body?.children.find((c) => c.kind === 'table');
    expect(table).toBeDefined();
    const structure = readTableStructure(table!, 468, 0)!;
    const borders = structure.rows[0]!.cells[0]!.borders;
    expect(borders.top).toEqual(edge('double', '2E75B6', 3));
    expect(borders.left).toEqual(none);
    expect(borders.bottom.state).toBe('edge');
    if (borders.bottom.state === 'edge') {
      expect(borders.bottom.color).toBeNull(); // hostile rejected
      expect(borders.bottom.widthPt).toBe(1);
    }
    expect(borders.right).toEqual(edge('dashed', 'CC3333', 1));
  });
});

describe('border conflict (zero cell spacing)', () => {
  test('none loses to an edge; two nones stay none', () => {
    expect(resolveBorderConflict(none, edge('single', '999999', 0.5))).toEqual(
      edge('single', '999999', 0.5)
    );
    expect(resolveBorderConflict(none, none)).toEqual(none);
  });

  test('higher weight wins; dotted/dashed weight is 1', () => {
    expect(borderWeight(edge('dotted', '339933', 12))).toBe(1);
    expect(borderWeight(edge('double', '2E75B6', 0.375))).toBeGreaterThan(1);
    const winner = resolveBorderConflict(
      edge('double', '2E75B6', 0.375),
      edge('single', null, 0.5)
    );
    expect(winner.state).toBe('edge');
    if (winner.state === 'edge') expect(winner.style).toBe('double');
  });

  test('effective cascade: cell edge wins over table; none yields to table on outer only', () => {
    const tableSingle = edge('single', null, 0.5);
    expect(effectiveBorderSide(edge('single', '999999', 0.125), tableSingle)).toEqual(
      edge('single', '999999', 0.125)
    );
    expect(effectiveBorderSide(none, tableSingle)).toEqual(tableSingle);
    expect(effectiveBorderSide(none, tableSingle, { interior: true })).toEqual(none);
    expect(effectiveBorderSide(omitted, tableSingle)).toEqual(tableSingle);
  });

  test('§5.3 mid vertical: top dashed red, bottom absent', () => {
    const table: TableBorderBox = {
      top: edge('single', null, 0.5),
      left: edge('single', null, 0.5),
      bottom: edge('single', null, 0.5),
      right: edge('single', null, 0.5),
      insideH: edge('single', null, 0.5),
      insideV: edge('single', null, 0.5),
    };
    const tl = box({
      top: edge('double', '2E75B6', 0.375),
      left: edge('double', '2E75B6', 0.375),
      bottom: edge('double', '2E75B6', 0.375),
      right: edge('dashed', 'CC3333', 0.125),
    });
    const tr = box({
      top: edge('dotted', '339933', 0.125),
      left: edge('dashed', 'CC3333', 0.125),
      bottom: edge('dotted', '339933', 0.125),
      right: edge('dotted', '339933', 0.125),
    });
    const bl = box({
      top: edge('double', '2E75B6', 0.375),
      left: edge('double', '2E75B6', 0.375),
      bottom: none,
      right: none,
    });
    const br = box({
      top: edge('dotted', '339933', 0.125),
      left: none,
      bottom: edge('triple', '9933CC', 0.375),
      right: edge('dotted', '339933', 0.125),
    });
    const grid = resolveTableCellBorderGrid(
      [
        [
          { gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: tl, mergeRowSpan: 1 },
          { gridColumn: 1, gridSpan: 1, vMergeContinue: false, borders: tr, mergeRowSpan: 1 },
        ],
        [
          { gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: bl, mergeRowSpan: 1 },
          { gridColumn: 1, gridSpan: 1, vMergeContinue: false, borders: br, mergeRowSpan: 1 },
        ],
      ],
      table,
      2
    );
    expect(grid[0]![0]!.right).toEqual({ style: 'dashed', color: 'CC3333', widthPt: 0.125 });
    expect(grid[1]![0]!.right).toBeUndefined();
    expect(grid[0]![0]!.bottom).toEqual({ style: 'double', color: '2E75B6', widthPt: 0.375 });
    expect(grid[0]![1]!.bottom).toEqual({ style: 'dotted', color: '339933', widthPt: 0.125 });
    expect(grid[1]![1]!.bottom).toEqual({ style: 'triple', color: '9933CC', widthPt: 0.375 });
    // BL bottom none → table single shows on outer edge.
    expect(grid[1]![0]!.bottom).toEqual({ style: 'single', color: null, widthPt: 0.5 });
    // Interior left of TR/BR not painted (owned by left cell).
    expect(grid[0]![1]!.left).toBeUndefined();
    expect(grid[1]![1]!.left).toBeUndefined();
  });
});

describe('readBorderSide from element', () => {
  test('bare missing node is omitted', () => {
    expect(readBorderSide(undefined)).toEqual(omitted);
  });
});
