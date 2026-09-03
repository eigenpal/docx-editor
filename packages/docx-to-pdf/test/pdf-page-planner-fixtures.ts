/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';
import type {
  HeaderFooterStoryRecord,
  PageRecord,
  ParagraphFragmentRecord,
  StyleSpanRecord,
} from '@docx-editor.dev/core/layout';

export function span(
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

export function paragraph(
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

export function page(
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

export function layout(
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
