/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  PageRecord,
  ParagraphBorderStrokeRecord,
  ParagraphFragmentRecord,
} from '@docx-editor.dev/core/layout';
import { coreBoxToPdfRect } from '../src/pdf-coordinates.ts';
import type { PdfPaintCommand } from '../src/pdf-paint-types.ts';
import { planPdfPaintFromLayout, planPdfPaintFromLayoutAsync } from '../src/pdf-page-planner.ts';
import { visitBlocksForPublishedBorders } from '../src/pdf-paragraph-borders.ts';
import { layout, page, paragraph } from './pdf-page-planner-fixtures.ts';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_ORIGIN = Object.freeze({ x: 72, y: 72 });
const NEST_DEPTH = 9;

const SINGLE_AUTO = Object.freeze({
  val: 'single',
  color: null,
  widthPt: 0.5,
  spacePt: 1,
});

function stroke(
  side: ParagraphBorderStrokeRecord['side'],
  box: { x: number; y: number; width: number; height: number },
  edge: ParagraphBorderStrokeRecord['edge'] = SINGLE_AUTO
): ParagraphBorderStrokeRecord {
  return Object.freeze({
    side,
    edge: Object.freeze({ ...edge }),
    box: Object.freeze(box),
  });
}

function expectedFill(
  box: { x: number; y: number; width: number; height: number },
  origin: { x: number; y: number } = CONTENT_ORIGIN
) {
  return {
    kind: 'fillRect' as const,
    color: '#000000',
    rect: coreBoxToPdfRect(
      {
        x: origin.x + box.x,
        y: origin.y + box.y,
        width: box.width,
        height: box.height,
      },
      PAGE_HEIGHT
    ),
  };
}

function fillRects(commands: readonly PdfPaintCommand[]) {
  return commands.filter((command) => command.kind === 'fillRect');
}

function cell(
  id: string,
  blocks: readonly unknown[],
  box = { x: 40, y: 12, width: 100, height: 24 }
) {
  return Object.freeze({
    id,
    gridColumn: 0,
    gridSpan: 1,
    vMergeContinue: false,
    blocks: Object.freeze(blocks),
    box: Object.freeze(box),
  });
}

function table(id: string, cells: readonly unknown[]) {
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
        box: Object.freeze({ x: 0, y: 0, width: 100, height: 24 }),
      }),
    ]),
    box: Object.freeze({ x: 0, y: 0, width: 100, height: 24 }),
  });
}

function nestedBordered(depth: number, id: string): unknown {
  if (depth <= 0) {
    return paragraph(
      id,
      '',
      { x: 0, y: 0, width: 20, height: 8 },
      { x: 0, y: 0, width: 10, height: 8 },
      {
        lineMode: 'none',
        borders: [stroke('bottom', { x: 0, y: 8, width: 20, height: 0.5 })],
      }
    );
  }
  return table(id, [
    cell(`${id}0`, [nestedBordered(depth - 1, `${id}0`)]),
    cell(`${id}1`, [nestedBordered(depth - 1, `${id}1`)]),
  ]);
}

type PlannerTextboxDrawing = {
  readonly kind: 'anchoredDrawing';
  readonly drawingNodeId: string;
  readonly x: number;
  readonly y: number;
  readonly paintBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly hitBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly behindDocument: boolean;
  readonly textboxStory: {
    readonly contentOffset: Readonly<{ x: number; y: number }>;
    readonly fragments: readonly unknown[];
    readonly anchoredDrawings?: readonly PlannerTextboxDrawing[];
  };
};

function textboxDrawing(
  id: string,
  fragments: readonly unknown[],
  nested?: PlannerTextboxDrawing
): PlannerTextboxDrawing {
  return Object.freeze({
    kind: 'anchoredDrawing',
    drawingNodeId: id,
    x: 10,
    y: 20,
    paintBounds: Object.freeze({ x: 9, y: 19, width: 12, height: 22 }),
    hitBounds: Object.freeze({ x: 10, y: 20, width: 10, height: 20 }),
    behindDocument: false,
    textboxStory: Object.freeze({
      contentOffset: Object.freeze({ x: 3, y: 4 }),
      fragments: Object.freeze(fragments),
      ...(nested ? { anchoredDrawings: Object.freeze([nested]) } : {}),
    }),
  });
}

function furnitureStory(
  kind: 'header' | 'footer',
  box: { x: number; y: number; width: number; height: number },
  fragment: ParagraphFragmentRecord
): HeaderFooterStoryRecord {
  return Object.freeze({
    kind,
    variant: 'default',
    partName: `${kind}1.xml`,
    box: Object.freeze(box),
    fragments: Object.freeze([fragment]),
  }) as HeaderFooterStoryRecord;
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

describe('PDF paragraph border paint', () => {
  test('paints the EP_ZMVZ_MULTI_v4 page-1 subtitle bottom rule from the published box', () => {
    const bottomBox = { x: 0, y: 30.2727, width: 415.65, height: 0.5 };
    const subtitle = paragraph(
      'subtitle',
      'spolocnosti',
      { x: 0, y: 15.2727, width: 415.65, height: 14 },
      { x: 30.825, y: 15.2727, width: 72, height: 14 },
      {
        fragmentBox: { x: 0, y: 15.2727, width: 415.65, height: 15.5 },
        borders: [stroke('bottom', bottomBox)],
        bottomBorder: Object.freeze({ edge: SINGLE_AUTO, box: Object.freeze(bottomBox) }),
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, PAGE_WIDTH, PAGE_HEIGHT, { fragments: [subtitle] })])
    );
    expect(fillRects(result.plan.commands)).toEqual([expectedFill(bottomBox)]);
    expect(result.diagnostics.some((entry) => entry.feature === 'paragraph-border')).toBe(false);
    const fillIndex = result.plan.commands.findIndex((command) => command.kind === 'fillRect');
    const textIndex = result.plan.commands.findIndex((command) => command.kind === 'textSpan');
    expect(textIndex).toBeGreaterThan(fillIndex);
  });

  test('paints the EP_ZMVZ_MULTI_v4 page-1 three-paragraph box without a duplicate closing edge', () => {
    const top = { x: -4.5, y: 603.5, width: 424.65, height: 0.5 };
    const firstLeft = { x: -4.5, y: 603.5, width: 0.5, height: 15.5 };
    const firstRight = { x: 419.65, y: 603.5, width: 0.5, height: 15.5 };
    const midLeft = { x: -4.5, y: 619, width: 0.5, height: 14 };
    const midRight = { x: 419.65, y: 619, width: 0.5, height: 14 };
    const bottom = { x: -4.5, y: 662, width: 424.65, height: 0.5 };
    const lastLeft = { x: -4.5, y: 633, width: 0.5, height: 29.5 };
    const lastRight = { x: 419.65, y: 633, width: 0.5, height: 29.5 };
    const sideEdge = Object.freeze({ val: 'single', color: null, widthPt: 0.5, spacePt: 4 });
    const first = paragraph(
      'box-top',
      'Uznesenie',
      { x: 0, y: 605, width: 415.65, height: 14 },
      { x: 99.825, y: 605, width: 60, height: 14 },
      {
        fragmentBox: { x: 0, y: 603.5, width: 415.65, height: 15.5 },
        borders: [
          stroke('top', top),
          stroke('left', firstLeft, sideEdge),
          stroke('right', firstRight, sideEdge),
        ],
      }
    );
    const middle = paragraph(
      'box-mid',
      '',
      { x: 0, y: 619, width: 415.65, height: 14 },
      { x: 0, y: 619, width: 10, height: 11 },
      {
        fragmentBox: { x: 0, y: 619, width: 415.65, height: 14 },
        lineMode: 'empty',
        borders: [stroke('left', midLeft, sideEdge), stroke('right', midRight, sideEdge)],
      }
    );
    const last = paragraph(
      'box-bottom',
      'Resolution',
      { x: 0, y: 633, width: 415.65, height: 28 },
      { x: 0, y: 633, width: 80, height: 14 },
      {
        fragmentBox: { x: 0, y: 633, width: 415.65, height: 29.5 },
        borders: [
          stroke('bottom', bottom),
          stroke('left', lastLeft, sideEdge),
          stroke('right', lastRight, sideEdge),
        ],
        bottomBorder: Object.freeze({ edge: SINGLE_AUTO, box: Object.freeze(bottom) }),
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, PAGE_WIDTH, PAGE_HEIGHT, { fragments: [first, middle, last] })])
    );
    const fills = fillRects(result.plan.commands);
    expect(fills).toEqual([
      expectedFill(top),
      expectedFill(firstLeft),
      expectedFill(firstRight),
      expectedFill(midLeft),
      expectedFill(midRight),
      expectedFill(bottom),
      expectedFill(lastLeft),
      expectedFill(lastRight),
    ]);
    const closing = expectedFill(bottom).rect;
    expect(
      fills.filter(
        (command) =>
          command.rect.x === closing.x &&
          command.rect.y === closing.y &&
          command.rect.width === closing.width &&
          command.rect.height === closing.height
      )
    ).toHaveLength(1);
    expect(result.diagnostics.some((entry) => entry.feature === 'paragraph-border')).toBe(false);
  });

  test('uses nested cell story origin and the published edge box, not paragraph bounds', () => {
    const edge = { x: -4.5, y: 8, width: 80, height: 0.5 };
    const inner = paragraph(
      'cell-border',
      'Cell',
      { x: 0, y: 0, width: 60, height: 14 },
      { x: 0, y: 0, width: 24, height: 11 },
      { borders: [stroke('bottom', edge)] }
    );
    const result = planPdfPaintFromLayout(
      layout([
        page(0, PAGE_WIDTH, PAGE_HEIGHT, {
          fragments: [table('outer', [cell('c0', [inner])]) as never],
        }),
      ])
    );
    expect(fillRects(result.plan.commands)).toEqual([expectedFill(edge)]);
    expect(result.plan.commands).not.toContainEqual(
      expectedFill({ x: 40 + edge.x, y: 12 + edge.y, width: edge.width, height: edge.height })
    );
    expect(result.plan.commands).not.toContainEqual(
      expectedFill({ x: 0, y: 0, width: 60, height: 14 })
    );
  });

  test('uses nested textbox story origin for published border boxes', () => {
    const edge = { x: 5, y: 6, width: 40, height: 0.5 };
    const boxed = paragraph(
      'tb-border',
      'Callout',
      { x: 0, y: 0, width: 80, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 },
      { borders: [stroke('bottom', edge)] }
    );
    const nested = paragraph(
      'nested-border',
      'Inner',
      { x: 0, y: 0, width: 30, height: 12 },
      { x: 0, y: 0, width: 20, height: 10 },
      { borders: [stroke('top', { x: 1, y: 2, width: 12, height: 0.5 })] }
    );
    const result = planPdfPaintFromLayout(
      layout([
        page(0, PAGE_WIDTH, PAGE_HEIGHT, {
          contentBox: { x: 50, y: 160, width: 500, height: 680 },
          fragments: [],
          anchoredDrawings: [
            textboxDrawing('tb-1', [boxed], textboxDrawing('tb-2', [nested])) as never,
          ],
        }),
      ])
    );
    const outerOrigin = { x: 50 + 10 + 3, y: 160 + 20 + 4 };
    const innerOrigin = { x: outerOrigin.x + 10 + 3, y: outerOrigin.y + 20 + 4 };
    expect(result.plan.commands).toContainEqual(expectedFill(edge, outerOrigin));
    expect(result.plan.commands).toContainEqual(
      expectedFill({ x: 1, y: 2, width: 12, height: 0.5 }, innerOrigin)
    );
    expect(result.diagnostics.some((entry) => entry.feature === 'paragraph-border')).toBe(false);
  });

  test('paints header and footer published borders at furniture origins', () => {
    const headerEdge = { x: 0, y: 10, width: 200, height: 0.5 };
    const footerEdge = { x: 8, y: 4, width: 120, height: 0.75 };
    const result = planPdfPaintFromLayout(
      layout([
        page(0, PAGE_WIDTH, PAGE_HEIGHT, {
          header: furnitureStory(
            'header',
            { x: 72, y: 36, width: 468, height: 36 },
            paragraph(
              'hdr',
              'Header',
              { x: 0, y: 0, width: 200, height: 14 },
              { x: 0, y: 0, width: 40, height: 11 },
              { borders: [stroke('bottom', headerEdge)] }
            )
          ),
          footer: furnitureStory(
            'footer',
            { x: 72, y: 720, width: 468, height: 36 },
            paragraph(
              'ftr',
              'Footer',
              { x: 0, y: 0, width: 120, height: 14 },
              { x: 0, y: 0, width: 40, height: 11 },
              {
                borders: [
                  stroke('top', footerEdge, {
                    val: 'single',
                    color: '112233',
                    widthPt: 0.75,
                    spacePt: 1,
                  }),
                ],
              }
            )
          ),
        }),
      ])
    );
    expect(result.plan.commands).toContainEqual(expectedFill(headerEdge, { x: 72, y: 36 }));
    expect(result.plan.commands).toContainEqual({
      ...expectedFill(footerEdge, { x: 72, y: 720 }),
      color: '#112233',
    });
  });

  test('paints shading, then border edges, then text', () => {
    const edge = { x: 0, y: 14, width: 200, height: 0.5 };
    const boxed = paragraph(
      'order',
      'Callout',
      { x: 0, y: 0, width: 200, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 },
      {
        shading: '1B3A5C',
        shadingBox: { x: 0, y: 0, width: 200, height: 14 },
        style: { color: 'FFFFFF' },
        borders: [stroke('bottom', edge)],
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, PAGE_WIDTH, PAGE_HEIGHT, { fragments: [boxed] })])
    );
    const kinds = result.plan.commands.map((command) => command.kind);
    const shadingIndex = result.plan.commands.findIndex(
      (command) => command.kind === 'fillRect' && command.color === '#1B3A5C'
    );
    const borderIndex = result.plan.commands.findIndex(
      (command) => command.kind === 'fillRect' && command.color === '#000000'
    );
    const textIndex = result.plan.commands.findIndex((command) => command.kind === 'textSpan');
    expect(shadingIndex).toBeGreaterThanOrEqual(0);
    expect(borderIndex).toBeGreaterThan(shadingIndex);
    expect(textIndex).toBeGreaterThan(borderIndex);
    expect(kinds.slice(shadingIndex, textIndex + 1)).toEqual(['fillRect', 'fillRect', 'textSpan']);
  });

  test('paints a bottomBorder fallback only when borders is absent', () => {
    const edge = { x: 2, y: 18, width: 90, height: 0.5 };
    const cellOnly = paragraph(
      'cell-bottom',
      'Rule',
      { x: 0, y: 0, width: 90, height: 14 },
      { x: 0, y: 0, width: 24, height: 11 },
      { bottomBorder: Object.freeze({ edge: SINGLE_AUTO, box: Object.freeze(edge) }) }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, PAGE_WIDTH, PAGE_HEIGHT, { fragments: [cellOnly] })])
    );
    expect(fillRects(result.plan.commands)).toEqual([expectedFill(edge)]);
    expect(result.diagnostics.some((entry) => entry.feature === 'paragraph-border')).toBe(false);
  });

  test('approximates dashed, dotted, double, and art vals and does not emit unsupported', () => {
    const dashed = paragraph(
      'dashed',
      'Dash',
      { x: 0, y: 0, width: 80, height: 14 },
      { x: 0, y: 0, width: 20, height: 11 },
      {
        borders: [
          stroke(
            'bottom',
            { x: 0, y: 14, width: 80, height: 0.5 },
            { val: 'dashed', color: '990000', widthPt: 0.5, spacePt: 1 }
          ),
        ],
      }
    );
    const dotted = paragraph(
      'dotted',
      'Dot',
      { x: 0, y: 20, width: 80, height: 14 },
      { x: 0, y: 20, width: 20, height: 11 },
      {
        borders: [
          stroke(
            'bottom',
            { x: 0, y: 34, width: 80, height: 0.5 },
            { val: 'dotted', color: null, widthPt: 0.5, spacePt: 1 }
          ),
        ],
      }
    );
    const doubled = paragraph(
      'double',
      'Double',
      { x: 0, y: 40, width: 80, height: 14 },
      { x: 0, y: 40, width: 30, height: 11 },
      {
        borders: [
          stroke(
            'top',
            { x: 0, y: 40, width: 80, height: 1.5 },
            { val: 'double', color: '003366', widthPt: 0.75, spacePt: 1 }
          ),
        ],
      }
    );
    const art = paragraph(
      'art',
      'Art',
      { x: 0, y: 60, width: 80, height: 14 },
      { x: 0, y: 60, width: 20, height: 11 },
      {
        borders: [
          stroke(
            'bottom',
            { x: 0, y: 74, width: 80, height: 1 },
            { val: 'apples', color: '006600', widthPt: 1, spacePt: 1 }
          ),
        ],
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, PAGE_WIDTH, PAGE_HEIGHT, { fragments: [dashed, dotted, doubled, art] })])
    );
    expect(fillRects(result.plan.commands)).toHaveLength(4);
    expect(
      result.diagnostics.filter(
        (entry) => entry.kind === 'unsupported' && entry.feature === 'paragraph-border'
      )
    ).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'approximation',
        feature: 'paragraph-border',
        recordId: 'dashed:f0',
        reason: expect.stringContaining('dashed'),
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'approximation',
        feature: 'paragraph-border',
        recordId: 'dotted:f0',
        reason: expect.stringContaining('dotted'),
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'approximation',
        feature: 'paragraph-border',
        recordId: 'double:f0',
        reason: expect.stringContaining('double'),
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'approximation',
        feature: 'paragraph-border',
        recordId: 'art:f0',
        reason: expect.stringContaining('apples'),
      })
    );
  });

  test('does not scan a nested bordered-cell subtree before the first yield', () => {
    const leafCount = 32;
    const nested = table('root', [
      cell(
        'c',
        Array.from({ length: leafCount }, (_, index) =>
          paragraph(
            `p${index}`,
            '',
            { x: 0, y: 0, width: 40, height: 8 },
            { x: 0, y: 0, width: 10, height: 8 },
            {
              lineMode: 'none',
              borders: [stroke('bottom', { x: 0, y: index, width: 40, height: 0.5 })],
            }
          )
        )
      ),
    ]);
    const commands: PdfPaintCommand[] = [];
    const walk = visitBlocksForPublishedBorders(
      { index: 0 } as PageRecord,
      { x: 0, y: 0 },
      [nested as BlockFragmentRecord],
      'body',
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
        break;
      }
    }
    expect(sawFill).toBe(true);
    expect(commands.filter((command) => command.kind === 'fillRect').length).toBeLessThan(
      leafCount
    );
  });

  test('timer abort cancels during one-page nested bordered-cell traversal', async () => {
    const manyNested = layout([
      page(0, PAGE_WIDTH, PAGE_HEIGHT, {
        fragments: [nestedBordered(NEST_DEPTH, 'n') as never],
      }),
    ]);
    const fewNested = layout([
      page(0, PAGE_WIDTH, PAGE_HEIGHT, {
        fragments: [table('root', [cell('c', [nestedBordered(0, 'leaf')])]) as never],
      }),
    ]);
    const finished = await planPdfPaintFromLayoutAsync(fewNested);
    expect(fillRects(finished.plan.commands)).toHaveLength(1);
    expect(finished.diagnostics.some((entry) => entry.feature === 'paragraph-border')).toBe(false);

    const fewResult = await planThenAbortAfterTimers(fewNested, 'cancel-during-nested-border');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyNested, 'cancel-during-nested-border');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({
      code: 'aborted',
      cause: 'cancel-during-nested-border',
    });
  });

  test('timer abort cancels during one-page border traversal', async () => {
    const borderBatch = 256;
    const borderCount = borderBatch * 4;
    const manyBorders = layout([
      page(0, PAGE_WIDTH, PAGE_HEIGHT, {
        fragments: Array.from({ length: borderCount }, (_, index) =>
          paragraph(
            `p${index}`,
            '',
            { x: 0, y: 0, width: 40, height: 8 },
            { x: 0, y: 0, width: 10, height: 8 },
            {
              lineMode: 'none',
              borders: [stroke('bottom', { x: 0, y: 8, width: 40, height: 0.5 })],
            }
          )
        ),
      }),
    ]);
    const oneBorder = layout([
      page(0, PAGE_WIDTH, PAGE_HEIGHT, {
        fragments: [
          paragraph(
            'p0',
            '',
            { x: 0, y: 0, width: 40, height: 8 },
            { x: 0, y: 0, width: 10, height: 8 },
            {
              lineMode: 'none',
              borders: [stroke('bottom', { x: 0, y: 8, width: 40, height: 0.5 })],
            }
          ),
        ],
      }),
    ]);
    const finished = await planPdfPaintFromLayoutAsync(oneBorder);
    expect(fillRects(finished.plan.commands)).toHaveLength(1);

    const fewResult = await planThenAbortAfterTimers(oneBorder, 'cancel-during-borders');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyBorders, 'cancel-during-borders');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-borders' });
  });
});
