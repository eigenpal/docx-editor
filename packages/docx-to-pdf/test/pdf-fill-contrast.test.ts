/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import type { BlockFragmentRecord, PageRecord } from '@docx-editor.dev/core/layout';
import {
  createPdfFillBacking,
  paintedFillForParagraph,
  visitBlocksForPublishedFills,
} from '../src/pdf-fill-contrast.ts';
import type { PdfPaintCommand } from '../src/pdf-paint-types.ts';
import { planPdfPaintFromLayout, planPdfPaintFromLayoutAsync } from '../src/pdf-page-planner.ts';
import { layout, page, paragraph } from './pdf-page-planner-fixtures.ts';

const NEST_DEPTH = 9;
const OUTER_FILL = '1B3A5C';
const INNER_FILL = '990000';
const PARA_FILL = '007700';

function whiteParagraph(
  id: string,
  extras: {
    shading?: string;
    shadingBox?: { x: number; y: number; width: number; height: number };
    lineMode?: 'none' | 'default';
  } = {}
) {
  return paragraph(
    id,
    'Hi',
    { x: 0, y: 0, width: 80, height: 14 },
    { x: 0, y: 0, width: 30, height: 11 },
    {
      style: { color: 'FFFFFF' },
      ...extras,
    }
  );
}

function cell(id: string, blocks: readonly unknown[], shading?: string): unknown {
  return Object.freeze({
    id,
    gridColumn: 0,
    gridSpan: 1,
    vMergeContinue: false,
    ...(shading ? { shading } : {}),
    blocks: Object.freeze(blocks),
    box: Object.freeze({ x: 0, y: 0, width: 100, height: 20 }),
  });
}

function table(id: string, cells: readonly unknown[]): unknown {
  return Object.freeze({
    kind: 'table',
    id,
    tableId: `${id}-root`,
    fragmentIndex: 0,
    nestingDepth: 0,
    columnEdges: Object.freeze([0, 100]),
    rows: Object.freeze([
      Object.freeze({
        id: `${id}-r0`,
        rowIndex: 0,
        isHeaderRow: false,
        isHeaderRepeat: false,
        cells: Object.freeze(cells),
        box: Object.freeze({ x: 0, y: 0, width: 100, height: 20 }),
      }),
    ]),
    box: Object.freeze({ x: 0, y: 0, width: 100, height: 20 }),
  });
}

function nestedUnshaded(depth: number, id: string): unknown {
  if (depth <= 0) return whiteParagraph(id, { lineMode: 'none' });
  return table(id, [
    cell(`${id}0`, [nestedUnshaded(depth - 1, `${id}0`)]),
    cell(`${id}1`, [nestedUnshaded(depth - 1, `${id}1`)]),
  ]);
}

function collectFillBacking(blocks: readonly unknown[]): ReturnType<typeof createPdfFillBacking> {
  const backing = createPdfFillBacking();
  const commands: PdfPaintCommand[] = [];
  for (const _ of visitBlocksForPublishedFills(
    { index: 0 } as PageRecord,
    { x: 0, y: 0 },
    blocks as readonly BlockFragmentRecord[],
    'body',
    backing,
    (box) => box,
    (command) => {
      commands.push(command);
    },
    { push() {} }
  )) {
    /* Drain the bounded fill walk. */
  }
  return backing;
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

describe('PDF fill contrast backing', () => {
  test('does not scan a shaded cell subtree before the fill generator yields', () => {
    const leafCount = 32;
    const shaded = table('root', [
      cell(
        'c',
        Array.from({ length: leafCount }, (_, index) => whiteParagraph(`p${index}`)),
        OUTER_FILL
      ),
    ]);
    const backing = createPdfFillBacking();
    const commands: PdfPaintCommand[] = [];
    const walk = visitBlocksForPublishedFills(
      { index: 0 } as PageRecord,
      { x: 0, y: 0 },
      [shaded as BlockFragmentRecord],
      'body',
      backing,
      (box) => box,
      (command) => {
        commands.push(command);
      },
      { push() {} }
    );
    let sawFill = false;
    for (;;) {
      const step = walk.next();
      expect(step.done).toBe(false);
      if (commands.some((command) => command.kind === 'fillRect')) {
        sawFill = true;
        expect(backing.cellFill.size).toBe(0);
        break;
      }
    }
    expect(sawFill).toBe(true);
    for (const _ of walk) {
      /* Finish recording descendant ids. */
    }
    expect(backing.cellFill.size).toBe(leafCount);
  });

  test('nested cell fill overrides outer fill and paragraph fill wins', () => {
    const blocks = [
      table('outer', [
        cell(
          'outer-c',
          [
            whiteParagraph('outer-p'),
            table('inner-shaded', [cell('inner-c', [whiteParagraph('inner-p')], INNER_FILL)]),
            table('inner-plain', [cell('plain-c', [whiteParagraph('inherit-p')])]),
            whiteParagraph('para-p', {
              shading: PARA_FILL,
              shadingBox: { x: 0, y: 0, width: 80, height: 14 },
            }),
          ],
          OUTER_FILL
        ),
      ]),
    ];
    const backing = collectFillBacking(blocks);
    expect(paintedFillForParagraph(backing, 'outer-p')).toBe(`#${OUTER_FILL}`);
    expect(paintedFillForParagraph(backing, 'inner-p')).toBe(`#${INNER_FILL}`);
    expect(paintedFillForParagraph(backing, 'inherit-p')).toBe(`#${OUTER_FILL}`);
    expect(paintedFillForParagraph(backing, 'para-p')).toBe(`#${PARA_FILL}`);

    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: blocks as never })])
    );
    const fills = result.plan.commands
      .filter((command) => command.kind === 'fillRect')
      .map((command) => (command.kind === 'fillRect' ? command.color : ''));
    expect(fills).toEqual([`#${OUTER_FILL}`, `#${INNER_FILL}`, `#${PARA_FILL}`]);
    expect(result.diagnostics.some((entry) => entry.feature === 'unreadable-without-fill')).toBe(
      false
    );
  });

  test('does not keep recordParagraphIds in the fill walk', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'pdf-fill-contrast.ts'), 'utf8');
    expect(source).not.toContain('recordParagraphIds');
    expect(source).toContain('inheritedCellFill');
  });

  test('timer abort cancels during one-page nested shaded-cell fill traversal', async () => {
    const manyNested = layout([
      page(0, 612, 792, {
        fragments: [
          table('root', [cell('c', [nestedUnshaded(NEST_DEPTH, 'n')], OUTER_FILL)]) as never,
        ],
      }),
    ]);
    const fewNested = layout([
      page(0, 612, 792, {
        fragments: [
          table('root', [
            cell('c', [whiteParagraph('p0', { lineMode: 'none' })], OUTER_FILL),
          ]) as never,
        ],
      }),
    ]);
    const finished = await planPdfPaintFromLayoutAsync(fewNested);
    expect(finished.plan.commands.some((command) => command.kind === 'fillRect')).toBe(true);
    expect(finished.diagnostics.some((entry) => entry.feature === 'unreadable-without-fill')).toBe(
      false
    );

    const fewResult = await planThenAbortAfterTimers(fewNested, 'cancel-during-nested-fill');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyNested, 'cancel-during-nested-fill');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-nested-fill' });
  });
});
