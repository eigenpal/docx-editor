/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import {
  MAX_STORY_DRAWING_WALK_DEPTH,
  type RevisionAttribution,
} from '@docx-editor.dev/core/layout';
import { planPdfPaintFromLayout, planPdfPaintFromLayoutAsync } from '../src/pdf-page-planner.ts';
import {
  PDF_REVISION_DELETION_COLOR,
  PDF_REVISION_INSERTION_COLOR,
} from '../src/pdf-revision-presentation.ts';
import { layout, page, paragraph, span } from './pdf-page-planner-fixtures.ts';

function revision(kind: RevisionAttribution['kind'], id: string): RevisionAttribution {
  return Object.freeze({
    kind,
    id,
    author: 'QA',
    nodeId: `n-${id}`,
  });
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
  nested?: PlannerTextboxDrawing,
  behindDocument = false
): PlannerTextboxDrawing {
  return Object.freeze({
    kind: 'anchoredDrawing',
    drawingNodeId: id,
    x: 10,
    y: 20,
    paintBounds: Object.freeze({ x: 9, y: 19, width: 12, height: 22 }),
    hitBounds: Object.freeze({ x: 10, y: 20, width: 10, height: 20 }),
    behindDocument,
    textboxStory: Object.freeze({
      contentOffset: Object.freeze({ x: 3, y: 4 }),
      fragments: Object.freeze(fragments),
      ...(nested ? { anchoredDrawings: Object.freeze([nested]) } : {}),
    }),
  });
}

function shadedParagraph(
  id: string,
  text: string,
  options: { color?: string; shading?: string; lineMode?: 'none' | 'default' } = {}
) {
  return paragraph(
    id,
    text,
    { x: 0, y: 0, width: 200, height: 14 },
    { x: 0, y: 0, width: 40, height: 11 },
    {
      shading: options.shading ?? '1B3A5C',
      shadingBox: { x: 0, y: 0, width: 200, height: 14 },
      style: { color: options.color ?? 'FFFFFF' },
      ...(options.lineMode ? { lineMode: options.lineMode } : {}),
    }
  );
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

describe('PDF planner revision and fill fidelity', () => {
  test('distinguishes all-markup insertions from deletions with Core presentation', () => {
    const inserted = paragraph(
      'ins',
      'New',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 24, height: 11 },
      { revisions: [revision('insert', '1')] }
    );
    const deleted = paragraph(
      'del',
      'Old',
      { x: 0, y: 20, width: 468, height: 14 },
      { x: 0, y: 20, width: 24, height: 11 },
      { revisions: [revision('delete', '2')] }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [inserted, deleted] })])
    );
    const texts = result.plan.commands.filter((command) => command.kind === 'textSpan');
    const insertedSpan = texts.find(
      (command) => command.kind === 'textSpan' && command.text === 'New'
    );
    const deletedSpan = texts.find(
      (command) => command.kind === 'textSpan' && command.text === 'Old'
    );
    expect(insertedSpan).toMatchObject({
      style: { decoration: 'underline', color: PDF_REVISION_INSERTION_COLOR },
    });
    expect(deletedSpan).toMatchObject({
      style: { decoration: 'strike', color: PDF_REVISION_DELETION_COLOR },
    });
    expect(result.diagnostics.some((entry) => entry.feature === 'revision-markup')).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'approximation',
        feature: 'revision-underline-style',
      })
    );
  });

  test('records comments and point review artifacts that are not painted', () => {
    const body = paragraph(
      'p1',
      'hello',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 30, height: 11 }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [body] })], {
        reviewArtifacts: Object.freeze([
          Object.freeze({
            kind: 'comment',
            id: 'c1',
            author: 'Ann',
            initials: 'A',
            text: 'Please check',
            resolved: false,
            orphaned: false,
            replyIds: Object.freeze([]),
            occurrences: Object.freeze([
              Object.freeze({
                pageIndex: 0,
                physicalPageNumber: 1,
                story: 'body',
                rootStory: 'body',
                textboxPath: Object.freeze([]),
                noteScopeId: null,
                noteAreaKind: null,
                source: Object.freeze({
                  partName: 'word/document.xml',
                  start: Object.freeze({ paragraphId: 'p1', offset: 0 }),
                  end: Object.freeze({ paragraphId: 'p1', offset: 5 }),
                }),
                geometry: Object.freeze({
                  pageContent: Object.freeze([{ x: 72, y: 72, width: 30, height: 11 }]),
                  pageStack: Object.freeze([{ x: 72, y: 72, width: 30, height: 11 }]),
                }),
              }),
            ]),
          }),
          Object.freeze({
            kind: 'tracked-change',
            id: 't1',
            change: 'insert',
            author: 'Ann',
            text: 'New',
            replacedText: '',
            nesting: 0,
            readOnly: false,
            replyIds: Object.freeze([]),
            occurrences: Object.freeze([
              Object.freeze({
                pageIndex: 0,
                physicalPageNumber: 1,
                story: 'body',
                rootStory: 'body',
                textboxPath: Object.freeze([]),
                noteScopeId: null,
                noteAreaKind: null,
                source: Object.freeze({
                  partName: 'word/document.xml',
                  start: Object.freeze({ paragraphId: 'p1', offset: 5 }),
                  end: Object.freeze({ paragraphId: 'p1', offset: 5 }),
                }),
                geometry: Object.freeze({
                  pageContent: Object.freeze([{ x: 102, y: 72, width: 0, height: 11 }]),
                  pageStack: Object.freeze([{ x: 102, y: 72, width: 0, height: 11 }]),
                }),
              }),
            ]),
          }),
        ]),
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'comment',
        recordId: 'c1',
        kind: 'unsupported',
      })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'review-artifact',
        recordId: 't1',
        reason: expect.stringContaining('Point review artifact'),
      })
    );
  });

  test('paints published paragraph shading and skips the omitted-fill diagnostic', () => {
    const shaded = paragraph(
      'shade',
      'Callout',
      { x: 0, y: 0, width: 200, height: 14 },
      { x: 0, y: 0, width: 50, height: 11 },
      {
        shading: '1B3A5C',
        shadingBox: { x: 0, y: 0, width: 200, height: 14 },
        style: { color: 'FFFFFF' },
      }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [shaded] })]));
    expect(result.plan.commands).toContainEqual(
      expect.objectContaining({
        kind: 'fillRect',
        color: '#1B3A5C',
      })
    );
    expect(result.diagnostics.some((entry) => entry.feature === 'paragraph-shading')).toBe(false);
    expect(result.diagnostics.some((entry) => entry.feature === 'unreadable-without-fill')).toBe(
      false
    );
    const fillIndex = result.plan.commands.findIndex((command) => command.kind === 'fillRect');
    const textIndex = result.plan.commands.findIndex((command) => command.kind === 'textSpan');
    expect(fillIndex).toBeGreaterThanOrEqual(0);
    expect(textIndex).toBeGreaterThan(fillIndex);
  });

  test('emits unreadable-without-fill when light text has no painted backing fill', () => {
    const light = paragraph(
      'light',
      'Ghost',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 },
      { style: { color: 'FFFFFF', shading: '111111' } }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [light] })]));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'unreadable-without-fill',
        recordId: 'light',
        kind: 'unsupported',
      })
    );
  });

  test('paints cell shading behind white cell text', () => {
    const cellText = paragraph(
      'cell',
      'Navy',
      { x: 0, y: 0, width: 80, height: 14 },
      { x: 0, y: 0, width: 30, height: 11 },
      { style: { color: 'FFFFFF' } }
    );
    const table = Object.freeze({
      kind: 'table',
      id: 'tbl-fill',
      tableId: 'tbl-root',
      fragmentIndex: 0,
      nestingDepth: 0,
      columnEdges: Object.freeze([0, 100]),
      rows: Object.freeze([
        Object.freeze({
          id: 'tr-1',
          rowIndex: 0,
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: Object.freeze([
            Object.freeze({
              id: 'tc-1',
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              shading: '1B3A5C',
              blocks: Object.freeze([cellText]),
              box: Object.freeze({ x: 0, y: 0, width: 100, height: 20 }),
            }),
          ]),
          box: Object.freeze({ x: 0, y: 0, width: 100, height: 20 }),
        }),
      ]),
      box: Object.freeze({ x: 0, y: 0, width: 100, height: 20 }),
    });
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [table as never] })])
    );
    expect(result.plan.commands).toContainEqual(
      expect.objectContaining({ kind: 'fillRect', color: '#1B3A5C' })
    );
    expect(result.diagnostics.some((entry) => entry.feature === 'unreadable-without-fill')).toBe(
      false
    );
    expect(result.diagnostics.some((entry) => entry.feature === 'table')).toBe(true);
  });

  test('reports underline variants, underline colours, and kerning thresholds', () => {
    const decorated = paragraph(
      'u',
      'Wave',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 },
      {
        style: {
          underline: Object.freeze({ variant: 'wave', color: 'FF00AA' }),
          kerningMinPt: 12,
        },
      }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [decorated] })]));
    expect(result.diagnostics.map((entry) => entry.feature).sort()).toEqual([
      'kerning',
      'underline-color',
      'underline-variant',
    ]);
  });

  test('async planner observes abort scheduled after planning starts', async () => {
    const controller = new AbortController();
    const pending = planPdfPaintFromLayoutAsync(layout([page(0, 612, 792)]), {
      signal: controller.signal,
    });
    setImmediate(() => {
      controller.abort('cancel-during-planning');
    });
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportResourceError);
    expect(error).toMatchObject({ code: 'aborted', cause: 'cancel-during-planning' });
  });

  test('does not collect every span visit before the first span yield', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'pdf-page-planner.ts'), 'utf8');
    expect(source).toContain('iterateSemanticPaintHosts');
    expect(source).toContain('iterateSemanticFillHostSpans');
    expect(source).toContain('iterateSemanticParagraphOrder');
    expect(source).toContain('function* recordReviewArtifactDiagnostics');
    expect(source).toContain('function* appendNamedDestinations');
    expect(source).toMatch(/appendParagraphMarkerCommands[\s\S]*yield;/);
    expect(source).toMatch(
      /function\* appendPaintHostLayer\([\s\S]*?\): Generator<void> \{\n  yield;/
    );
    expect(source).toMatch(/layerVisits % PLANNER_ABORT_BATCH_SIZE === 0[\s\S]*yield;/);
    expect(source).toMatch(/function\* visitPageUnsupported/);
    expect(source).toMatch(/function\* visitBlocksForUnsupported/);
    expect(source).toContain('yield* drainBatched(planPageDiagnostics');
    expect(source).toContain('yield* visitPageUnsupported(page, diagnostics)');
    expect(source).toContain('yield* visitBlocksForPublishedBorders');
    expect(source).not.toMatch(/SemanticSpanVisit\[\]/);
    expect(source).not.toMatch(/visits\.push/);
    expect(source).toMatch(/setTimeout\(resolve, 0\)/);
    expect(source).not.toMatch(/setImmediate\(/);
    expect(source).not.toMatch(/everyStoryOrder\(/);
  });

  test('timer abort cancels during one-page span planning', async () => {
    const spanBatch = 256;
    const spanCount = spanBatch * 3;
    const manySpans = layout([
      page(0, 612, 792, {
        fragments: Array.from({ length: spanCount }, (_, index) =>
          paragraph(
            `p${index}`,
            `S${index}`,
            { x: 0, y: index * 12, width: 40, height: 12 },
            { x: 0, y: index * 12, width: 20, height: 10 }
          )
        ),
      }),
    ]);
    const oneSpan = layout([
      page(0, 612, 792, {
        fragments: [
          paragraph(
            'p0',
            'S0',
            { x: 0, y: 0, width: 40, height: 12 },
            { x: 0, y: 0, width: 20, height: 10 }
          ),
        ],
      }),
    ]);
    const finished = await planPdfPaintFromLayoutAsync(manySpans);
    expect(finished.plan.commands.filter((command) => command.kind === 'textSpan')).toHaveLength(
      spanCount
    );

    const fewResult = await planThenAbortAfterTimers(oneSpan, 'cancel-during-spans');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manySpans, 'cancel-during-spans');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-spans' });
  });

  test('paints textbox paragraph shading before textbox text', () => {
    const boxed = shadedParagraph('box', 'Callout');
    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [],
          contentBox: { x: 50, y: 160, width: 500, height: 680 },
          anchoredDrawings: [textboxDrawing('tb-1', [boxed]) as never],
        }),
      ])
    );
    const fill = result.plan.commands.find((command) => command.kind === 'fillRect');
    const text = result.plan.commands.find((command) => command.kind === 'textSpan');
    expect(fill).toMatchObject({ kind: 'fillRect', color: '#1B3A5C' });
    expect(fill).toMatchObject({ rect: { x: 63 } });
    expect(text).toMatchObject({ kind: 'textSpan', text: 'Callout' });
    const fillIndex = result.plan.commands.findIndex((command) => command.kind === 'fillRect');
    const textIndex = result.plan.commands.findIndex((command) => command.kind === 'textSpan');
    expect(textIndex).toBeGreaterThan(fillIndex);
    expect(result.diagnostics.some((entry) => entry.feature === 'unreadable-without-fill')).toBe(
      false
    );
  });

  test('paints overlapping body text before foreground textbox shading', () => {
    const body = paragraph(
      'body',
      'Body',
      { x: 0, y: 20, width: 200, height: 14 },
      { x: 0, y: 20, width: 40, height: 11 }
    );
    const boxed = shadedParagraph('box', 'Callout');
    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [body],
          contentBox: { x: 50, y: 160, width: 500, height: 680 },
          anchoredDrawings: [textboxDrawing('tb-front', [boxed]) as never],
        }),
      ])
    );
    const bodyText = result.plan.commands.findIndex(
      (command) => command.kind === 'textSpan' && command.text === 'Body'
    );
    const boxFill = result.plan.commands.findIndex((command) => command.kind === 'fillRect');
    const boxText = result.plan.commands.findIndex(
      (command) => command.kind === 'textSpan' && command.text === 'Callout'
    );
    expect(bodyText).toBeGreaterThanOrEqual(0);
    expect(boxFill).toBeGreaterThan(bodyText);
    expect(boxText).toBeGreaterThan(boxFill);
    expect(result.plan.commands.filter((command) => command.kind === 'fillRect')).toHaveLength(1);
    expect(
      result.plan.commands.filter(
        (command) => command.kind === 'textSpan' && command.text === 'Body'
      )
    ).toHaveLength(1);
    expect(
      result.plan.commands.filter(
        (command) => command.kind === 'textSpan' && command.text === 'Callout'
      )
    ).toHaveLength(1);
  });

  test('paints overlapping behind-document textbox shading before body text', () => {
    const body = paragraph(
      'body',
      'Body',
      { x: 0, y: 20, width: 200, height: 14 },
      { x: 0, y: 20, width: 40, height: 11 }
    );
    const boxed = shadedParagraph('box', 'Watermark');
    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [body],
          contentBox: { x: 50, y: 160, width: 500, height: 680 },
          anchoredDrawings: [textboxDrawing('tb-behind', [boxed], undefined, true) as never],
        }),
      ])
    );
    const bodyText = result.plan.commands.findIndex(
      (command) => command.kind === 'textSpan' && command.text === 'Body'
    );
    const boxFill = result.plan.commands.findIndex((command) => command.kind === 'fillRect');
    const boxText = result.plan.commands.findIndex(
      (command) => command.kind === 'textSpan' && command.text === 'Watermark'
    );
    expect(boxFill).toBeGreaterThanOrEqual(0);
    expect(boxText).toBeGreaterThan(boxFill);
    expect(bodyText).toBeGreaterThan(boxText);
    expect(result.plan.commands.filter((command) => command.kind === 'fillRect')).toHaveLength(1);
    expect(
      result.plan.commands.filter(
        (command) => command.kind === 'textSpan' && command.text === 'Body'
      )
    ).toHaveLength(1);
  });

  test('paints table-cell shading inside a textbox behind white cell text', () => {
    const cellText = paragraph(
      'cell',
      'Navy',
      { x: 0, y: 0, width: 80, height: 14 },
      { x: 0, y: 0, width: 30, height: 11 },
      { style: { color: 'FFFFFF' } }
    );
    const table = Object.freeze({
      kind: 'table',
      id: 'tbl-box',
      tableId: 'tbl-box-root',
      fragmentIndex: 0,
      nestingDepth: 0,
      columnEdges: Object.freeze([0, 100]),
      rows: Object.freeze([
        Object.freeze({
          id: 'tr-box',
          rowIndex: 0,
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: Object.freeze([
            Object.freeze({
              id: 'tc-box',
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              shading: '1B3A5C',
              blocks: Object.freeze([cellText]),
              box: Object.freeze({ x: 4, y: 6, width: 100, height: 20 }),
            }),
          ]),
          box: Object.freeze({ x: 4, y: 6, width: 100, height: 20 }),
        }),
      ]),
      box: Object.freeze({ x: 4, y: 6, width: 100, height: 20 }),
    });
    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [],
          contentBox: { x: 50, y: 160, width: 500, height: 680 },
          anchoredDrawings: [textboxDrawing('tb-table', [table]) as never],
        }),
      ])
    );
    expect(result.plan.commands).toContainEqual(
      expect.objectContaining({
        kind: 'fillRect',
        color: '#1B3A5C',
        rect: expect.objectContaining({ x: 67 }),
      })
    );
    const fillIndex = result.plan.commands.findIndex((command) => command.kind === 'fillRect');
    const textIndex = result.plan.commands.findIndex((command) => command.kind === 'textSpan');
    expect(textIndex).toBeGreaterThan(fillIndex);
    expect(result.diagnostics.some((entry) => entry.feature === 'unreadable-without-fill')).toBe(
      false
    );
  });

  test('records unreadable-without-fill for light textbox text with no painted backing', () => {
    const light = paragraph(
      'ghost',
      'Ghost',
      { x: 0, y: 0, width: 80, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 },
      { style: { color: 'FFFFFF', shading: '111111' } }
    );
    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [],
          anchoredDrawings: [textboxDrawing('tb-light', [light]) as never],
        }),
      ])
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'unreadable-without-fill',
        recordId: 'ghost',
        story: 'textbox',
        kind: 'unsupported',
      })
    );
  });

  test('stops nested textbox fills at the published walk ceiling', () => {
    let nested: PlannerTextboxDrawing | undefined;
    for (let depth = MAX_STORY_DRAWING_WALK_DEPTH + 1; depth >= 1; depth -= 1) {
      nested = textboxDrawing(`tb-${depth}`, [shadedParagraph(`p-${depth}`, `T${depth}`)], nested);
    }
    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [],
          anchoredDrawings: [nested as never],
        }),
      ])
    );
    const fills = result.plan.commands.filter((command) => command.kind === 'fillRect');
    const texts = result.plan.commands.filter((command) => command.kind === 'textSpan');
    expect(fills).toHaveLength(MAX_STORY_DRAWING_WALK_DEPTH);
    expect(texts).toHaveLength(MAX_STORY_DRAWING_WALK_DEPTH);
    expect(
      texts.some(
        (command) =>
          command.kind === 'textSpan' && command.text === `T${MAX_STORY_DRAWING_WALK_DEPTH + 1}`
      )
    ).toBe(false);
  });

  test('timer abort cancels during one-page duplicate-line paragraph-order preparation', async () => {
    const orderBatch = 256;
    const lineCount = orderBatch * 4;
    const duplicateLines = (count: number) =>
      Object.freeze({
        kind: 'paragraph',
        id: 'dup:f0',
        paragraphId: 'dup',
        fragmentIndex: 0,
        lines: Object.freeze(
          Array.from({ length: count }, (_, index) =>
            Object.freeze({
              id: `dup:line-${index}`,
              range: Object.freeze({ paragraphId: 'dup', start: 0, end: 0 }),
              spans: Object.freeze([]),
              box: Object.freeze({ x: 0, y: index, width: 10, height: 1 }),
              contentX: 0,
              baseline: 1,
              leading: 0,
            })
          )
        ),
        box: Object.freeze({ x: 0, y: 0, width: 10, height: count }),
      }) as never;
    const manyOrder = layout([page(0, 612, 792, { fragments: [duplicateLines(lineCount)] })]);
    const fewOrder = layout([page(0, 612, 792, { fragments: [duplicateLines(1)] })]);
    const finished = await planPdfPaintFromLayoutAsync(fewOrder);
    expect(finished.pageCount).toBe(1);

    const fewResult = await planThenAbortAfterTimers(fewOrder, 'cancel-during-dup-order');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyOrder, 'cancel-during-dup-order');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-dup-order' });
  });

  test('timer abort cancels during one-page paragraph-order preparation', async () => {
    const orderBatch = 256;
    const paragraphCount = orderBatch * 4;
    const manyOrder = layout([
      page(0, 612, 792, {
        fragments: [
          Object.freeze({
            kind: 'paragraph',
            id: 'host:f0',
            paragraphId: 'host',
            fragmentIndex: 0,
            lines: Object.freeze(
              Array.from({ length: paragraphCount }, (_, index) =>
                Object.freeze({
                  id: `p${index}:line`,
                  range: Object.freeze({ paragraphId: `p${index}`, start: 0, end: 0 }),
                  spans: Object.freeze([]),
                  box: Object.freeze({ x: 0, y: index, width: 10, height: 1 }),
                  contentX: 0,
                  baseline: 1,
                  leading: 0,
                })
              )
            ),
            box: Object.freeze({ x: 0, y: 0, width: 10, height: paragraphCount }),
          }) as never,
        ],
      }),
    ]);
    const fewOrder = layout([
      page(0, 612, 792, {
        fragments: [
          Object.freeze({
            kind: 'paragraph',
            id: 'host:f0',
            paragraphId: 'host',
            fragmentIndex: 0,
            lines: Object.freeze([
              Object.freeze({
                id: 'p0:line',
                range: Object.freeze({ paragraphId: 'p0', start: 0, end: 0 }),
                spans: Object.freeze([]),
                box: Object.freeze({ x: 0, y: 0, width: 10, height: 1 }),
                contentX: 0,
                baseline: 1,
                leading: 0,
              }),
            ]),
            box: Object.freeze({ x: 0, y: 0, width: 10, height: 1 }),
          }) as never,
        ],
      }),
    ]);
    const finished = await planPdfPaintFromLayoutAsync(fewOrder);
    expect(finished.pageCount).toBe(1);

    const fewResult = await planThenAbortAfterTimers(fewOrder, 'cancel-during-order');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyOrder, 'cancel-during-order');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-order' });
  });

  test('timer abort cancels during one-page fill traversal', async () => {
    const fillBatch = 256;
    const fillCount = fillBatch * 4;
    const manyFills = layout([
      page(0, 612, 792, {
        fragments: Array.from({ length: fillCount }, (_, index) =>
          shadedParagraph(`p${index}`, '', { lineMode: 'none' })
        ),
      }),
    ]);
    const oneFill = layout([
      page(0, 612, 792, {
        fragments: [shadedParagraph('p0', '', { lineMode: 'none' })],
      }),
    ]);
    const finished = await planPdfPaintFromLayoutAsync(oneFill);
    expect(finished.plan.commands.filter((command) => command.kind === 'fillRect')).toHaveLength(1);

    const fewResult = await planThenAbortAfterTimers(oneFill, 'cancel-during-fills');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyFills, 'cancel-during-fills');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-fills' });
  });

  test('timer abort cancels during one-page named-destination planning', async () => {
    const destBatch = 256;
    const destCount = destBatch * 4;
    const destination = (name: string) =>
      Object.freeze({
        anchor: Object.freeze({ name, paragraphId: 'p0', offset: 0 }),
        pageIndex: 0,
        pageContent: Object.freeze({ x: 0, y: 0, height: 12 }),
        pageStack: Object.freeze({ x: 72, y: 72 }),
      });
    const emptyPage = page(0, 612, 792);
    const manyDestinations = layout([emptyPage], {
      destinations: Object.freeze(
        Array.from({ length: destCount }, (_, index) => destination(`d${index}`))
      ),
    });
    const oneDestination = layout([emptyPage], {
      destinations: Object.freeze([destination('d0')]),
    });
    const finished = await planPdfPaintFromLayoutAsync(oneDestination);
    expect(finished.plan.commands.filter((command) => command.kind === 'destination')).toHaveLength(
      1
    );

    const fewResult = await planThenAbortAfterTimers(oneDestination, 'cancel-during-destinations');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(
      manyDestinations,
      'cancel-during-destinations'
    );
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-destinations' });
  });

  test('timer abort cancels during one-page list-marker traversal', async () => {
    const markerBatch = 256;
    const markerCount = markerBatch * 4;
    const markerStyle = span('m', '', { x: 0, y: 0, width: 14, height: 11 }).style;
    const marked = (id: string) =>
      paragraph(
        id,
        '',
        { x: 0, y: 0, width: 40, height: 12 },
        { x: 0, y: 0, width: 14, height: 11 },
        {
          lineMode: 'none',
          marker: Object.freeze({
            text: '1.',
            style: markerStyle,
            box: Object.freeze({ x: 0, y: 0, width: 14, height: 11 }),
            level: 0,
            numId: '1',
            numFmt: 'decimal',
            ordinal: 1,
          }),
        }
      );
    const manyMarkers = layout([
      page(0, 612, 792, {
        fragments: Array.from({ length: markerCount }, (_, index) => marked(`p${index}`)),
      }),
    ]);
    const oneMarker = layout([page(0, 612, 792, { fragments: [marked('p0')] })]);
    const finished = await planPdfPaintFromLayoutAsync(oneMarker);
    expect(
      finished.plan.commands.filter(
        (command) => command.kind === 'textSpan' && command.text === '1.'
      )
    ).toHaveLength(1);

    const fewResult = await planThenAbortAfterTimers(oneMarker, 'cancel-during-markers');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyMarkers, 'cancel-during-markers');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-markers' });
  });

  test('timer abort cancels during one-page review-artifact diagnostics', async () => {
    const reviewBatch = 256;
    const reviewCount = reviewBatch * 4;
    const comment = (id: string) =>
      Object.freeze({
        kind: 'comment' as const,
        id,
        author: 'Ann',
        initials: 'A',
        text: 'Note',
        resolved: false,
        orphaned: false,
        replyIds: Object.freeze([]),
        occurrences: Object.freeze([
          Object.freeze({
            pageIndex: 0,
            physicalPageNumber: 1,
            story: 'body' as const,
            rootStory: 'body' as const,
            textboxPath: Object.freeze([]),
            noteScopeId: null,
            noteAreaKind: null,
            source: Object.freeze({
              partName: 'word/document.xml',
              start: Object.freeze({ paragraphId: 'p0', offset: 0 }),
              end: Object.freeze({ paragraphId: 'p0', offset: 1 }),
            }),
            geometry: Object.freeze({
              pageContent: Object.freeze([{ x: 72, y: 72, width: 10, height: 11 }]),
              pageStack: Object.freeze([{ x: 72, y: 72, width: 10, height: 11 }]),
            }),
          }),
        ]),
      });
    const emptyPage = page(0, 612, 792);
    const manyReview = layout([emptyPage], {
      reviewArtifacts: Object.freeze(
        Array.from({ length: reviewCount }, (_, index) => comment(`c${index}`))
      ),
    });
    const oneReview = layout([emptyPage], {
      reviewArtifacts: Object.freeze([comment('c0')]),
    });
    const finished = await planPdfPaintFromLayoutAsync(oneReview);
    expect(finished.diagnostics.some((entry) => entry.feature === 'comment')).toBe(true);

    const fewResult = await planThenAbortAfterTimers(oneReview, 'cancel-during-review');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyReview, 'cancel-during-review');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-review' });
  });

  test('timer abort cancels during many empty and skipped paint hosts', async () => {
    const hostBatch = 256;
    const hostCount = hostBatch * 4;
    const emptyNote = (kind: 'footnote' | 'endnote', index: number) =>
      Object.freeze({
        noteKind: kind,
        noteId: index,
        scopeId: `${kind}:${index}`,
        mark: null,
        box: Object.freeze({ x: 0, y: 0, width: 10, height: 1 }),
        fragments: Object.freeze([]),
      });
    const noteArea = (kind: 'footnotes' | 'endnotes', count: number) =>
      Object.freeze({
        kind,
        placement: kind === 'footnotes' ? 'pageBottom' : 'docEnd',
        box: Object.freeze({ x: 0, y: 0, width: 10, height: 1 }),
        notes: Object.freeze(
          Array.from({ length: count }, (_, index) =>
            emptyNote(kind === 'footnotes' ? 'footnote' : 'endnote', index)
          )
        ),
      });
    const body = paragraph(
      'p0',
      'Hello',
      { x: 0, y: 0, width: 40, height: 12 },
      { x: 0, y: 0, width: 20, height: 10 }
    );
    const withHosts = (count: number) =>
      layout([
        page(0, 612, 792, {
          fragments: [body],
          anchoredDrawings: Array.from({ length: count }, (_, index) =>
            textboxDrawing(`tb-${index}`, [])
          ) as never,
          footnotes: noteArea('footnotes', count) as never,
          endnotes: noteArea('endnotes', count) as never,
        }),
      ]);
    const bodyOnly = layout([page(0, 612, 792, { fragments: [body] })]);
    const manyHosts = withHosts(hostCount);
    const fewHosts = withHosts(1);
    expect(planPdfPaintFromLayout(manyHosts).plan.commands).toEqual(
      planPdfPaintFromLayout(bodyOnly).plan.commands
    );

    const fewResult = await planThenAbortAfterTimers(fewHosts, 'cancel-during-hosts');
    expect(fewResult).toMatchObject({ pageCount: 1 });

    const manyError = await planThenAbortAfterTimers(manyHosts, 'cancel-during-hosts');
    expect(manyError).toBeInstanceOf(ExportResourceError);
    expect(manyError).toMatchObject({ code: 'aborted', cause: 'cancel-during-hosts' });
  });

  test('synchronous planner remains available and still sees a pre-aborted signal', () => {
    const controller = new AbortController();
    controller.abort('already-stopped');
    expect(() =>
      planPdfPaintFromLayout(layout([page(0, 612, 792)]), { signal: controller.signal })
    ).toThrow(ExportResourceError);
  });
});
