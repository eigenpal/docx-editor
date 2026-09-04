/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import { planPdfPaintFromLayout, planPdfPaintFromLayoutAsync } from '../src/pdf-page-planner.ts';
import { layout, page, paragraph } from './pdf-page-planner-fixtures.ts';

const NEST_DEPTH = 9;

function emptyCell(id: string, blocks: readonly unknown[] = []): unknown {
  return Object.freeze({
    id,
    gridColumn: 0,
    gridSpan: 1,
    vMergeContinue: false,
    blocks: Object.freeze(blocks),
    box: Object.freeze({ x: 0, y: 0, width: 40, height: 12 }),
  });
}

function nestedTables(depth: number, id: string): unknown {
  if (depth <= 0) {
    return Object.freeze({
      kind: 'table',
      id,
      tableId: `${id}-root`,
      fragmentIndex: 0,
      nestingDepth: 0,
      columnEdges: Object.freeze([0, 40]),
      rows: Object.freeze([
        Object.freeze({
          id: `${id}-r0`,
          rowIndex: 0,
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: Object.freeze([emptyCell(`${id}-c0`), emptyCell(`${id}-c1`)]),
          box: Object.freeze({ x: 0, y: 0, width: 40, height: 12 }),
        }),
      ]),
      box: Object.freeze({ x: 0, y: 0, width: 40, height: 12 }),
    });
  }
  return Object.freeze({
    kind: 'table',
    id,
    tableId: `${id}-root`,
    fragmentIndex: 0,
    nestingDepth: 0,
    columnEdges: Object.freeze([0, 40]),
    rows: Object.freeze([
      Object.freeze({
        id: `${id}-r0`,
        rowIndex: 0,
        isHeaderRow: false,
        isHeaderRepeat: false,
        cells: Object.freeze([
          emptyCell(`${id}-c0`, [nestedTables(depth - 1, `${id}0`)]),
          emptyCell(`${id}-c1`, [nestedTables(depth - 1, `${id}1`)]),
        ]),
        box: Object.freeze({ x: 0, y: 0, width: 40, height: 12 }),
      }),
    ]),
    box: Object.freeze({ x: 0, y: 0, width: 40, height: 12 }),
  });
}

async function planThenAbortAfterTimers(
  document: ReturnType<typeof layout>,
  cause: string
): Promise<unknown> {
  const controller = new AbortController();
  const pending = planPdfPaintFromLayoutAsync(document, { signal: controller.signal });
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  controller.abort(cause);
  return pending.catch((caught: unknown) => caught);
}

describe('PDF planner nested unsupported cancellation', () => {
  test('keeps nested table diagnostic order on a one-page tree', () => {
    const inner = nestedTables(0, 'inner');
    const outer = Object.freeze({
      kind: 'table',
      id: 'outer',
      tableId: 'outer-root',
      fragmentIndex: 0,
      nestingDepth: 0,
      columnEdges: Object.freeze([0, 40]),
      rows: Object.freeze([
        Object.freeze({
          id: 'outer-r0',
          rowIndex: 0,
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: Object.freeze([
            emptyCell('outer-c0', [
              inner,
              paragraph(
                'body',
                'Hi',
                { x: 0, y: 0, width: 20, height: 12 },
                { x: 0, y: 0, width: 10, height: 10 }
              ),
            ]),
          ]),
          box: Object.freeze({ x: 0, y: 0, width: 40, height: 12 }),
        }),
      ]),
      box: Object.freeze({ x: 0, y: 0, width: 40, height: 12 }),
    });
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [outer as never] })])
    );
    expect(
      result.diagnostics.filter((entry) => entry.feature === 'table').map((entry) => entry.recordId)
    ).toEqual(['outer', 'inner']);
  });

  test('timer abort cancels during one-page nested unsupported traversal', async () => {
    const manyNested = layout([
      page(0, 612, 792, { fragments: [nestedTables(NEST_DEPTH, 'n') as never] }),
    ]);
    const fewNested = layout([page(0, 612, 792, { fragments: [nestedTables(0, 'n') as never] })]);
    const finished = await planPdfPaintFromLayoutAsync(fewNested);
    expect(finished.diagnostics.some((entry) => entry.feature === 'table')).toBe(true);
    expect(planPdfPaintFromLayout(fewNested).diagnostics).toEqual(finished.diagnostics);

    const fewResult = await planThenAbortAfterTimers(fewNested, 'cancel-during-nested-unsupported');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(
      manyNested,
      'cancel-during-nested-unsupported'
    );
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({
      code: 'aborted',
      cause: 'cancel-during-nested-unsupported',
    });
  });
});
