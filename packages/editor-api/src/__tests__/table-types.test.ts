/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expectTypeOf, test } from 'bun:test';
import type { Table as BrowserTable, TableCell as BrowserCell } from '../browser.ts';
import type { Table, TableCell, TableRowCollection, Range, InsertLocation } from '../index.ts';

test('table editing has matching public server/browser types and Office-shaped call signatures', () => {
  expectTypeOf<BrowserTable>().toEqualTypeOf<Table>();
  expectTypeOf<BrowserCell>().toEqualTypeOf<TableCell>();
  expectTypeOf<Range['insertTable']>().toEqualTypeOf<
    (
      rowCount: number,
      columnCount: number,
      insertLocation: InsertLocation.before | InsertLocation.after | 'Before' | 'After',
      values?: string[][]
    ) => Table
  >();
  expectTypeOf<Table['addRows']>().toEqualTypeOf<
    (
      insertLocation: InsertLocation.start | InsertLocation.end | 'Start' | 'End',
      rowCount: number,
      values?: string[][]
    ) => TableRowCollection
  >();
  expectTypeOf<Table['addColumns']>().toEqualTypeOf<
    (
      insertLocation: InsertLocation.start | InsertLocation.end | 'Start' | 'End',
      columnCount: number,
      values?: string[][]
    ) => void
  >();
  expectTypeOf<Table['deleteRows']>().toEqualTypeOf<
    (rowIndex: number, rowCount?: number) => void
  >();
  expectTypeOf<Table['deleteColumns']>().toEqualTypeOf<
    (columnIndex: number, columnCount?: number) => void
  >();
  expectTypeOf<Table['values']>().toEqualTypeOf<string[][]>();
  expectTypeOf<TableCell['value']>().toEqualTypeOf<string>();
  expectTypeOf<TableCell['columnWidth']>().toEqualTypeOf<number>();
});
