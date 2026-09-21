/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDocument, type PDFPage } from 'pdf-lib';
import type {
  ExportSemanticLayout,
  FontBackedExportCapabilities,
} from '@docx-editor.dev/core/export';
import {
  forEachSemanticSpan,
  forEachSemanticStory,
  forEachSemanticDrawing,
  runBorderStrokesForLine,
  type BlockFragmentRecord,
  type LayoutBox,
  type SemanticSpanVisit,
  type SemanticDrawingVisit,
} from '@docx-editor.dev/core/layout';
import { color, number as n, unicodeHex, Work, Commands, rect } from './context.ts';
import { TextWriter } from './text.ts';
import { comments, destinations, linkAnnotation } from './annotations.ts';
import { ImageWriter } from './images.ts';
import { paintEquation } from './equations.ts';

function rule(
  box: LayoutBox,
  colorHex: string | null,
  style: string,
  x: number,
  y: number,
  height: number
): string {
  if (style === 'double') {
    const horizontal = box.width >= box.height;
    const third = (horizontal ? box.height : box.width) / 3;
    return [0, 2 * third]
      .map((offset) =>
        rule(
          {
            ...box,
            x: box.x + (horizontal ? 0 : offset),
            y: box.y + (horizontal ? offset : 0),
            width: horizontal ? box.width : third,
            height: horizontal ? third : box.height,
          },
          colorHex,
          'single',
          x,
          y,
          height
        )
      )
      .join('\n');
  }
  if (style === 'solid' || style === 'single' || style === 'thick')
    return `${color(colorHex)} rg ${rect(box, x, y, height, true)} f`;
  const horizontal = box.width >= box.height;
  const width = horizontal ? box.height : box.width;
  const sx = box.x + x + (horizontal ? 0 : width / 2),
    sy = height - box.y - y - (horizontal ? width / 2 : 0);
  return `${color(colorHex)} RG ${n(width)} w [${n(style === 'dotted' ? width : width * 3)} ${n(width * 2)}] 0 d ${n(sx)} ${n(sy)} m ${n(sx + (horizontal ? box.width : 0))} ${n(sy - (horizontal ? 0 : box.height))} l S [] 0 d`;
}
function decorations(
  blocks: readonly BlockFragmentRecord[],
  x: number,
  y: number,
  page: PDFPage,
  work: Work,
  pageIndex: number
): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    work.tick();
    if (block.kind === 'paragraph') {
      if (block.shading && block.shadingBox)
        out.push(
          `${color(block.shading)} rg ${rect(block.shadingBox, x, y, page.getHeight(), true)} f`
        );
      for (const border of block.borders ??
        (block.bottomBorder ? [{ ...block.bottomBorder, side: 'bottom' }] : [])) {
        const style = border.edge.val;
        if (border.edge.shadow)
          work.report('border-shadow', 'Paragraph border shadow is not encoded', pageIndex);
        if (!['single', 'thick', 'dashed', 'dotted', 'double'].includes(style))
          work.report(
            'paragraph-border-style',
            `Unsupported paragraph border: ${style}`,
            pageIndex
          );
        out.push(rule(border.box, border.edge.color, style, x, y, page.getHeight()));
      }
    } else {
      // Complete the backgrounds before drawing shared borders. Later cells and
      // nested paragraph shading must not erase an earlier cell's owned edge.
      for (const row of block.rows)
        for (const cell of row.cells) {
          if (cell.paintInert || cell.vMergeContinue) continue;
          if (cell.shading)
            out.push(`${color(cell.shading)} rg ${rect(cell.box, x, y, page.getHeight(), true)} f`);
          out.push(...decorations(cell.blocks, x, y, page, work, pageIndex));
        }
      for (const row of block.rows)
        for (const cell of row.cells) {
          if (cell.paintInert || cell.vMergeContinue) continue;
          if (cell.textDirection)
            work.report('cell-text-direction', 'Rotated cell text is not encoded', pageIndex);
          for (const stroke of cell.borders?.strokes ?? [])
            out.push(
              rule(
                stroke,
                stroke.color,
                stroke.cssStyle,
                x + cell.box.x,
                y + cell.box.y,
                page.getHeight()
              )
            );
          const publishedSides = new Set(
            (cell.borders?.strokes ?? []).map((stroke) => stroke.side)
          );
          for (const side of ['top', 'right', 'bottom', 'left'] as const) {
            const edge = cell.borders?.[side];
            if (!edge || publishedSides.has(side)) continue;
            const b = cell.box,
              width = edge.widthPt;
            const box = {
              x: b.x + (side === 'right' ? b.width - width : 0),
              y: b.y + (side === 'bottom' ? b.height - width : 0),
              width: side === 'left' || side === 'right' ? width : b.width,
              height: side === 'top' || side === 'bottom' ? width : b.height,
            };
            out.push(rule(box, edge.color, edge.style, x, y, page.getHeight()));
          }
        }
    }
  }
  return out;
}
const HIGHLIGHTS: Record<string, string> = {
  yellow: 'FFFF00',
  green: '00FF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  blue: '0000FF',
  red: 'FF0000',
  darkBlue: '000080',
  darkCyan: '008080',
  darkGreen: '008000',
  darkMagenta: '800080',
  darkRed: '800000',
  darkYellow: '808000',
  darkGray: '808080',
  lightGray: 'C0C0C0',
  black: '000000',
  white: 'FFFFFF',
};
/** Device grid the reference paints on: 1/300 inch. */
const PAGE_GRID_PT = 0.24;

/** Round a page dimension onto the device grid, as the reference writes it. */
function onDeviceGrid(value: number): number {
  return Number((Math.round(value / PAGE_GRID_PT) * PAGE_GRID_PT).toFixed(6));
}

export async function paint(
  doc: PDFDocument,
  session: FontBackedExportCapabilities,
  layout: ExportSemanticLayout,
  work: Work,
  includeComments: boolean
): Promise<void> {
  // The reference puts the page box on the same 0.24pt device grid it paints on. A4 is
  // authored as 11906 x 16838 twips, which is 595.30 x 841.90pt, and the reference writes
  // 595.20 x 841.92 — 2480 and 3508 units. Twenty-three reference documents agree, Letter
  // included, where the authored size is already on the grid and nothing moves. Leaving the
  // exact size in shifts every top-down position by the height's own remainder.
  const pages = layout.pages.map((p) => {
    if (p.box.width <= 0 || p.box.height <= 0 || p.box.width > 14400 || p.box.height > 14400)
      throw new RangeError('Invalid PDF page dimensions');
    return doc.addPage([onDeviceGrid(p.box.width), onDeviceGrid(p.box.height)]);
  });
  for (const artifact of layout.reviewArtifacts) {
    if (
      layout.displayMode === 'all-markup' &&
      artifact.kind === 'tracked-change' &&
      !['insert', 'delete', 'replace'].includes(artifact.change)
    )
      work.report('review-presentation', `Unsupported revision presentation: ${artifact.change}`);
  }
  const text = new TextWriter(doc, session, work, layout.displayMode === 'all-markup');
  const images = new ImageWriter(doc, session, work);
  const names = destinations(doc, pages, layout);
  const behindStreams = pages.map(() => new Commands(work));
  const streams = pages.map(() => new Commands(work));
  const frontBorders = pages.map(() => new Commands(work));
  for (const record of layout.pages) {
    const out = streams[record.index]!;
    // Chrome flips y from the same gridded page height the text uses. `record.box.height` is
    // the ungridded layout value, and the two differ by up to half a device unit on A4.
    const pageHeight = pages[record.index]!.getHeight();
    if (record.pageBorders) {
      const borderOut = record.pageBorders.zOrder === 'front' ? frontBorders[record.index]! : out;
      for (const border of record.pageBorders.strokes) {
        if (
          !['single', 'thick', 'dashed', 'dotted', 'double'].includes(border.edge.val) ||
          border.edge.shadow
        )
          work.report(
            'page-border-style',
            `Unsupported page border: ${border.edge.val}`,
            record.index
          );
        borderOut.push(rule(border.box, border.edge.color, border.edge.val, 0, 0, pageHeight));
      }
    }
    for (const separator of record.columnSeparators ?? [])
      out.push(
        `0 0 0 rg ${rect(separator, record.contentBox.x - record.box.x, record.contentBox.y - record.box.y, pageHeight, true)} f`
      );
    for (const area of [record.footnotes, record.endnotes]) {
      const sep = area?.separator;
      if (!sep || !(sep.ruleStyle || sep.synthetic)) continue;
      for (const offset of sep.ruleStyle === 'double' ? [0, 2] : [0])
        out.push(
          `${color(sep.ruleColor)} rg ${rect({ ...sep.box, y: sep.box.y + offset, height: sep.ruleStyle === 'double' ? 0.75 : sep.box.height }, -record.box.x, -record.box.y, pageHeight, true)} f`
        );
    }
  }
  const spans: SemanticSpanVisit[] = [];
  const drawings: SemanticDrawingVisit[] = [];
  for (const warning of layout.contentWarnings ?? [])
    work.report(`core-${warning.code}`, warning.code);
  forEachSemanticSpan(layout, (visit) => {
    work.tick();
    spans.push(visit);
  });
  forEachSemanticDrawing(layout, (visit) => {
    work.tick();
    drawings.push(visit);
  });
  forEachSemanticStory(layout, (root) => {
    streams[root.page.index]!.push(
      ...decorations(
        root.host.fragments,
        root.origin.x - root.page.box.x,
        root.origin.y - root.page.box.y,
        pages[root.page.index]!,
        work,
        root.page.index
      )
    );
  });
  // Behind-text images belong below the owner's text and decoration.
  drawings.sort(
    (a, b) =>
      (a.drawing.kind === 'anchoredDrawing' ? a.drawing.relativeHeight : 0) -
      (b.drawing.kind === 'anchoredDrawing' ? b.drawing.relativeHeight : 0)
  );
  for (const visit of drawings.filter((v) => v.paintLayer === 'behind-text')) {
    const commands = await images.paint(visit, pages[visit.page.index]!);
    behindStreams[visit.page.index]!.push(commands);
  }
  // PDF extractors expect glyphs in visual order within each physical line.
  // Retain logical Unicode separately in one ActualText region for the complete line.
  const pageGroups = new Map<number, Map<object, SemanticSpanVisit[]>>();
  for (const visit of spans) {
    let lines = pageGroups.get(visit.page.index);
    if (!lines) {
      lines = new Map();
      pageGroups.set(visit.page.index, lines);
    }
    let group = lines.get(visit.line);
    if (!group) {
      group = [];
      lines.set(visit.line, group);
    }
    group.push(visit);
  }
  const lineStarts = new Map<SemanticSpanVisit, string>();
  spans.length = 0;
  for (const lines of pageGroups.values())
    for (const group of lines.values()) {
      const first = group[0]!;
      const markerText =
        first.paragraph.lines[0] === first.line ? first.paragraph.marker?.text : undefined;
      const logical =
        (markerText ? markerText + ' ' : '') +
        group.map((v) => v.span.equation?.fallbackText ?? v.span.text).join('');
      group.sort((a, b) => a.absoluteBox.x - b.absoluteBox.x);
      lineStarts.set(group[0]!, logical);
      for (const visit of group) spans.push(visit);
    }
  let activeOut: string[] | undefined;
  const markersByPage = new Map<number, Set<object>>();
  for (let i = 0; i < spans.length; i++) {
    if (i % 128 === 0) await work.yield();
    const visit = spans[i]!,
      page = pages[visit.page.index]!,
      out = streams[visit.page.index]!;
    if (visit.story === 'textbox') {
      work.report('textbox', 'Textbox paint order is not supported', visit.page.index);
      continue;
    }
    if (lineStarts.has(visit)) {
      if (activeOut) activeOut.push('EMC');
      activeOut = out;
      out.push(`/Span << /ActualText <FEFF${unicodeHex(lineStarts.get(visit) ?? '')}> >> BDC`);
    }
    let markers = markersByPage.get(visit.page.index);
    if (!markers) {
      markers = new Set();
      markersByPage.set(visit.page.index, markers);
    }
    const marker = visit.paragraph.marker;
    if (marker && !markers.has(visit.paragraph)) {
      markers.add(visit.paragraph);
      // A picture bullet replaces the marker glyph. Anything undrawable — missing, external,
      // still decoding, refused, or a format this writer cannot embed — answers '' and the
      // level's `w:lvlText` is painted instead, which is the same fall back Word shows.
      const picture = marker.picture
        ? await images.paintListMarkerPicture(
            marker.picture,
            {
              ...marker.picture.box,
              x: marker.picture.box.x + visit.storyOrigin.x - visit.page.box.x,
              y: marker.picture.box.y + visit.storyOrigin.y - visit.page.box.y,
            },
            page,
            visit.page.index
          )
        : '';
      if (picture) out.push(picture);
      else
        out.push(
          text.paint(
            {
              ...visit,
              span: {
                ...visit.span,
                text: marker.text,
                style: marker.style,
                box: marker.box,
                link: undefined,
                revisions: undefined,
              },
              absoluteBox: {
                ...marker.box,
                x: marker.box.x + visit.storyOrigin.x,
                y: marker.box.y + visit.storyOrigin.y,
              },
            },
            page
          )
        );
    }
    const fill = HIGHLIGHTS[visit.span.style.highlight ?? ''] ?? visit.span.style.shading;
    if (fill)
      out.push(
        `${color(fill)} rg ${rect(visit.absoluteBox, -visit.page.box.x, -visit.page.box.y, page.getHeight(), true)} f`
      );
    const clipping = visit.paragraph.clipToBox;
    if (clipping)
      out.push(
        `q ${rect(visit.paragraph.box, visit.storyOrigin.x - visit.page.box.x, visit.storyOrigin.y - visit.page.box.y, page.getHeight())} W n`
      );
    out.push(
      visit.span.equation ? paintEquation(visit, page, text, work) : text.paint(visit, page)
    );
    if (clipping) out.push('Q');
    linkAnnotation(doc, page, visit, names);
  }
  if (activeOut) activeOut.push('EMC');
  // Draw grouped character borders after highlights, which may otherwise cover an
  // earlier run's edge. Geometry and grouping are shared with the screen painter.
  for (const lines of pageGroups.values()) {
    for (const group of lines.values()) {
      const visit = group[0]!;
      const strokes = runBorderStrokesForLine(visit.line);
      if (strokes.length === 0) continue;
      work.tick();
      const out = streams[visit.page.index]!;
      const height = pages[visit.page.index]!.getHeight();
      const x = visit.storyOrigin.x - visit.page.box.x;
      const y = visit.storyOrigin.y - visit.page.box.y;
      if (visit.paragraph.clipToBox) out.push(`q ${rect(visit.paragraph.box, x, y, height)} W n`);
      for (const { box, edge } of strokes) {
        if (edge.shadow || !['single', 'thick', 'dashed', 'dotted', 'double'].includes(edge.val))
          work.report(
            'run-border-style',
            `Unsupported character border: ${edge.val}${edge.shadow ? ' with shadow' : ''}`,
            visit.page.index
          );
        out.push(rule(box, edge.color, edge.val, x, y, height));
      }
      if (visit.paragraph.clipToBox) out.push('Q');
    }
  }
  for (const visit of drawings.filter((v) => v.paintLayer !== 'behind-text'))
    streams[visit.page.index]!.push(await images.paint(visit, pages[visit.page.index]!));
  // `w:zOrder="front"` puts the page frame over EVERYTHING on the page, in-front drawings
  // included, so it goes into the stream after them, not before.
  for (let i = 0; i < streams.length; i++) streams[i]!.push(...frontBorders[i]!);
  for (let i = 0; i < pages.length; i++) {
    work.check();
    pages[i]!.node.addContentStream(
      doc.context.register(
        doc.context.flateStream(behindStreams[i]!.join('\n') + '\n' + streams[i]!.join('\n'))
      )
    );
  }
  for (const face of text.faces.values()) await face.finish(work);
  if (includeComments) comments(doc, pages, layout, work);
}
