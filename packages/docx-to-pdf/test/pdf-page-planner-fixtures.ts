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
  link?: StyleSpanRecord['link'],
  extras: {
    readonly rangeStart?: number;
    readonly wrapAdvanceBefore?: number;
  } = {}
): StyleSpanRecord {
  const rangeStart = extras.rangeStart ?? 0;
  return Object.freeze({
    range: Object.freeze({ paragraphId, start: rangeStart, end: rangeStart + text.length }),
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
    ...(extras.wrapAdvanceBefore === undefined
      ? {}
      : { wrapAdvanceBefore: extras.wrapAdvanceBefore }),
  }) as StyleSpanRecord;
}

export function paragraphFromSpans(
  id: string,
  lineBox: { x: number; y: number; width: number; height: number },
  spans: readonly StyleSpanRecord[],
  options: {
    readonly baseline?: number;
    readonly drawings?: readonly {
      paragraphId: string;
      start: number;
      advanceStart: number;
      advanceEnd: number;
      baselineOffset: number;
    }[];
    readonly lines?: readonly {
      readonly box: { x: number; y: number; width: number; height: number };
      readonly spans: readonly StyleSpanRecord[];
      readonly baseline?: number;
      readonly drawings?: readonly {
        paragraphId: string;
        start: number;
        advanceStart: number;
        advanceEnd: number;
        baselineOffset: number;
      }[];
    }[];
  } = {}
): ParagraphFragmentRecord {
  const lines = options.lines
    ? options.lines.map((line, index) =>
        Object.freeze({
          id: `${id}:line-${index}`,
          range: Object.freeze({
            paragraphId: id,
            start: line.spans[0]?.range.start ?? 0,
            end: line.spans[line.spans.length - 1]?.range.end ?? 0,
          }),
          spans: Object.freeze([...line.spans]),
          box: Object.freeze(line.box),
          contentX: line.box.x,
          baseline: line.baseline ?? options.baseline ?? 9.5,
          leading: 0,
          ...(line.drawings ? { drawings: Object.freeze(line.drawings) } : {}),
        })
      )
    : [
        Object.freeze({
          id: `${id}:line-0`,
          range: Object.freeze({
            paragraphId: id,
            start: spans[0]?.range.start ?? 0,
            end: spans[spans.length - 1]?.range.end ?? 0,
          }),
          spans: Object.freeze([...spans]),
          box: Object.freeze(lineBox),
          contentX: lineBox.x,
          baseline: options.baseline ?? 9.5,
          leading: 0,
          ...(options.drawings ? { drawings: Object.freeze(options.drawings) } : {}),
        }),
      ];
  const last = lines[lines.length - 1];
  return Object.freeze({
    kind: 'paragraph',
    id: `${id}:f0`,
    paragraphId: id,
    fragmentIndex: 0,
    range: Object.freeze({
      paragraphId: id,
      start: lines[0]?.range.start ?? 0,
      end: last?.range.end ?? 0,
    }),
    props: Object.freeze([]),
    styleId: null,
    outlineLevel: null,
    alignment: 'both',
    spacing: Object.freeze({ before: 0, after: 0 }),
    indent: Object.freeze({ left: 0, right: 0, firstLine: 0, hanging: 0 }),
    tabStops: Object.freeze({ stops: Object.freeze([]), defaultIntervalPt: 36 }),
    lines: Object.freeze(lines),
    box: Object.freeze(lineBox),
  }) as ParagraphFragmentRecord;
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
    revisions?: StyleSpanRecord['revisions'];
    shading?: string;
    shadingBox?: { x: number; y: number; width: number; height: number };
    borders?: ParagraphFragmentRecord['borders'];
    bottomBorder?: ParagraphFragmentRecord['bottomBorder'];
  } = {}
): ParagraphFragmentRecord {
  const styleSpan = Object.freeze({
    ...span(id, text, spanBox, options.style, options.link),
    ...(options.equation ? { equation: Object.freeze(options.equation) } : {}),
    ...(options.revisions ? { revisions: Object.freeze([...options.revisions]) } : {}),
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
    ...(options.shading ? { shading: options.shading } : {}),
    ...(options.shadingBox ? { shadingBox: Object.freeze(options.shadingBox) } : {}),
    ...(options.borders ? { borders: Object.freeze([...options.borders]) } : {}),
    ...(options.bottomBorder ? { bottomBorder: Object.freeze(options.bottomBorder) } : {}),
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
    endnotes?: PageRecord['endnotes'];
    anchoredDrawings?: PageRecord['anchoredDrawings'];
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
    ...(options.endnotes ? { endnotes: options.endnotes } : {}),
    ...(options.anchoredDrawings
      ? { anchoredDrawings: Object.freeze(options.anchoredDrawings) }
      : {}),
  }) as PageRecord;
}

export function layout(
  pages: readonly PageRecord[],
  extra: Partial<
    Pick<ExportSemanticLayout, 'documentMetadata' | 'destinations' | 'reviewArtifacts'>
  > = {}
): ExportSemanticLayout {
  return Object.freeze({
    revision: 1,
    displayMode: 'all-markup',
    reviewArtifacts: Object.freeze([...(extra.reviewArtifacts ?? [])]),
    pages: Object.freeze([...pages]),
    ...(extra.documentMetadata ? { documentMetadata: extra.documentMetadata } : {}),
    ...(extra.destinations ? { destinations: extra.destinations } : {}),
  }) as ExportSemanticLayout;
}
