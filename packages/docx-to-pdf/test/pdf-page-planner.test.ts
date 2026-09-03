/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { ExportResourceError, type ExportSemanticLayout } from '@docx-editor.dev/core/export';
import type {
  HeaderFooterStoryRecord,
  PageRecord,
  ParagraphFragmentRecord,
  StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import { coreBoxToPdfRect, coreYToPdfY } from '../src/pdf-coordinates.ts';
import { HARD_MAX_PDF_PAGES, PdfPaintValidationError } from '../src/pdf-paint-bounds.ts';
import { planPdfPaintFromLayout } from '../src/pdf-page-planner.ts';
import { serializePdfPaintPlan } from '../src/pdf-paint-serialize.ts';
import { pdfTextStyleFromResolvedRunStyle } from '../src/pdf-text-style.ts';

function span(
  paragraphId: string,
  text: string,
  box: { x: number; y: number; width: number; height: number },
  style: Partial<StyleSpanRecord['style']> = {},
  link?: StyleSpanRecord['link']
): StyleSpanRecord {
  return Object.freeze({
    range: Object.freeze({ paragraphId, start: 0, end: text.length }),
    text,
    props: Object.freeze([]),
    style: Object.freeze({
      fontFamily: 'Arial',
      fontFamilyEastAsia: null,
      fontSizePt: 11,
      color: '000000',
      bold: false,
      italic: false,
      underline: null,
      strike: false,
      doubleStrike: false,
      highlight: null,
      shading: null,
      verticalAlign: 'baseline',
      baselineShiftPt: 0,
      caps: false,
      smallCaps: false,
      characterSpacingPt: 0,
      horizontalScalePercent: 100,
      kerningMinPt: 0,
      hidden: false,
      ...style,
    }),
    box: Object.freeze(box),
    ...(link ? { link } : {}),
  }) as StyleSpanRecord;
}

function paragraph(
  id: string,
  text: string,
  lineBox: { x: number; y: number; width: number; height: number },
  spanBox: { x: number; y: number; width: number; height: number },
  options: {
    style?: Partial<StyleSpanRecord['style']>;
    link?: StyleSpanRecord['link'];
    fragmentBox?: { x: number; y: number; width: number; height: number };
    baseline?: number;
    marker?: ParagraphFragmentRecord['marker'];
    equation?: { fallbackText: string };
    drawings?: readonly {
      paragraphId: string;
      start: number;
      advanceStart: number;
      advanceEnd: number;
      baselineOffset: number;
    }[];
    lineMode?: 'default' | 'empty' | 'none';
  } = {}
): ParagraphFragmentRecord {
  const styleSpan = Object.freeze({
    ...span(id, text, spanBox, options.style, options.link),
    ...(options.equation ? { equation: Object.freeze(options.equation) } : {}),
  }) as StyleSpanRecord;
  const lineMode = options.lineMode ?? 'default';
  const lines =
    lineMode === 'none'
      ? Object.freeze([])
      : Object.freeze([
          Object.freeze({
            id: `${id}:line-0`,
            range: Object.freeze({ paragraphId: id, start: 0, end: text.length }),
            spans: Object.freeze(lineMode === 'empty' ? [] : [styleSpan]),
            box: Object.freeze(lineBox),
            contentX: lineBox.x,
            baseline: options.baseline ?? 9.5,
            leading: 0,
            ...(options.drawings ? { drawings: Object.freeze(options.drawings) } : {}),
          }),
        ]);
  return Object.freeze({
    kind: 'paragraph',
    id: `${id}:f0`,
    paragraphId: id,
    fragmentIndex: 0,
    range: Object.freeze({ paragraphId: id, start: 0, end: text.length }),
    props: Object.freeze([]),
    styleId: null,
    outlineLevel: null,
    alignment: 'left',
    spacing: Object.freeze({ before: 0, after: 0 }),
    indent: Object.freeze({ left: 0, right: 0, firstLine: 0, hanging: 0 }),
    tabStops: Object.freeze({ stops: Object.freeze([]), defaultIntervalPt: 36 }),
    lines,
    box: Object.freeze(options.fragmentBox ?? lineBox),
    ...(options.marker ? { marker: options.marker } : {}),
  }) as ParagraphFragmentRecord;
}

function page(
  index: number,
  width: number,
  height: number,
  options: {
    fragments?: readonly PageRecord['fragments'][number][];
    header?: HeaderFooterStoryRecord;
    footer?: HeaderFooterStoryRecord;
    contentBox?: { x: number; y: number; width: number; height: number };
    footnotes?: PageRecord['footnotes'];
  } = {}
): PageRecord {
  const contentBox = Object.freeze(
    options.contentBox ?? { x: 72, y: 72, width: width - 144, height: height - 144 }
  );
  return Object.freeze({
    id: `page-${index}`,
    index,
    box: Object.freeze({ x: 0, y: 0, width, height }),
    contentBox,
    fragments: Object.freeze(options.fragments ?? []),
    ...(options.header ? { header: options.header } : {}),
    ...(options.footer ? { footer: options.footer } : {}),
    ...(options.footnotes ? { footnotes: options.footnotes } : {}),
  }) as PageRecord;
}

function layout(
  pages: readonly PageRecord[],
  extra: Partial<Pick<ExportSemanticLayout, 'documentMetadata' | 'destinations'>> = {}
): ExportSemanticLayout {
  return Object.freeze({
    revision: 1,
    displayMode: 'all-markup',
    reviewArtifacts: Object.freeze([]),
    pages: Object.freeze([...pages]),
    ...(extra.documentMetadata ? { documentMetadata: extra.documentMetadata } : {}),
    ...(extra.destinations ? { destinations: extra.destinations } : {}),
  }) as ExportSemanticLayout;
}

describe('planPdfPaintFromLayout', () => {
  test('emits begin-page commands for every physical page', () => {
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792), page(1, 841.89, 595.28)]));

    expect(result.pageCount).toBe(2);
    expect(result.plan.commands.filter((command) => command.kind === 'beginPage')).toEqual([
      { kind: 'beginPage', pageIndex: 0, width: 612, height: 792 },
      { kind: 'beginPage', pageIndex: 1, width: 841.89, height: 595.28 },
    ]);
  });

  test('maps body paragraph text with page-relative geometry, baseline, and style', () => {
    const body = paragraph(
      'p1',
      'Hello',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 },
      {
        style: { bold: true, fontSizePt: 12, color: '112233' },
        fragmentBox: { x: 0, y: 0, width: 468, height: 14 },
        baseline: 10,
      }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));

    const textCommand = result.plan.commands.find((command) => command.kind === 'textSpan');
    expect(textCommand).toMatchObject({
      kind: 'textSpan',
      text: 'Hello',
      style: {
        fontFamily: 'Arial',
        fontSizePt: 12,
        fontWeight: 'bold',
        italic: false,
        color: '#112233',
        decoration: 'none',
        baselineShiftPt: 0,
      },
    });

    const pageHeight = 792;
    const expectedRect = coreBoxToPdfRect({ x: 72, y: 72, width: 40, height: 11 }, pageHeight);
    const expectedBaseline = coreYToPdfY(72 + 10, pageHeight);
    expect(textCommand).toMatchObject({
      rect: expectedRect,
      baseline: expectedBaseline,
    });
  });

  test('includes header and footer story text on the same page', () => {
    const headerStory = Object.freeze({
      kind: 'header',
      variant: 'default',
      partName: 'header1.xml',
      box: Object.freeze({ x: 72, y: 36, width: 468, height: 36 }),
      fragments: Object.freeze([
        paragraph(
          'hdr',
          'Header title',
          { x: 0, y: 0, width: 468, height: 14 },
          { x: 0, y: 0, width: 80, height: 11 },
          { baseline: 9.5 }
        ),
      ]),
    }) as HeaderFooterStoryRecord;

    const footerStory = Object.freeze({
      kind: 'footer',
      variant: 'default',
      partName: 'footer1.xml',
      box: Object.freeze({ x: 72, y: 720, width: 468, height: 36 }),
      fragments: Object.freeze([
        paragraph(
          'ftr',
          'Footer page',
          { x: 0, y: 0, width: 468, height: 14 },
          { x: 0, y: 0, width: 70, height: 11 },
          { baseline: 9.5 }
        ),
      ]),
    }) as HeaderFooterStoryRecord;

    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          header: headerStory,
          footer: footerStory,
        }),
      ])
    );

    const texts = result.plan.commands
      .filter((command) => command.kind === 'textSpan')
      .map((command) => (command.kind === 'textSpan' ? command.text : ''));
    expect(texts).toEqual(['Header title', 'Footer page']);
  });

  test('emits sanitized external link annotations and skips inert links', () => {
    const linked = paragraph(
      'linked',
      'Visit',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 30, height: 11 },
      {
        link: Object.freeze({
          id: 'link-1',
          kind: 'external',
          href: 'https://example.com/docs',
        }),
      }
    );
    const inert = paragraph(
      'inert',
      'No link',
      { x: 0, y: 20, width: 468, height: 14 },
      { x: 0, y: 20, width: 40, height: 11 },
      {
        link: Object.freeze({
          id: 'link-2',
          kind: 'external',
          href: null,
        }),
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [linked, inert] })])
    );

    const links = result.plan.commands.filter((command) => command.kind === 'link');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      kind: 'link',
      target: { kind: 'external', href: 'https://example.com/docs' },
    });
  });

  test('records diagnostics for unsupported tables, drawings, and notes', () => {
    const table = Object.freeze({
      kind: 'table',
      id: 'tbl-1',
      tableId: 'tbl-root',
      fragmentIndex: 0,
      nestingDepth: 0,
      columnEdges: Object.freeze([0, 100]),
      rows: Object.freeze([]),
      box: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
    });
    const drawingLine = paragraph(
      'draw',
      'x',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 5, height: 11 },
      {
        drawings: Object.freeze([
          Object.freeze({
            paragraphId: 'draw',
            start: 0,
            advanceStart: 0,
            advanceEnd: 24,
            baselineOffset: 11,
          }),
        ]),
      }
    );

    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [table as never, drawingLine],
          footnotes: Object.freeze({
            kind: 'footnotes',
            placement: 'pageBottom',
            box: Object.freeze({ x: 72, y: 600, width: 468, height: 120 }),
            notes: Object.freeze([]),
          }) as PageRecord['footnotes'],
        }),
      ])
    );

    const features = result.diagnostics.map((entry) => entry.feature).sort();
    expect(features).toEqual(['drawing', 'footnotes', 'table']);
    expect(result.diagnostics.every((entry) => entry.kind === 'unsupported')).toBe(true);
  });

  test('records equation spans as unsupported instead of omitting them silently', () => {
    const equation = paragraph(
      'eq',
      '\uFFFC',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 12, height: 11 },
      { equation: { fallbackText: 'x < y' } }
    );

    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [equation] })]));

    expect(result.plan.commands.some((command) => command.kind === 'textSpan')).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'equation',
        recordKind: 'equationSpan',
        kind: 'unsupported',
      })
    );
  });

  test('serializes planned commands deterministically with style fields', () => {
    const body = paragraph(
      'styled',
      'PDF',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 10.5, y: 0, width: 24, height: 12 },
      {
        style: {
          italic: true,
          underline: Object.freeze({ variant: 'single', color: null }),
          fontSizePt: 10.5,
        },
        baseline: 9,
      }
    );
    const serialized = serializePdfPaintPlan(
      planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })])).plan
    );
    expect(serialized).toContain('beginPage\t0\t612\t792');
    expect(serialized).toContain('PDF');
    expect(serialized).toContain('underline');
    expect(serialized).toContain(
      pdfTextStyleFromResolvedRunStyle(body.lines[0]!.spans[0]!.style).fontSizePt.toString()
    );
  });

  test('applies baseline shift as an upward Core Y adjustment', () => {
    const body = paragraph(
      'shift',
      'Hi',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 20, height: 11 },
      { baseline: 10, style: { baselineShiftPt: 4 } }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const textCommand = result.plan.commands.find((command) => command.kind === 'textSpan');
    expect(textCommand).toMatchObject({
      baseline: coreYToPdfY(72 + 10 - 4, 792),
    });
  });

  test('places list markers from marker box without adding fragment box twice', () => {
    const itemStyle = span('list', 'Item', { x: 18, y: 0, width: 40, height: 11 }).style;
    const body = paragraph(
      'list',
      'Item',
      { x: 0, y: 0, width: 468, height: 14 },
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
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const marker = result.plan.commands.find(
      (command) => command.kind === 'textSpan' && command.text === '1.'
    );
    expect(marker).toMatchObject({
      kind: 'textSpan',
      text: '1.',
      rect: coreBoxToPdfRect({ x: 72, y: 74, width: 14, height: 11 }, 792),
      baseline: coreYToPdfY(72 + 9.5, 792),
    });
  });

  test('list marker baseline uses the first line, not marker box height', () => {
    const itemStyle = span('list', 'Item', { x: 18, y: 0, width: 40, height: 11 }).style;
    const marker = Object.freeze({
      text: '1.',
      style: itemStyle,
      box: Object.freeze({ x: 0, y: 2, width: 14, height: 18 }),
      level: 0,
      numId: '1',
      numFmt: 'decimal',
      ordinal: 1,
    }) as ParagraphFragmentRecord['marker'];
    const body = paragraph(
      'list',
      'Item',
      { x: 0, y: 4, width: 468, height: 20 },
      { x: 18, y: 4, width: 40, height: 11 },
      { baseline: 10, marker }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const command = result.plan.commands.find(
      (entry) => entry.kind === 'textSpan' && entry.text === '1.'
    );
    expect(command).toMatchObject({
      baseline: coreYToPdfY(72 + 4 + 10, 792),
    });
    expect(command).not.toMatchObject({
      baseline: coreYToPdfY(72 + 2 + 18, 792),
    });
  });

  test('marker-only empty lines still use the published line baseline', () => {
    const itemStyle = span('empty', '', { x: 18, y: 0, width: 0, height: 11 }).style;
    const body = paragraph(
      'empty',
      '',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 18, y: 0, width: 0, height: 11 },
      {
        baseline: 8,
        lineMode: 'empty',
        marker: Object.freeze({
          text: '2.',
          style: itemStyle,
          box: Object.freeze({ x: 0, y: 3, width: 14, height: 16 }),
          level: 0,
          numId: '1',
          numFmt: 'decimal',
          ordinal: 2,
        }) as ParagraphFragmentRecord['marker'],
      }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const command = result.plan.commands.find(
      (entry) => entry.kind === 'textSpan' && entry.text === '2.'
    );
    expect(command).toMatchObject({
      baseline: coreYToPdfY(72 + 8, 792),
    });
  });

  test('a marker with no lines falls back without throwing', () => {
    const itemStyle = span('orphan', '', { x: 0, y: 0, width: 14, height: 11 }).style;
    const body = paragraph(
      'orphan',
      '',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 14, height: 11 },
      {
        lineMode: 'none',
        marker: Object.freeze({
          text: '3.',
          style: itemStyle,
          box: Object.freeze({ x: 0, y: 2, width: 14, height: 11 }),
          level: 0,
          numId: '1',
          numFmt: 'decimal',
          ordinal: 3,
        }) as ParagraphFragmentRecord['marker'],
      }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const command = result.plan.commands.find(
      (entry) => entry.kind === 'textSpan' && entry.text === '3.'
    );
    expect(command).toMatchObject({
      kind: 'textSpan',
      text: '3.',
      baseline: coreYToPdfY(72 + 2 + 11, 792),
    });
  });

  test('aggregates repeated tables on the same page into one diagnostic', () => {
    const table = (id: string) =>
      Object.freeze({
        kind: 'table',
        id,
        tableId: id,
        fragmentIndex: 0,
        nestingDepth: 0,
        columnEdges: Object.freeze([0, 100]),
        rows: Object.freeze([]),
        box: Object.freeze({ x: 0, y: 0, width: 100, height: 40 }),
      });
    const result = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [table('tbl-1') as never, table('tbl-2') as never],
        }),
      ])
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      feature: 'table',
      reason:
        'Table structure and decoration are unsupported; cell text remains painted (2 occurrences)',
    });
  });

  test('paints table cell text while diagnosing missing table structure', () => {
    const cell = paragraph(
      'cell',
      'Cell text',
      { x: 0, y: 0, width: 80, height: 14 },
      { x: 0, y: 0, width: 50, height: 11 }
    );
    const table = Object.freeze({
      kind: 'table',
      id: 'tbl-cell',
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
              blocks: Object.freeze([cell]),
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
    expect(
      result.plan.commands.some(
        (command) => command.kind === 'textSpan' && command.text === 'Cell text'
      )
    ).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'table',
        kind: 'unsupported',
        reason: 'Table structure and decoration are unsupported; cell text remains painted',
      })
    );
  });

  test('refuses a layout whose page count exceeds HARD_MAX_PDF_PAGES', () => {
    const oversized = {
      revision: 1,
      displayMode: 'all-markup',
      reviewArtifacts: [],
      pages: { length: HARD_MAX_PDF_PAGES + 1 },
    } as unknown as ExportSemanticLayout;
    expect(() => planPdfPaintFromLayout(oversized)).toThrow(PdfPaintValidationError);
    expect(() => planPdfPaintFromLayout(oversized)).toThrow(/pageCount/);
  });

  test('emits named destinations and internal links from Core export destination data', () => {
    const target = paragraph(
      'target',
      'Here',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 30, height: 11 },
      { baseline: 10 }
    );
    const linked = paragraph(
      'linked',
      'Go',
      { x: 0, y: 20, width: 468, height: 14 },
      { x: 0, y: 20, width: 20, height: 11 },
      {
        link: Object.freeze({
          id: 'link-jump',
          kind: 'internal',
          href: '#Jump',
          anchor: 'Jump',
        }),
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [target, linked] })], {
        destinations: Object.freeze([
          Object.freeze({
            anchor: Object.freeze({ name: 'Jump', paragraphId: 'target', offset: 0 }),
            pageIndex: 0,
            pageContent: Object.freeze({ x: 0, y: 0, height: 12 }),
            pageStack: Object.freeze({ x: 72, y: 72 }),
          }),
        ]),
      })
    );

    expect(result.plan.commands).toContainEqual({
      kind: 'destination',
      name: 'Jump',
      rect: coreBoxToPdfRect({ x: 72, y: 72, width: 1, height: 12 }, 792),
    });
    const links = result.plan.commands.filter((command) => command.kind === 'link');
    expect(links).toEqual([
      expect.objectContaining({
        kind: 'link',
        target: { kind: 'internal', destination: 'Jump' },
      }),
    ]);
    expect(result.diagnostics.some((entry) => entry.feature === 'internal-link')).toBe(false);
  });

  test('skips inert internal links and reports unresolved destinations without Core-gap claims', () => {
    const inert = paragraph(
      'inert',
      'No',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 20, height: 11 },
      {
        link: Object.freeze({
          id: 'link-inert',
          kind: 'internal',
          href: null,
          anchor: 'Jump',
        }),
      }
    );
    const missing = paragraph(
      'missing',
      'Gone',
      { x: 0, y: 20, width: 468, height: 14 },
      { x: 0, y: 20, width: 30, height: 11 },
      {
        link: Object.freeze({
          id: 'link-missing',
          kind: 'internal',
          href: '#Missing',
          anchor: 'Missing',
        }),
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [inert, missing] })], {
        destinations: Object.freeze([]),
      })
    );

    expect(result.plan.commands.some((command) => command.kind === 'link')).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'internal-link',
        recordId: 'link-missing',
        reason: 'Internal destination "Missing" is unresolved in the export layout',
      })
    );
    expect(
      result.diagnostics.every(
        (entry) => !/not published|not implemented|Core lacks/i.test(entry.reason)
      )
    ).toBe(true);
  });

  test('maps bounded document metadata onto the paint plan', () => {
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792)], {
        documentMetadata: Object.freeze({
          title: 'Export Title',
          creator: 'Export Author',
          subject: 'Export Subject',
          keywords: 'alpha, beta',
          company: 'Export Co',
        }),
      })
    );
    expect(result.plan.documentMetadata).toEqual({
      title: 'Export Title',
      author: 'Export Author',
      subject: 'Export Subject',
      keywords: 'alpha, beta',
    });
  });

  test('places destinations with mixed page coordinates', () => {
    const letterLink = paragraph(
      'from',
      'See',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 24, height: 11 },
      {
        link: Object.freeze({
          id: 'link-other',
          kind: 'internal',
          href: '#Other',
          anchor: 'Other',
        }),
      }
    );
    const landscapeTarget = paragraph(
      'to',
      'There',
      { x: 0, y: 0, width: 700, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 }
    );
    const letter = page(0, 612, 792, { fragments: [letterLink] });
    const landscape = page(1, 841.89, 595.28, {
      fragments: [landscapeTarget],
      contentBox: { x: 56.69, y: 56.69, width: 728.51, height: 481.9 },
    });
    const result = planPdfPaintFromLayout(
      layout([letter, landscape], {
        destinations: Object.freeze([
          Object.freeze({
            anchor: Object.freeze({ name: 'Other', paragraphId: 'to', offset: 0 }),
            pageIndex: 1,
            pageContent: Object.freeze({ x: 0, y: 0, height: 12 }),
            pageStack: Object.freeze({ x: 56.69, y: 56.69 }),
          }),
        ]),
      })
    );

    const destination = result.plan.commands.find((command) => command.kind === 'destination');
    expect(destination).toEqual({
      kind: 'destination',
      name: 'Other',
      rect: coreBoxToPdfRect({ x: 56.69, y: 56.69, width: 1, height: 12 }, 595.28),
    });
    const beginPages = result.plan.commands.filter((command) => command.kind === 'beginPage');
    expect(beginPages).toEqual([
      { kind: 'beginPage', pageIndex: 0, width: 612, height: 792 },
      { kind: 'beginPage', pageIndex: 1, width: 841.89, height: 595.28 },
    ]);
    expect(result.plan.commands).toContainEqual(
      expect.objectContaining({
        kind: 'link',
        target: { kind: 'internal', destination: 'Other' },
      })
    );
  });

  test('keeps baseline-shift geometry on the command baseline and in the style field', () => {
    const body = paragraph(
      'shift',
      'Hi',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 20, height: 11 },
      { baseline: 10, style: { baselineShiftPt: 4 } }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const textCommand = result.plan.commands.find((command) => command.kind === 'textSpan');
    expect(textCommand).toMatchObject({
      kind: 'textSpan',
      baseline: coreYToPdfY(72 + 10 - 4, 792),
      style: { baselineShiftPt: 4 },
    });
  });

  test('emits uppercase visible text for w:caps and keeps source case for small caps', () => {
    const caps = paragraph(
      'caps',
      'Hello',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 },
      { style: { caps: true } }
    );
    const small = paragraph(
      'small',
      'World',
      { x: 0, y: 20, width: 468, height: 14 },
      { x: 0, y: 20, width: 40, height: 11 },
      { style: { smallCaps: true } }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [caps, small] })])
    );
    const texts = result.plan.commands
      .filter((command) => command.kind === 'textSpan')
      .map((command) => (command.kind === 'textSpan' ? command.text : ''));
    expect(texts).toEqual(['HELLO', 'World']);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'approximation',
        feature: 'small-caps',
      })
    );
    expect(result.diagnostics.some((entry) => entry.feature === 'caps')).toBe(false);
  });

  test('emits a precise approximation for each unimplemented run effect', () => {
    const decorated = paragraph(
      'fx',
      'Styled',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 0, y: 0, width: 40, height: 11 },
      {
        style: {
          smallCaps: true,
          characterSpacingPt: 1,
          horizontalScalePercent: 150,
          highlight: 'yellow',
          shading: 'CCCCCC',
        },
      }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [decorated] })]));
    const features = result.diagnostics.map((entry) => entry.feature).sort();
    expect(features).toEqual([
      'character-spacing',
      'highlight',
      'horizontal-scale',
      'shading',
      'small-caps',
    ]);
    expect(result.diagnostics.every((entry) => entry.kind === 'approximation')).toBe(true);
    expect(result.plan.commands).toContainEqual(
      expect.objectContaining({ kind: 'textSpan', text: 'Styled' })
    );
  });

  test('observes an optional abort signal without requiring callers to pass options', () => {
    const controller = new AbortController();
    controller.abort('stop-planning');
    expect(() =>
      planPdfPaintFromLayout(layout([page(0, 612, 792)]), { signal: controller.signal })
    ).toThrow(ExportResourceError);
    expect(() => planPdfPaintFromLayout(layout([page(0, 612, 792)]))).not.toThrow();
  });
});
