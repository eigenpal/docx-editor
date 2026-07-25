import { describe, expect, test } from 'bun:test';
import type { Table } from '../src/legacy-core-compat';
import { splitTableCell } from '../src/components/ui/TableToolbar/operations';

describe('splitTableCell', () => {
  test('returns the original table when split geometry is unavailable', () => {
    const table: Table = {
      type: 'table',
      columnWidths: [1440],
      rows: [
        {
          type: 'tableRow',
          cells: [
            {
              type: 'tableCell',
              content: [],
            },
          ],
        },
      ],
    };

    const result = splitTableCell(table, 0, 0, 2, 2);

    expect(result).toBe(table);
    expect(result.rows).toHaveLength(1);
  });
});
