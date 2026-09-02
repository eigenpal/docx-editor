import {
  ExportResourceError,
  exportDestinationNamed,
  type ExportDestinationGeometry,
  type ExportSemanticLayout,
} from '@docx-editor.dev/core/export';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import {
  baselineShiftPtOf,
  exportSourceRangeOf,
  forEachSemanticSpan,
  styleForFontSlot,
} from '@docx-editor.dev/core/layout';
import { coreBoxToPdfRect, coreYToPdfY } from './pdf-coordinates.ts';
import {
  createFidelityDiagnosticCollector,
  pdfApproximationDiagnostic,
  pdfUnsupportedDiagnostic,
  type PdfFidelityDiagnostic,
  type PdfFidelityStoryKind,
} from './pdf-fidelity-diagnostics.ts';
import type {
  PdfDocumentMetadata,
  PdfPaintCommand,
  PdfPaintPlan,
  PdfRect,
} from './pdf-paint-types.ts';
import {
  appendPaintCommands,
  createPdfPaintPlan,
  pdfBeginPage,
  pdfDestination,
  pdfExternalLink,
  pdfInternalLink,
  pdfTextSpan,
} from './pdf-paint-types.ts';
import {
  pdfDisplayText,
  pdfRunStyleApproximations,
  pdfTextStyleFromResolvedRunStyle,
} from './pdf-text-style.ts';
import { validateCommandCount, validatePageCount } from './pdf-paint-bounds.ts';

/** Result of planning paint commands from one export layout snapshot. @public */
export interface PdfPagePlanResult {
  readonly plan: PdfPaintPlan;
  readonly diagnostics: readonly PdfFidelityDiagnostic[];
  readonly pageCount: number;
}

const TEXT_STORY_KINDS = new Set<PdfFidelityStoryKind>(['body', 'header', 'footer']);
const PLANNER_ABORT_BATCH_SIZE = 256;
const DESTINATION_CARET_WIDTH_PT = 1;

/** Optional planner controls. Existing callers may omit this argument. @public */
export interface PdfPagePlanOptions {
  readonly signal?: AbortSignal;
}

interface CommandTally {
  count: number;
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return;
  throw new ExportResourceError('aborted', message, { cause: signal.reason });
}

function pushBoundedCommand(
  commands: PdfPaintCommand[],
  command: PdfPaintCommand,
  tally: CommandTally
): void {
  tally.count += 1;
  validateCommandCount(tally.count);
  commands.push(command);
}

function pageRelativeBox(
  page: PageRecord,
  absolute: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>
): PdfRect {
  return coreBoxToPdfRect(
    Object.freeze({
      x: absolute.x - page.box.x,
      y: absolute.y - page.box.y,
      width: absolute.width,
      height: absolute.height,
    }),
    page.box.height
  );
}

function pageRelativeBaselineY(
  page: PageRecord,
  storyOriginY: number,
  lineY: number,
  lineBaseline: number,
  baselineShiftPt: number
): number {
  const coreY = storyOriginY - page.box.y + lineY + lineBaseline - baselineShiftPt;
  return coreYToPdfY(coreY, page.box.height);
}

function markerLineBaseline(
  fragment: ParagraphFragmentRecord,
  fontSizePt: number
): Readonly<{ readonly lineY: number; readonly baseline: number }> {
  const firstLine = fragment.lines[0];
  if (firstLine) {
    return Object.freeze({ lineY: firstLine.box.y, baseline: firstLine.baseline });
  }
  const markerBox = fragment.marker?.box;
  const boxHeight = markerBox && markerBox.height > 0 ? markerBox.height : fontSizePt;
  const fallback = fontSizePt > 0 ? Math.min(fontSizePt, boxHeight) : boxHeight;
  return Object.freeze({
    lineY: markerBox?.y ?? 0,
    baseline: fallback > 0 ? fallback : 0,
  });
}

function recordRunStyleApproximations(
  page: PageRecord,
  recordId: string,
  style: StyleSpanRecord['style'],
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): void {
  const approximations = pdfRunStyleApproximations(style);
  for (let index = 0; index < approximations.length; index += 1) {
    const approximation = approximations[index]!;
    diagnostics.push(
      pdfApproximationDiagnostic({
        feature: approximation.feature,
        pageIndex: page.index,
        recordKind: 'styleSpan',
        recordId,
        reason: approximation.reason,
      })
    );
  }
}

function appendParagraphMarkerCommands(
  page: PageRecord,
  storyOrigin: Readonly<{ readonly x: number; readonly y: number }>,
  fragment: ParagraphFragmentRecord,
  commands: PdfPaintCommand[],
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  tally: CommandTally
): void {
  const marker = fragment.marker;
  if (!marker || marker.text.length === 0) return;
  const coreRect = Object.freeze({
    x: storyOrigin.x + marker.box.x - page.box.x,
    y: storyOrigin.y + marker.box.y - page.box.y,
    width: marker.box.width,
    height: marker.box.height,
  });
  const faceStyle = styleForFontSlot(marker.style, undefined);
  const baselineShiftPt = baselineShiftPtOf(faceStyle);
  const lineBaseline = markerLineBaseline(fragment, faceStyle.fontSizePt);
  pushBoundedCommand(
    commands,
    pdfTextSpan(
      coreBoxToPdfRect(coreRect, page.box.height),
      pageRelativeBaselineY(
        page,
        storyOrigin.y,
        lineBaseline.lineY,
        lineBaseline.baseline,
        baselineShiftPt
      ),
      pdfDisplayText(marker.text, marker.style),
      pdfTextStyleFromResolvedRunStyle(marker.style)
    ),
    tally
  );
  recordRunStyleApproximations(page, fragment.paragraphId, marker.style, diagnostics);
}

function shouldPaintSpan(span: StyleSpanRecord): boolean {
  if (span.style.hidden) return false;
  if (span.equation) return false;
  if (span.text.length === 0 && span.range.end <= span.range.start) return false;
  return true;
}

function pdfMetadataFromLayout(layout: ExportSemanticLayout): PdfDocumentMetadata {
  const source = layout.documentMetadata;
  if (!source) return Object.freeze({});
  const mapped: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
  } = {};
  if (source.title !== undefined) mapped.title = source.title;
  if (source.creator !== undefined) mapped.author = source.creator;
  if (source.subject !== undefined) mapped.subject = source.subject;
  if (source.keywords !== undefined) mapped.keywords = source.keywords;
  return mapped;
}

function destinationRect(page: PageRecord, destination: ExportDestinationGeometry): PdfRect | null {
  const height = destination.pageContent.height;
  if (!(height > 0)) return null;
  return coreBoxToPdfRect(
    Object.freeze({
      x: destination.pageStack.x - page.box.x,
      y: destination.pageStack.y - page.box.y,
      width: DESTINATION_CARET_WIDTH_PT,
      height,
    }),
    page.box.height
  );
}

function appendNamedDestinations(
  layout: ExportSemanticLayout,
  pageCommands: Map<number, PdfPaintCommand[]>,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  tally: CommandTally,
  signal: AbortSignal | undefined
): void {
  const destinations = layout.destinations;
  if (!destinations) return;
  for (let index = 0; index < destinations.length; index += 1) {
    if (index > 0 && index % PLANNER_ABORT_BATCH_SIZE === 0) {
      throwIfAborted(signal, 'PDF page planning was aborted');
    }
    const destination = destinations[index]!;
    const page = layout.pages[destination.pageIndex];
    const pageList = pageCommands.get(destination.pageIndex);
    if (!page || !pageList) {
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: 'internal-destination',
          pageIndex: destination.pageIndex,
          recordKind: 'destination',
          recordId: destination.anchor.name,
          reason: `Named destination "${destination.anchor.name}" does not resolve to an exported page`,
        })
      );
      continue;
    }
    const rect = destinationRect(page, destination);
    if (!rect) {
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: 'internal-destination',
          pageIndex: destination.pageIndex,
          recordKind: 'destination',
          recordId: destination.anchor.name,
          reason: `Named destination "${destination.anchor.name}" has no usable caret geometry`,
        })
      );
      continue;
    }
    pushBoundedCommand(pageList, pdfDestination(destination.anchor.name, rect), tally);
  }
}

function appendSpanLinkCommands(
  layout: ExportSemanticLayout,
  page: PageRecord,
  span: StyleSpanRecord,
  rect: PdfRect,
  commands: PdfPaintCommand[],
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  tally: CommandTally
): void {
  const link = span.link;
  if (!link) return;
  if (link.kind === 'external') {
    if (link.href) {
      pushBoundedCommand(commands, pdfExternalLink(rect, link.href), tally);
    }
    return;
  }
  if (link.kind !== 'internal' || link.href === null) return;
  const name = link.anchor;
  if (!name) return;
  const destination = exportDestinationNamed(layout, name);
  if (!destination) {
    diagnostics.push(
      pdfUnsupportedDiagnostic({
        feature: 'internal-link',
        pageIndex: page.index,
        recordKind: 'spanLink',
        recordId: link.id,
        reason: `Internal destination "${name}" is unresolved in the export layout`,
      })
    );
    return;
  }
  pushBoundedCommand(commands, pdfInternalLink(rect, destination.anchor.name), tally);
}

function appendSpanCommands(
  layout: ExportSemanticLayout,
  page: PageRecord,
  storyOrigin: Readonly<{ readonly x: number; readonly y: number }>,
  lineY: number,
  lineBaseline: number,
  span: StyleSpanRecord,
  absoluteBox: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>,
  commands: PdfPaintCommand[],
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  tally: CommandTally
): void {
  if (!shouldPaintSpan(span)) {
    if (span.equation) {
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: 'equation',
          pageIndex: page.index,
          recordKind: 'equationSpan',
          recordId: span.range.paragraphId,
          reason: 'Office Math geometry is not encoded in the PDF paint slice yet',
        })
      );
    }
    return;
  }

  if (span.tabLeader) {
    diagnostics.push(
      pdfUnsupportedDiagnostic({
        feature: 'tab-leader',
        pageIndex: page.index,
        recordKind: 'styleSpan',
        recordId: span.range.paragraphId,
        reason: 'Tab leader decoration is not encoded in the PDF paint slice yet',
      })
    );
  }

  const faceStyle = styleForFontSlot(span.style, span.fontSlot);
  const rect = pageRelativeBox(page, absoluteBox);
  const baseline = pageRelativeBaselineY(
    page,
    storyOrigin.y,
    lineY,
    lineBaseline,
    baselineShiftPtOf(faceStyle)
  );
  pushBoundedCommand(
    commands,
    pdfTextSpan(
      rect,
      baseline,
      pdfDisplayText(span.text, span.style),
      pdfTextStyleFromResolvedRunStyle(span.style, span.fontSlot)
    ),
    tally
  );
  recordRunStyleApproximations(page, span.range.paragraphId, span.style, diagnostics);

  appendSpanLinkCommands(layout, page, span, rect, commands, diagnostics, tally);
}

function recordTableDiagnostics(
  page: PageRecord,
  block: Extract<BlockFragmentRecord, { readonly kind: 'table' }>,
  story: PdfFidelityStoryKind | null,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): void {
  diagnostics.push(
    pdfUnsupportedDiagnostic({
      feature: 'table',
      pageIndex: page.index,
      recordKind: 'tableFragment',
      recordId: block.id,
      story,
      reason: 'Table structure and decoration are unsupported; cell text remains painted',
    })
  );
}

function recordDrawingDiagnostics(
  page: PageRecord,
  recordKind: string,
  recordId: string | null,
  story: PdfFidelityStoryKind | null,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): void {
  diagnostics.push(
    pdfUnsupportedDiagnostic({
      feature: 'drawing',
      pageIndex: page.index,
      recordKind,
      recordId,
      story,
      reason: 'Drawing painting is not encoded in the PDF paint slice yet',
    })
  );
}

function recordNoteAreaDiagnostics(
  page: PageRecord,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): void {
  if (page.footnotes) {
    diagnostics.push(
      pdfUnsupportedDiagnostic({
        feature: 'footnotes',
        pageIndex: page.index,
        recordKind: 'noteArea',
        recordId: page.footnotes.kind,
        story: 'footnote',
        reason: 'Footnote areas are not encoded in the PDF paint slice yet',
      })
    );
  }
  if (page.endnotes) {
    diagnostics.push(
      pdfUnsupportedDiagnostic({
        feature: 'endnotes',
        pageIndex: page.index,
        recordKind: 'noteArea',
        recordId: page.endnotes.kind,
        story: 'endnote',
        reason: 'Endnote areas are not encoded in the PDF paint slice yet',
      })
    );
  }
}

function visitBlocksForUnsupported(
  page: PageRecord,
  blocks: readonly BlockFragmentRecord[],
  story: PdfFidelityStoryKind | null,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): void {
  for (const block of blocks) {
    if (block.kind === 'table') {
      recordTableDiagnostics(page, block, story, diagnostics);
      continue;
    }
    for (const line of block.lines) {
      if (line.drawings?.length) {
        for (const drawing of line.drawings) {
          recordDrawingDiagnostics(page, 'inlineDrawing', drawing.paragraphId, story, diagnostics);
        }
      }
    }
    if (block.shading) {
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: 'paragraph-shading',
          pageIndex: page.index,
          recordKind: 'paragraphFragment',
          recordId: block.id,
          story,
          reason: 'Paragraph shading fills are not encoded in the PDF paint slice yet',
        })
      );
    }
    if (block.borders?.length || block.bottomBorder) {
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: 'paragraph-border',
          pageIndex: page.index,
          recordKind: 'paragraphFragment',
          recordId: block.id,
          story,
          reason: 'Paragraph borders are not encoded in the PDF paint slice yet',
        })
      );
    }
  }
}

function visitHeaderFooterUnsupported(
  page: PageRecord,
  story: HeaderFooterStoryRecord | undefined,
  storyKind: 'header' | 'footer',
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): void {
  if (!story) return;
  visitBlocksForUnsupported(page, story.fragments, storyKind, diagnostics);
  if (story.anchoredDrawings?.length) {
    for (const drawing of story.anchoredDrawings) {
      recordDrawingDiagnostics(
        page,
        'anchoredDrawing',
        drawing.accessibility?.label ?? null,
        storyKind,
        diagnostics
      );
    }
  }
}

function visitPageUnsupported(
  page: PageRecord,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): void {
  visitBlocksForUnsupported(page, page.fragments, 'body', diagnostics);
  visitHeaderFooterUnsupported(page, page.header, 'header', diagnostics);
  visitHeaderFooterUnsupported(page, page.footer, 'footer', diagnostics);
  if (page.anchoredDrawings?.length) {
    for (const drawing of page.anchoredDrawings) {
      recordDrawingDiagnostics(
        page,
        'anchoredDrawing',
        drawing.accessibility?.label ?? null,
        'body',
        diagnostics
      );
    }
  }
  if (page.columnSeparators?.length) {
    diagnostics.push(
      pdfUnsupportedDiagnostic({
        feature: 'column-separator',
        pageIndex: page.index,
        recordKind: 'layoutBox',
        recordId: page.id,
        story: 'body',
        reason: 'Column separator rules are not encoded in the PDF paint slice yet',
      })
    );
  }
  recordNoteAreaDiagnostics(page, diagnostics);
}

/** Plans immutable PDF paint commands from one export layout snapshot. @public */
export function planPdfPaintFromLayout(
  layout: ExportSemanticLayout,
  options: PdfPagePlanOptions = {}
): PdfPagePlanResult {
  throwIfAborted(options.signal, 'PDF page planning was aborted');
  validatePageCount(layout.pages.length);
  const commands: PdfPaintCommand[] = [];
  const diagnostics = createFidelityDiagnosticCollector();
  const pageCommands = new Map<number, PdfPaintCommand[]>();
  const tally: CommandTally = { count: 0 };

  for (const page of layout.pages) {
    throwIfAborted(options.signal, 'PDF page planning was aborted');
    const pageList: PdfPaintCommand[] = [];
    pushBoundedCommand(pageList, pdfBeginPage(page.index, page.box.width, page.box.height), tally);
    pageCommands.set(page.index, pageList);
    visitPageUnsupported(page, diagnostics);
  }

  appendNamedDestinations(layout, pageCommands, diagnostics, tally, options.signal);
  throwIfAborted(options.signal, 'PDF page planning was aborted');

  let spanVisits = 0;
  forEachSemanticSpan(layout as SemanticLayout, (visit) => {
    spanVisits += 1;
    if (spanVisits % PLANNER_ABORT_BATCH_SIZE === 0) {
      throwIfAborted(options.signal, 'PDF page planning was aborted');
    }
    const storyKind = visit.rootStory as PdfFidelityStoryKind;
    if (!TEXT_STORY_KINDS.has(storyKind)) return;
    if (exportSourceRangeOf(visit.span) === null && visit.span.text.length === 0) return;

    const pageCommandsForVisit = pageCommands.get(visit.page.index);
    if (!pageCommandsForVisit) return;

    appendSpanCommands(
      layout,
      visit.page,
      visit.storyOrigin,
      visit.line.box.y,
      visit.line.baseline,
      visit.span,
      visit.absoluteBox,
      pageCommandsForVisit,
      diagnostics,
      tally
    );
  });

  for (const page of layout.pages) {
    throwIfAborted(options.signal, 'PDF page planning was aborted');
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      appendParagraphMarkerCommands(
        page,
        Object.freeze({ x: page.contentBox.x, y: page.contentBox.y }),
        fragment,
        pageCommands.get(page.index) ?? commands,
        diagnostics,
        tally
      );
    }
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      for (const fragment of story.fragments) {
        if (fragment.kind !== 'paragraph') continue;
        appendParagraphMarkerCommands(
          page,
          Object.freeze({ x: story.box.x, y: story.box.y }),
          fragment,
          pageCommands.get(page.index) ?? commands,
          diagnostics,
          tally
        );
      }
    }
  }

  for (const page of layout.pages) {
    const planned = pageCommands.get(page.index);
    if (planned) appendPaintCommands(commands, planned);
  }
  validateCommandCount(commands.length);

  return Object.freeze({
    plan: createPdfPaintPlan(commands, pdfMetadataFromLayout(layout)),
    diagnostics: diagnostics.snapshot(),
    pageCount: layout.pages.length,
  });
}
