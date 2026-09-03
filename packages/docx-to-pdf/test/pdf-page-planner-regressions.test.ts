/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import type { ParagraphFragmentRecord } from '@docx-editor.dev/core/layout';
import { planPdfPaintFromLayout } from '../src/pdf-page-planner.ts';
import { layout, page, paragraph, span } from './pdf-page-planner-fixtures.ts';

describe('planPdfPaintFromLayout regressions', () => {
  test('skips hard page breaks and other control-only spans without text commands', () => {
    const pageBreak = paragraph(
      'break',
      '\f',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 0, height: 11 },
      { baseline: 9.5 }
    );
    const tab = paragraph(
      'tab',
      '\t',
      { x: 0, y: 20, width: 468, height: 14 },
      { x: 36, y: 20, width: 0, height: 11 },
      { baseline: 9.5 }
    );
    const newline = paragraph(
      'newline',
      '\n',
      { x: 0, y: 40, width: 468, height: 14 },
      { x: 0, y: 40, width: 0, height: 11 },
      { baseline: 9.5 }
    );
    const visible = paragraph(
      'visible',
      'After break',
      { x: 0, y: 60, width: 468, height: 14 },
      { x: 0, y: 60, width: 60, height: 11 },
      { baseline: 9.5 }
    );

    expect(() =>
      planPdfPaintFromLayout(
        layout([page(0, 612, 792, { fragments: [pageBreak, tab, newline, visible] })])
      )
    ).not.toThrow();

    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [pageBreak, tab, newline, visible] })])
    );
    const texts = result.plan.commands
      .filter((command) => command.kind === 'textSpan')
      .map((command) => (command.kind === 'textSpan' ? command.text : ''));
    expect(texts).toEqual(['After break']);
  });

  test('preserves external links only when span geometry is paintable', () => {
    const linkedBreak = paragraph(
      'linked-break',
      '\f',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 0, height: 11 },
      {
        link: Object.freeze({
          id: 'link-break',
          kind: 'external',
          href: 'https://example.com/break',
        }),
      }
    );
    const linkedText = paragraph(
      'linked-text',
      'Visit',
      { x: 0, y: 20, width: 468, height: 14 },
      { x: 0, y: 20, width: 30, height: 11 },
      {
        link: Object.freeze({
          id: 'link-text',
          kind: 'external',
          href: 'https://example.com/visit',
        }),
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [linkedBreak, linkedText] })])
    );

    const links = result.plan.commands.filter((command) => command.kind === 'link');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      target: { kind: 'external', href: 'https://example.com/visit' },
    });
  });

  test('paints numbered and bullet list markers inside table cells', () => {
    const itemStyle = span('cell-list', 'Cell item', { x: 18, y: 0, width: 40, height: 11 }).style;
    const numberedCell = paragraph(
      'cell-list',
      'Cell item',
      { x: 0, y: 0, width: 80, height: 14 },
      { x: 18, y: 0, width: 40, height: 11 },
      {
        marker: Object.freeze({
          text: '1.',
          style: itemStyle,
          box: Object.freeze({ x: 0, y: 2, width: 14, height: 11 }),
          level: 0,
          numId: '1',
          numFmt: 'decimal',
          ordinal: 1,
        }) as ParagraphFragmentRecord['marker'],
      }
    );
    const bulletStyle = span('cell-bullet', 'Bullet item', {
      x: 18,
      y: 0,
      width: 50,
      height: 11,
    }).style;
    const bulletCell = paragraph(
      'cell-bullet',
      'Bullet item',
      { x: 0, y: 20, width: 80, height: 14 },
      { x: 18, y: 20, width: 50, height: 11 },
      {
        marker: Object.freeze({
          text: '\u2022',
          style: bulletStyle,
          box: Object.freeze({ x: 0, y: 22, width: 8, height: 11 }),
          level: 0,
          numId: '2',
          numFmt: 'bullet',
        }) as ParagraphFragmentRecord['marker'],
      }
    );
    const table = Object.freeze({
      kind: 'table',
      id: 'tbl-markers',
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
              blocks: Object.freeze([numberedCell]),
              box: Object.freeze({ x: 0, y: 0, width: 100, height: 20 }),
            }),
            Object.freeze({
              id: 'tc-2',
              gridColumn: 1,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: Object.freeze([bulletCell]),
              box: Object.freeze({ x: 100, y: 0, width: 100, height: 20 }),
            }),
          ]),
          box: Object.freeze({ x: 0, y: 0, width: 200, height: 40 }),
        }),
      ]),
      box: Object.freeze({ x: 0, y: 0, width: 200, height: 40 }),
    });

    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [table as never] })])
    );
    const markerTexts = result.plan.commands
      .filter((command) => command.kind === 'textSpan')
      .map((command) => (command.kind === 'textSpan' ? command.text : ''))
      .filter((text) => text === '1.' || text === '\u2022');
    expect(markerTexts.sort()).toEqual(['1.', '\u2022']);
    expect(
      result.plan.commands.some(
        (command) => command.kind === 'textSpan' && command.text === 'Cell item'
      )
    ).toBe(true);
    expect(
      result.plan.commands.some(
        (command) => command.kind === 'textSpan' && command.text === 'Bullet item'
      )
    ).toBe(true);
  });

  test('records paragraph-level unsupported features inside table cells', () => {
    const shadedCell = Object.freeze({
      ...paragraph(
        'cell-shaded',
        'Shaded',
        { x: 0, y: 0, width: 80, height: 14 },
        { x: 0, y: 0, width: 40, height: 11 },
        { fragmentBox: { x: 0, y: 0, width: 80, height: 14 } }
      ),
      shading: 'EEEEEE',
    }) as ParagraphFragmentRecord;
    const drawingCell = paragraph(
      'cell-draw',
      'Drawn',
      { x: 0, y: 20, width: 80, height: 14 },
      { x: 0, y: 20, width: 30, height: 11 },
      {
        drawings: Object.freeze([
          Object.freeze({
            paragraphId: 'cell-draw',
            start: 0,
            advanceStart: 0,
            advanceEnd: 24,
            baselineOffset: 11,
          }),
        ]),
      }
    );
    const table = Object.freeze({
      kind: 'table',
      id: 'tbl-diag',
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
              blocks: Object.freeze([shadedCell, drawingCell]),
              box: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
            }),
          ]),
          box: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
        }),
      ]),
      box: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
    });

    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [table as never] })])
    );
    const features = result.diagnostics.map((entry) => entry.feature).sort();
    expect(features).toEqual(['drawing', 'paragraph-shading', 'table']);
  });
});
