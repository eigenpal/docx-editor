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
  type TableCellFragmentRecord,
} from '@docx-editor.dev/core/layout';
import {
  color,
  flateStream,
  number as n,
  pageHeight,
  unicodeHex,
  Work,
  Commands,
  rect,
} from './context.ts';
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
/**
 * The transform that turns a `btLr` cell's laid-out plane into its place on the page.
 *
 * Layout lays a bottom-to-top cell out upright, in a plane as wide as the cell is tall,
 * with the plane's origin at the cell's own top-left; the screen painter then turns that
 * plane a quarter turn counter-clockwise and seats its origin at the cell's bottom-left
 * (`table-cell-text-direction-paint.ts`). This is the same turn in PDF user space, where
 * `x`, `y` are the story origin relative to the page and `height` is the page height.
 */
function rotatedCellMatrix(cell: LayoutBox, x: number, y: number, height: number): string {
  const left = x + cell.x;
  const top = y + cell.y;
  return `0 1 -1 0 ${n(left - top + height)} ${n(height - top - cell.height - left)} cm`;
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
          `${color(block.shading)} rg ${rect(block.shadingBox, x, y, pageHeight(page), true)} f`
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
        out.push(rule(border.box, border.edge.color, style, x, y, pageHeight(page)));
      }
    } else {
      // Complete the backgrounds before drawing shared borders. Later cells and
      // nested paragraph shading must not erase an earlier cell's owned edge.
      for (const row of block.rows)
        for (const cell of row.cells) {
          if (cell.paintInert || cell.vMergeContinue) continue;
          if (cell.shading)
            out.push(`${color(cell.shading)} rg ${rect(cell.box, x, y, pageHeight(page), true)} f`);
          const inner = decorations(cell.blocks, x, y, page, work, pageIndex);
          if (cell.textDirection && inner.length)
            out.push('q', rotatedCellMatrix(cell.box, x, y, pageHeight(page)), ...inner, 'Q');
          else out.push(...inner);
        }
      for (const row of block.rows)
        for (const cell of row.cells) {
          if (cell.paintInert || cell.vMergeContinue) continue;
          for (const stroke of cell.borders?.strokes ?? [])
            out.push(
              rule(
                stroke,
                stroke.color,
                stroke.cssStyle,
                x + cell.box.x,
                y + cell.box.y,
                pageHeight(page)
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
            out.push(rule(box, edge.color, edge.style, x, y, pageHeight(page)));
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
    const height = pageHeight(pages[record.index]!);
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
        borderOut.push(rule(border.box, border.edge.color, border.edge.val, 0, 0, height));
      }
    }
    for (const separator of record.columnSeparators ?? [])
      out.push(
        `0 0 0 rg ${rect(separator, record.contentBox.x - record.box.x, record.contentBox.y - record.box.y, height, true)} f`
      );
    for (const area of [record.footnotes, record.endnotes]) {
      const sep = area?.separator;
      if (!sep || !(sep.ruleStyle || sep.synthetic)) continue;
      for (const offset of sep.ruleStyle === 'double' ? [0, 2] : [0])
        out.push(
          `${color(sep.ruleColor)} rg ${rect({ ...sep.box, y: sep.box.y + offset, height: sep.ruleStyle === 'double' ? 0.75 : sep.box.height }, -record.box.x, -record.box.y, height, true)} f`
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
  drawings.sort(
    (a, b) =>
      (a.drawing.kind === 'anchoredDrawing' ? a.drawing.relativeHeight : 0) -
      (b.drawing.kind === 'anchoredDrawing' ? b.drawing.relativeHeight : 0)
  );
  // A textbox's text is painted WITH the textbox, at the textbox's place in the drawing
  // order, not in the story order the traversal hands it out in. Each owner collects its
  // spans, highlights and character borders here; `paintTextbox` clips and emits them when
  // the drawing is painted, over the fill and under whatever the document stacks on top.
  //
  // Keyed by page AND owner: a header or footer is laid out once per variant and attached to
  // every page that shows it, so one owner record recurs with a different page's text each
  // time, and a buffer per record alone would paint every page's text into every copy.
  const textboxBuffers = new Map<number, Map<object, Commands>>();
  // Text in a `btLr` cell is laid out upright and turned when painted, so it too is
  // collected, per page and cell, and emitted under `rotatedCellMatrix` after the loop.
  const rotatedCellOf = new Map<BlockFragmentRecord, TableCellFragmentRecord>();
  const markRotated = (blocks: readonly BlockFragmentRecord[], cell?: TableCellFragmentRecord) => {
    for (const block of blocks) {
      work.tick();
      if (block.kind === 'paragraph') {
        if (cell) rotatedCellOf.set(block, cell);
        continue;
      }
      for (const row of block.rows)
        for (const inner of row.cells)
          markRotated(inner.blocks, cell ?? (inner.textDirection ? inner : undefined));
    }
  };
  forEachSemanticStory(layout, (root) => markRotated(root.host.fragments));
  const rotatedBuffers = new Map<
    string,
    {
      cell: TableCellFragmentRecord;
      x: number;
      y: number;
      page: number;
      commands: Commands;
      /** Behind-text drawings of the cell, turned with it but painted under the page's text. */
      behind: Commands;
    }
  >();
  const outFor = (
    visit: Pick<SemanticSpanVisit, 'story' | 'textboxOwner' | 'page'> & {
      readonly paragraph?: SemanticSpanVisit['paragraph'] | null;
      readonly storyOrigin?: SemanticSpanVisit['storyOrigin'];
    }
  ): Commands => {
    const cell = visit.paragraph && rotatedCellOf.get(visit.paragraph);
    if (cell && visit.storyOrigin) {
      const key = `${visit.page.index}:${cell.id}`;
      let entry = rotatedBuffers.get(key);
      if (!entry) {
        entry = {
          cell,
          x: visit.storyOrigin.x - visit.page.box.x,
          y: visit.storyOrigin.y - visit.page.box.y,
          page: visit.page.index,
          commands: new Commands(work),
          behind: new Commands(work),
        };
        rotatedBuffers.set(key, entry);
      }
      return entry.commands;
    }
    if (visit.story !== 'textbox' || !visit.textboxOwner) return streams[visit.page.index]!;
    let owners = textboxBuffers.get(visit.page.index);
    if (!owners) {
      owners = new Map();
      textboxBuffers.set(visit.page.index, owners);
    }
    let buffer = owners.get(visit.textboxOwner);
    if (!buffer) {
      buffer = new Commands(work);
      owners.set(visit.textboxOwner, buffer);
    }
    return buffer;
  };
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
      out = outFor(visit);
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
        `${color(fill)} rg ${rect(text.bandBox(visit), -visit.page.box.x, -visit.page.box.y, pageHeight(page), true)} f`
      );
    const clipping = visit.paragraph.clipToBox;
    if (clipping)
      out.push(
        `q ${rect(visit.paragraph.box, visit.storyOrigin.x - visit.page.box.x, visit.storyOrigin.y - visit.page.box.y, pageHeight(page))} W n`
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
      const out = outFor(visit);
      const height = pageHeight(pages[visit.page.index]!);
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
  const paintDrawing = async (visit: SemanticDrawingVisit): Promise<string> => {
    const page = pages[visit.page.index]!;
    const d = visit.drawing;
    if (d.kind !== 'anchoredDrawing' || !d.textboxStory) return images.paint(visit, page);
    const story = d.textboxStory;
    const origin = {
      x: visit.drawingOrigin.x + story.contentOffset.x - visit.page.box.x,
      y: visit.drawingOrigin.y + story.contentOffset.y - visit.page.box.y,
    };
    return images.paintTextbox(visit, page, [
      ...decorations(story.fragments, origin.x, origin.y, page, work, visit.page.index),
      ...(textboxBuffers.get(visit.page.index)?.get(d) ?? []),
    ]);
  };
  // Drawings INSIDE a textbox story join their owner's buffer first, so an owner painted
  // later carries them: behind its text at the front of the buffer, in front of it at the
  // end. Deepest first, so a nested textbox is composed before the textbox that holds it.
  const nested = drawings
    .filter((visit) => visit.story === 'textbox' && visit.textboxOwner)
    .sort((a, b) => b.textboxDepth - a.textboxDepth);
  for (const visit of nested) {
    const commands = await paintDrawing(visit);
    if (!commands) continue;
    const buffer = outFor(visit);
    if (visit.paintLayer === 'behind-text') buffer.unshift(commands);
    else buffer.push(commands);
  }
  // Behind-text drawings belong below the owner's text and decoration. A drawing laid out
  // inside a `btLr` cell sits in that cell's upright plane, so it joins the cell's buffer
  // and turns with the text; painted at its published origin it would land beside the cell.
  for (const visit of drawings) {
    if (visit.story === 'textbox' && visit.textboxOwner) continue;
    const commands = await paintDrawing(visit);
    if (visit.paragraph && rotatedCellOf.has(visit.paragraph)) {
      const cell = rotatedCellOf.get(visit.paragraph)!;
      outFor(visit);
      const entry = rotatedBuffers.get(`${visit.page.index}:${cell.id}`)!;
      (visit.paintLayer === 'behind-text' ? entry.behind : entry.commands).push(commands);
      continue;
    }
    (visit.paintLayer === 'behind-text' ? behindStreams : streams)[visit.page.index]!.push(
      commands
    );
  }
  // Each rotated cell's ink turns as one: behind-text drawings under the page's text, the
  // text and in-front drawings over it, both under the same matrix.
  for (const { cell, x, y, page, commands, behind } of rotatedBuffers.values()) {
    const matrix = rotatedCellMatrix(cell.box, x, y, pageHeight(pages[page]!));
    if (behind.length) behindStreams[page]!.push('q', matrix, ...behind, 'Q');
    if (commands.length) streams[page]!.push('q', matrix, ...commands, 'Q');
  }
  // `w:zOrder="front"` puts the page frame over EVERYTHING on the page, in-front drawings
  // included, so it goes into the stream after them, not before.
  for (let i = 0; i < streams.length; i++) streams[i]!.push(...frontBorders[i]!);
  for (let i = 0; i < pages.length; i++) {
    work.check();
    pages[i]!.node.addContentStream(
      doc.context.register(
        flateStream(doc.context, behindStreams[i]!.join('\n') + '\n' + streams[i]!.join('\n'))
      )
    );
  }
  for (const face of text.faces.values()) await face.finish(work);
  if (includeComments) comments(doc, pages, layout, work);
}
