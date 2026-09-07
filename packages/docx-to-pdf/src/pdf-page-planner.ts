/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  ExportResourceError,
  exportDestinationNamed,
  type ExportDestinationGeometry,
  type ExportSemanticLayout,
} from '@docx-editor.dev/core/export';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LineRecord,
  PageRecord,
  StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import {
  baselineShiftPtOf,
  exportSourceRangeOf,
  iterateSemanticFillHostSpans,
  iterateSemanticPaintHosts,
  iterateSemanticParagraphOrder,
  paragraphFragmentsOfBlocks,
  styleForFontSlot,
  type SemanticFillHostVisit,
  type SemanticRootStoryKind,
} from '@docx-editor.dev/core/layout';
import { coreBoxToPdfRect } from './pdf-coordinates.ts';
import {
  compatibleWordMacos300DpiTextStyle,
  quantizeWordMacos300Dpi,
  quantizeWordMacos300DpiLineRect,
  quantizeWordMacos300DpiRect,
  type PdfCompatibilityProfile,
} from './pdf-compatibility-profile.ts';
import {
  createPdfFillBacking,
  paintedFillForParagraph,
  pdfTextForeground,
  unreadableWithoutFillDiagnostic,
  visitBlocksForPublishedFills,
  type PdfFillBacking,
} from './pdf-fill-contrast.ts';
import { visitBlocksForPublishedBorders } from './pdf-paragraph-borders.ts';
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
  applyPdfRevisionPresentation,
  pdfRevisionPresentationDiagnostics,
  pdfRevisionPresentationOf,
} from './pdf-revision-presentation.ts';
import {
  pdfDisplayText,
  pdfRunStyleApproximations,
  pdfTextStyleFromResolvedRunStyle,
} from './pdf-text-style.ts';
import { validateCommandCount, validatePageCount } from './pdf-paint-bounds.ts';
import {
  plannedUnderlineExcludesTrailingSpace,
  plannedUnderlineGapAbsorptionPt,
} from './pdf-underline-absorption-plan.ts';
import { excludeTrailingUnderlineSpace } from './pdf-underline-geometry.ts';
import { compatibleSpanBaseline } from './pdf-span-geometry.ts';
import { plannedParagraphMarkerCommand } from './pdf-paragraph-marker-planner.ts';

/** Result of planning paint commands from one export layout snapshot. @public */
export interface PdfPagePlanResult {
  readonly plan: PdfPaintPlan;
  readonly diagnostics: readonly PdfFidelityDiagnostic[];
  readonly pageCount: number;
}

const ROOT_TEXT_STORY_KINDS = new Set<SemanticRootStoryKind>(['body', 'header', 'footer']);
const PLANNER_ABORT_BATCH_SIZE = 256;
const DESTINATION_CARET_WIDTH_PT = 1;
const NON_PAINTING_CONTROL_CHARS = new Set(['\f', '\n', '\r', '\t']);

/** Optional planner controls. Existing callers may omit this argument. @public */
export interface PdfPagePlanOptions {
  readonly signal?: AbortSignal;
  readonly compatibilityProfile?: PdfCompatibilityProfile;
}

interface CommandTally {
  count: number;
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return;
  throw new ExportResourceError('aborted', message, { cause: signal.reason });
}

/**
 * Yield one timer-phase turn so AbortSignal timeouts can run.
 *
 * The declared Node engine (`^20.16.0 || >=22.3.0`) also has `setImmediate`,
 * but that callback runs in the check phase after timers. A yield there can
 * finish a span batch before `setTimeout` / `AbortSignal.timeout` abort runs.
 * `setTimeout(0)` stays on the same queue as those timer aborts and does not
 * require `setImmediate`.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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

function compatibleRect(rect: PdfRect, profile: PdfCompatibilityProfile | undefined): PdfRect {
  return profile === 'word-macos-300dpi' ? quantizeWordMacos300DpiRect(rect) : rect;
}

function compatibleScalar(value: number, profile: PdfCompatibilityProfile | undefined): number {
  return profile === 'word-macos-300dpi' ? quantizeWordMacos300Dpi(value) : value;
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

function shouldPaintSpan(span: StyleSpanRecord): boolean {
  if (span.style.hidden) return false;
  if (span.equation) return false;
  if (span.text.length === 0 && span.range.end <= span.range.start) return false;
  return true;
}

function hasUsablePaintGeometry(
  box: Readonly<{ readonly width: number; readonly height: number }>
): boolean {
  return box.width > 0 && box.height > 0;
}

function isNonPaintingControlSpan(span: StyleSpanRecord): boolean {
  if (span.text.length === 0) return false;
  for (const codeUnit of span.text) {
    if (!NON_PAINTING_CONTROL_CHARS.has(codeUnit)) return false;
  }
  return true;
}

function shouldPaintSpanText(
  span: StyleSpanRecord,
  absoluteBox: Readonly<{ readonly width: number; readonly height: number }>
): boolean {
  if (!shouldPaintSpan(span)) return false;
  if (!hasUsablePaintGeometry(absoluteBox)) return false;
  if (isNonPaintingControlSpan(span)) return false;
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
  storyKind: PdfFidelityStoryKind,
  storyOrigin: Readonly<{ readonly x: number; readonly y: number }>,
  lineX: number,
  lineY: number,
  lineBaseline: number,
  span: StyleSpanRecord,
  line: LineRecord,
  paragraphOrder: ReadonlyMap<string, number>,
  absoluteBox: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>,
  commands: PdfPaintCommand[],
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  tally: CommandTally,
  backing: PdfFillBacking,
  profile: PdfCompatibilityProfile | undefined
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

  if (!shouldPaintSpanText(span, absoluteBox)) {
    if (hasUsablePaintGeometry(absoluteBox)) {
      const rect = compatibleRect(pageRelativeBox(page, absoluteBox), profile);
      appendSpanLinkCommands(layout, page, span, rect, commands, diagnostics, tally);
    }
    return;
  }

  const faceStyle = styleForFontSlot(span.style, span.fontSlot);
  const baseRect = pageRelativeBox(page, absoluteBox);
  const rect =
    profile === 'word-macos-300dpi'
      ? quantizeWordMacos300DpiLineRect(baseRect, storyOrigin.x - page.box.x + lineX)
      : baseRect;
  const baseline = compatibleSpanBaseline(
    page,
    storyOrigin.y,
    lineY,
    lineBaseline,
    baselineShiftPtOf(faceStyle),
    storyKind === 'footer',
    profile
  );
  const presentation = pdfRevisionPresentationOf(span.revisions);
  let textStyle = pdfTextStyleFromResolvedRunStyle(span.style, span.fontSlot);
  if (presentation) {
    textStyle = applyPdfRevisionPresentation(textStyle, presentation);
  }
  textStyle = compatibleWordMacos300DpiTextStyle(textStyle, profile);
  for (const diagnostic of pdfRevisionPresentationDiagnostics({
    pageIndex: page.index,
    paragraphId: span.range.paragraphId,
    revisions: span.revisions,
    props: span.props,
    presentation,
  })) {
    diagnostics.push(diagnostic);
  }
  const absorption =
    profile === 'word-macos-300dpi'
      ? plannedUnderlineGapAbsorptionPt({
          page,
          storyOrigin,
          lineX,
          line,
          span,
          leftRect: rect,
          profile,
          paragraphOrder,
        })
      : undefined;
  const textCommand = excludeTrailingUnderlineSpace(
    pdfTextSpan(rect, baseline, pdfDisplayText(span.text, span.style), textStyle, absorption),
    plannedUnderlineExcludesTrailingSpace(line, span, profile)
  );
  pushBoundedCommand(commands, textCommand, tally);
  recordRunStyleApproximations(page, span.range.paragraphId, span.style, diagnostics);
  const omittedFill = span.style.shading
    ? `#${span.style.shading}`
    : span.style.highlight
      ? `highlight:${span.style.highlight}`
      : null;
  const unreadable = unreadableWithoutFillDiagnostic({
    pageIndex: page.index,
    paragraphId: span.range.paragraphId,
    story: storyKind,
    foreground: pdfTextForeground(textStyle.color),
    paintedBackground: paintedFillForParagraph(backing, span.range.paragraphId),
    omittedFill,
  });
  if (unreadable) diagnostics.push(unreadable);

  appendSpanLinkCommands(
    layout,
    page,
    span,
    compatibleRect(rect, profile),
    commands,
    diagnostics,
    tally
  );
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

function* visitNoteAreaUnsupported(
  page: PageRecord,
  kind: 'footnotes' | 'endnotes',
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): Generator<void> {
  const area = page[kind];
  if (!area) return;
  diagnostics.push(
    pdfUnsupportedDiagnostic({
      feature: kind,
      pageIndex: page.index,
      recordKind: 'noteArea',
      recordId: area.kind,
      story: kind === 'footnotes' ? 'footnote' : 'endnote',
      reason:
        kind === 'footnotes'
          ? 'Footnote areas are not encoded in the PDF paint slice yet'
          : 'Endnote areas are not encoded in the PDF paint slice yet',
    })
  );
  yield;
  if (area.separator) yield;
  for (let index = 0; index < area.notes.length; index += 1) yield;
}

function* visitBlocksForUnsupported(
  page: PageRecord,
  blocks: readonly BlockFragmentRecord[],
  story: PdfFidelityStoryKind | null,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): Generator<void> {
  for (const block of blocks) {
    if (block.kind === 'table') {
      recordTableDiagnostics(page, block, story, diagnostics);
      yield;
      for (const row of block.rows) {
        if (row.cells.length === 0) {
          yield;
          continue;
        }
        for (const cell of row.cells) {
          yield;
          yield* visitBlocksForUnsupported(page, cell.blocks, story, diagnostics);
        }
      }
      continue;
    }
    yield;
    for (const line of block.lines) {
      if (line.drawings?.length) {
        for (const drawing of line.drawings) {
          recordDrawingDiagnostics(page, 'inlineDrawing', drawing.paragraphId, story, diagnostics);
          yield;
        }
      }
      yield;
    }
    if (block.markRevisions && block.markRevisions.length > 0) {
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: 'revision-paragraph-mark',
          pageIndex: page.index,
          recordKind: 'paragraphFragment',
          recordId: block.id,
          story,
          reason: 'Tracked paragraph marks are not painted in the PDF slice',
        })
      );
      yield;
    }
  }
}

function* visitHeaderFooterUnsupported(
  page: PageRecord,
  story: HeaderFooterStoryRecord | undefined,
  storyKind: 'header' | 'footer',
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): Generator<void> {
  if (!story) return;
  yield* visitBlocksForUnsupported(page, story.fragments, storyKind, diagnostics);
  if (story.anchoredDrawings?.length) {
    for (const drawing of story.anchoredDrawings) {
      recordDrawingDiagnostics(
        page,
        'anchoredDrawing',
        drawing.accessibility?.label ?? null,
        storyKind,
        diagnostics
      );
      yield;
    }
  }
}

function* visitPageUnsupported(
  page: PageRecord,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): Generator<void> {
  yield;
  yield* visitBlocksForUnsupported(page, page.fragments, 'body', diagnostics);
  yield* visitHeaderFooterUnsupported(page, page.header, 'header', diagnostics);
  yield* visitHeaderFooterUnsupported(page, page.footer, 'footer', diagnostics);
  if (page.anchoredDrawings?.length) {
    for (const drawing of page.anchoredDrawings) {
      recordDrawingDiagnostics(
        page,
        'anchoredDrawing',
        drawing.accessibility?.label ?? null,
        'body',
        diagnostics
      );
      yield;
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
    yield;
  }
  yield* visitNoteAreaUnsupported(page, 'footnotes', diagnostics);
  yield* visitNoteAreaUnsupported(page, 'endnotes', diagnostics);
}

function* planPageDiagnostics(
  layout: ExportSemanticLayout,
  pageCommands: Map<number, PdfPaintCommand[]>,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  tally: CommandTally,
  profile: PdfCompatibilityProfile | undefined
): Generator<void> {
  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
    const page = layout.pages[pageIndex]!;
    const pageList: PdfPaintCommand[] = [];
    pushBoundedCommand(
      pageList,
      pdfBeginPage(
        page.index,
        compatibleScalar(page.box.width, profile),
        compatibleScalar(page.box.height, profile)
      ),
      tally
    );
    pageCommands.set(page.index, pageList);
    yield* visitPageUnsupported(page, diagnostics);
  }
}

function reviewArtifactReason(
  kind: 'comment' | 'tracked-change',
  id: string,
  change: string | undefined,
  point: boolean
): string {
  if (kind === 'comment') {
    return `Comment ${id} is not painted; PDF has no comment balloon or range highlight`;
  }
  const role = change ?? 'tracked-change';
  if (point) {
    return `Point review artifact ${id} (${role}) is not painted as a PDF annotation`;
  }
  return `Ranged review artifact ${id} (${role}) is not painted as a PDF annotation`;
}

function* recordReviewArtifactDiagnostics(
  layout: ExportSemanticLayout,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): Generator<void> {
  const artifacts = layout.reviewArtifacts;
  if (!artifacts || artifacts.length === 0) return;
  for (const artifact of artifacts) {
    if (artifact.occurrences.length === 0) {
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: artifact.kind === 'comment' ? 'comment' : 'review-artifact',
          pageIndex: 0,
          recordKind: artifact.kind,
          recordId: artifact.id,
          reason: reviewArtifactReason(
            artifact.kind,
            artifact.id,
            artifact.kind === 'tracked-change' ? artifact.change : undefined,
            false
          ),
        })
      );
      yield;
      continue;
    }
    for (const occurrence of artifact.occurrences) {
      const boxes = occurrence.geometry?.pageContent ?? [];
      const point = boxes.length === 0 || boxes.some((box) => box.width === 0 && box.height >= 0);
      const story = occurrence.story === 'textbox' ? 'textbox' : occurrence.rootStory;
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: artifact.kind === 'comment' ? 'comment' : 'review-artifact',
          pageIndex: occurrence.pageIndex,
          recordKind: artifact.kind,
          recordId: artifact.id,
          story,
          reason: reviewArtifactReason(
            artifact.kind,
            artifact.id,
            artifact.kind === 'tracked-change' ? artifact.change : undefined,
            point
          ),
        })
      );
      yield;
    }
  }
}

function* appendNamedDestinations(
  layout: ExportSemanticLayout,
  pageCommands: Map<number, PdfPaintCommand[]>,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  tally: CommandTally,
  profile: PdfCompatibilityProfile | undefined
): Generator<void> {
  const destinations = layout.destinations;
  if (!destinations) return;
  for (let index = 0; index < destinations.length; index += 1) {
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
      yield;
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
      yield;
      continue;
    }
    pushBoundedCommand(
      pageList,
      pdfDestination(destination.anchor.name, compatibleRect(rect, profile)),
      tally
    );
    yield;
  }
}

function* appendPaintHostLayer(
  layout: ExportSemanticLayout,
  host: SemanticFillHostVisit,
  paragraphOrder: ReadonlyMap<string, number>,
  pageCommands: Map<number, PdfPaintCommand[]>,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  tally: CommandTally,
  backing: PdfFillBacking,
  profile: PdfCompatibilityProfile | undefined
): Generator<void> {
  yield;
  if (!ROOT_TEXT_STORY_KINDS.has(host.rootStory)) return;
  const commands = pageCommands.get(host.page.index);
  if (!commands) return;
  const storyKind: PdfFidelityStoryKind = host.textboxDepth === 0 ? host.rootStory : 'textbox';
  yield* visitBlocksForPublishedFills(
    host.page,
    host.storyOrigin,
    host.fragments,
    storyKind,
    backing,
    (absolute) => compatibleRect(pageRelativeBox(host.page, absolute), profile),
    (command) => {
      pushBoundedCommand(commands, command, tally);
    },
    diagnostics
  );
  yield* visitBlocksForPublishedBorders(
    host.page,
    host.storyOrigin,
    host.fragments,
    storyKind,
    (absolute) => compatibleRect(pageRelativeBox(host.page, absolute), profile),
    (command) => {
      pushBoundedCommand(commands, command, tally);
    },
    diagnostics
  );
  for (const visit of iterateSemanticFillHostSpans(host, paragraphOrder)) {
    if (exportSourceRangeOf(visit.span) === null && visit.span.text.length === 0) {
      yield;
      continue;
    }
    appendSpanCommands(
      layout,
      visit.page,
      storyKind,
      visit.storyOrigin,
      visit.line.box.x,
      visit.line.box.y,
      visit.line.baseline,
      visit.span,
      visit.line,
      paragraphOrder,
      visit.absoluteBox,
      commands,
      diagnostics,
      tally,
      backing,
      profile
    );
    yield;
  }
  for (const fragment of paragraphFragmentsOfBlocks(host.fragments, true)) {
    const command = plannedParagraphMarkerCommand({
      page: host.page,
      storyKind,
      storyOrigin: host.storyOrigin,
      fragment,
      profile,
    });
    if (command) {
      pushBoundedCommand(commands, command, tally);
      recordRunStyleApproximations(
        host.page,
        fragment.paragraphId,
        fragment.marker!.style,
        diagnostics
      );
    }
    yield;
  }
}

function* drainBatched(steps: Generator<void>, signal: AbortSignal | undefined): Generator<void> {
  let visits = 0;
  for (const _ of steps) {
    visits += 1;
    if (visits % PLANNER_ABORT_BATCH_SIZE === 0) {
      throwIfAborted(signal, 'PDF page planning was aborted');
      yield;
    }
  }
}

function finishPaintPlan(
  layout: ExportSemanticLayout,
  pageCommands: Map<number, PdfPaintCommand[]>,
  diagnostics: ReturnType<typeof createFidelityDiagnosticCollector>
): PdfPagePlanResult {
  const commands: PdfPaintCommand[] = [];
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

function* planPdfPaintSteps(
  layout: ExportSemanticLayout,
  signal: AbortSignal | undefined,
  profile: PdfCompatibilityProfile | undefined
): Generator<void, PdfPagePlanResult> {
  throwIfAborted(signal, 'PDF page planning was aborted');
  validatePageCount(layout.pages.length);
  const diagnostics = createFidelityDiagnosticCollector();
  const pageCommands = new Map<number, PdfPaintCommand[]>();
  const tally: CommandTally = { count: 0 };
  const backing = createPdfFillBacking();

  yield* drainBatched(
    planPageDiagnostics(layout, pageCommands, diagnostics, tally, profile),
    signal
  );

  yield* drainBatched(recordReviewArtifactDiagnostics(layout, diagnostics), signal);
  yield* drainBatched(
    appendNamedDestinations(layout, pageCommands, diagnostics, tally, profile),
    signal
  );

  const orderWalk = iterateSemanticParagraphOrder(layout);
  let orderStep = orderWalk.next();
  while (!orderStep.done) {
    throwIfAborted(signal, 'PDF page planning was aborted');
    yield;
    orderStep = orderWalk.next();
  }
  const paragraphOrder = orderStep.value;

  let layerVisits = 0;
  for (const host of iterateSemanticPaintHosts(layout)) {
    for (const _ of appendPaintHostLayer(
      layout,
      host,
      paragraphOrder,
      pageCommands,
      diagnostics,
      tally,
      backing,
      profile
    )) {
      layerVisits += 1;
      if (layerVisits % PLANNER_ABORT_BATCH_SIZE === 0) {
        throwIfAborted(signal, 'PDF page planning was aborted');
        yield;
      }
    }
  }

  return finishPaintPlan(layout, pageCommands, diagnostics);
}

function consumePlanSync(
  layout: ExportSemanticLayout,
  signal: AbortSignal | undefined,
  profile: PdfCompatibilityProfile | undefined
): PdfPagePlanResult {
  const steps = planPdfPaintSteps(layout, signal, profile);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Plans immutable PDF paint commands from one export layout snapshot. @public */
export function planPdfPaintFromLayout(
  layout: ExportSemanticLayout,
  options: PdfPagePlanOptions = {}
): PdfPagePlanResult {
  return consumePlanSync(layout, options.signal, options.compatibilityProfile);
}

/**
 * Async planner used by `exportPdf`. Yields between bounded batches so timer-based
 * AbortSignal aborts can run during planning.
 *
 * @public
 */
export async function planPdfPaintFromLayoutAsync(
  layout: ExportSemanticLayout,
  options: PdfPagePlanOptions = {}
): Promise<PdfPagePlanResult> {
  throwIfAborted(options.signal, 'PDF page planning was aborted');
  await yieldToEventLoop();
  throwIfAborted(options.signal, 'PDF page planning was aborted');
  const steps = planPdfPaintSteps(layout, options.signal, options.compatibilityProfile);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
    await yieldToEventLoop();
    throwIfAborted(options.signal, 'PDF page planning was aborted');
  }
}
