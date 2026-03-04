import { describe, expect, test } from 'bun:test';
import type { Paragraph, Table, TableCell, TableRow } from '../../types/document';
import { parseTable } from '../tableParser';
import { serializeTable } from '../serializer/tableSerializer';
import { parseXmlDocument, type XmlElement } from '../xmlParser';
import {
  detectTableCellPropertyChanges,
  detectTablePropertyChanges,
  detectTableRowPropertyChanges,
  withTableCellStructuralChange,
  withTableRowStructuralChange,
} from './tableChanges';
import { createRevisionIdAllocator } from './revisionIds';

function paragraphWithText(text: string): Paragraph {
  return {
    type: 'paragraph',
    content: [{ type: 'run', content: [{ type: 'text', text }] }],
  };
}

function createCell(formatting?: TableCell['formatting']): TableCell {
  return {
    type: 'tableCell',
    ...(formatting ? { formatting } : {}),
    content: [paragraphWithText('Cell')],
  };
}

function createRow(
  formatting?: TableRow['formatting'],
  cells: TableCell[] = [createCell()]
): TableRow {
  return {
    type: 'tableRow',
    ...(formatting ? { formatting } : {}),
    cells,
  };
}

function createTable(formatting?: Table['formatting'], rows: TableRow[] = [createRow()]): Table {
  return {
    type: 'table',
    ...(formatting ? { formatting } : {}),
    rows,
  };
}

describe('tableChanges revision helpers', () => {
  test('detects table/row/cell property changes', () => {
    const allocator = createRevisionIdAllocator(200);

    const tableChanges = detectTablePropertyChanges(
      createTable({ layout: 'autofit' }),
      createTable({ layout: 'fixed' }),
      {
        allocator,
        metadata: { author: 'Reviewer', date: '2026-02-22T14:00:00Z' },
        rsid: '00AA00AA',
      }
    );
    const rowChanges = detectTableRowPropertyChanges(
      createRow({ justification: 'left' }),
      createRow({ justification: 'center' }),
      {
        allocator,
        metadata: { author: 'Reviewer', date: '2026-02-22T14:00:00Z' },
        rsid: '00BB00BB',
      }
    );
    const cellChanges = detectTableCellPropertyChanges(
      createCell({ verticalAlign: 'top' }),
      createCell({ verticalAlign: 'bottom' }),
      {
        allocator,
        metadata: { author: 'Reviewer', date: '2026-02-22T14:00:00Z' },
        rsid: '00CC00CC',
      }
    );

    expect(tableChanges?.[0].info.id).toBe(200);
    expect(rowChanges?.[0].info.id).toBe(201);
    expect(cellChanges?.[0].info.id).toBe(202);
    expect(tableChanges?.[0].info.rsid).toBe('00AA00AA');
    expect(rowChanges?.[0].info.rsid).toBe('00BB00BB');
    expect(cellChanges?.[0].info.rsid).toBe('00CC00CC');
  });

  test('applies row and cell structural metadata wrappers', () => {
    const allocator = createRevisionIdAllocator(300);
    const row = withTableRowStructuralChange(createRow(), 'tableRowInsertion', {
      allocator,
      metadata: { author: 'Reviewer', date: '2026-02-22T15:00:00Z' },
    });
    const cell = withTableCellStructuralChange(createCell(), 'tableCellMerge', {
      allocator,
      metadata: { author: 'Reviewer', date: '2026-02-22T15:00:00Z' },
    });

    expect(row.structuralChange?.type).toBe('tableRowInsertion');
    expect(cell.structuralChange?.type).toBe('tableCellMerge');
    expect(row.structuralChange?.info.id).toBe(300);
    expect(cell.structuralChange?.info.id).toBe(301);
  });
});

describe('tableChanges parser/serializer round trip', () => {
  test('round-trips table property and structural tracked changes through OOXML', () => {
    const table: Table = {
      type: 'table',
      formatting: { layout: 'fixed' },
      propertyChanges: [
        {
          type: 'tablePropertyChange',
          info: {
            id: 11,
            author: 'Reviewer',
            date: '2026-02-22T16:00:00Z',
            rsid: '00111111',
          },
          previousFormatting: { layout: 'autofit' },
          currentFormatting: { layout: 'fixed' },
        },
      ],
      rows: [
        {
          type: 'tableRow',
          formatting: { justification: 'center' },
          propertyChanges: [
            {
              type: 'tableRowPropertyChange',
              info: {
                id: 12,
                author: 'Reviewer',
                date: '2026-02-22T16:01:00Z',
                rsid: '00222222',
              },
              previousFormatting: { justification: 'left' },
              currentFormatting: { justification: 'center' },
            },
          ],
          structuralChange: {
            type: 'tableRowInsertion',
            info: { id: 13, author: 'Reviewer', date: '2026-02-22T16:02:00Z' },
          },
          cells: [
            {
              type: 'tableCell',
              formatting: { verticalAlign: 'center' },
              propertyChanges: [
                {
                  type: 'tableCellPropertyChange',
                  info: {
                    id: 14,
                    author: 'Reviewer',
                    date: '2026-02-22T16:03:00Z',
                    rsid: '00333333',
                  },
                  previousFormatting: { verticalAlign: 'top' },
                  currentFormatting: { verticalAlign: 'center' },
                },
              ],
              structuralChange: {
                type: 'tableCellMerge',
                info: { id: 15, author: 'Reviewer', date: '2026-02-22T16:04:00Z' },
              },
              content: [paragraphWithText('Tracked cell')],
            },
          ],
        },
      ],
    };

    const xml = serializeTable(table);
    expect(xml).toContain('<w:tblPrChange w:id="11" w:author="Reviewer"');
    expect(xml).toContain('<w:trPrChange w:id="12" w:author="Reviewer"');
    expect(xml).toContain('<w:tcPrChange w:id="14" w:author="Reviewer"');
    expect(xml).toContain('<w:ins w:id="13" w:author="Reviewer"');
    expect(xml).toContain('<w:cellMerge w:id="15" w:author="Reviewer"');

    const root = parseXmlDocument(
      `<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${xml.replace(/^<w:tbl>|<\/w:tbl>$/g, '')}</w:tbl>`
    ) as XmlElement | null;
    expect(root).not.toBeNull();
    if (!root) return;

    const parsed = parseTable(root, null, null, null, null, null);

    expect(parsed.propertyChanges).toHaveLength(1);
    expect(parsed.propertyChanges?.[0].type).toBe('tablePropertyChange');
    expect(parsed.propertyChanges?.[0].info.id).toBe(11);
    expect(parsed.propertyChanges?.[0].previousFormatting?.layout).toBe('autofit');
    expect(parsed.propertyChanges?.[0].currentFormatting?.layout).toBe('fixed');

    const row = parsed.rows[0];
    expect(row.propertyChanges).toHaveLength(1);
    expect(row.propertyChanges?.[0].type).toBe('tableRowPropertyChange');
    expect(row.propertyChanges?.[0].info.id).toBe(12);
    expect(row.structuralChange?.type).toBe('tableRowInsertion');
    expect(row.structuralChange?.info.id).toBe(13);

    const cell = row.cells[0];
    expect(cell.propertyChanges).toHaveLength(1);
    expect(cell.propertyChanges?.[0].type).toBe('tableCellPropertyChange');
    expect(cell.propertyChanges?.[0].info.id).toBe(14);
    expect(cell.structuralChange?.type).toBe('tableCellMerge');
    expect(cell.structuralChange?.info.id).toBe(15);
  });
});
