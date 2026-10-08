import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
import {
  cellTabReplayScope,
  shouldReplayCellTab,
  tabDestinationForFlow,
} from './paragraph-tab-flow.ts';
import { growRunBorderLineMetrics, textBandHeightWithBorders } from './run-border-strokes.ts';
import {
  clipLineDrawingsAtTop,
  growPendingLineDrawingExtent,
  lineContentX,
  lineHoldsContent,
  markPendingLineWrapAdvances,
  placeLeadingIgnoredBreaks,
  admittedToNarrowPassage,
} from './pending-line.ts';
import { spaceShrinkWordTail } from './space-shrink-word-tail.ts';
import { wordFollowsOnlyTabs } from './leading-tab-word.ts';
import { scriptLineFloor } from './paragraph-mark-metrics.ts';
import { markRunPropertiesWithoutCharacterStyle } from './paragraph-mark-run.ts';
import { paragraphSpanMetadata } from './paragraph-span-metadata.ts';
import {
  fitsWithSpaceShrink,
  opensWithHangingSpace,
  paragraphEndAt,
} from './paragraph-space-shrink.ts';
import { piecesOfParagraphForDisplay } from './field-projection-walk.ts';
import { bidiSourceBoundaries } from './bidi-piece-coalescing.ts';
export {
  paragraphAlignment,
  alignSpans,
  lineAlignmentMeasure,
  type Alignment,
} from './paragraph-alignment.ts';
import { bidiPieces, paragraphIsRtl } from './rtl-paragraph.ts';

import { PAGE_BREAK_CHAR, type OoxmlNode, type OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  propertiesOfRunContainer as propertiesOf,
  type FieldAwarePiece,
  type FieldPageContext,
  type ModelRange,
  type RunPropertyCascader,
} from './field-projection.ts';
import { DEFAULT_REVISION_DISPLAY_MODE, revisionsVisible } from './revision-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import { cjkChopCutAllowedAt, lineOpenDecisionAt, wordBoundaries } from './cjk-line-break.ts';
import { cjkParagraphBreaks } from './cjk-paragraph-breaks.ts';
import {
  createCjkOpticalFitter,
  appendOpticalCjkCandidate,
  canFitCjkOptically,
} from './cjk-optical-fit.ts';
import {
  compressCjkPieces,
  canHangCjkPunctuation,
  colonLostOpeningBearing,
  cjkColonNaturalWidths,
} from './cjk-spacing.ts';
import { resolveCjkTypography } from './cjk-typography.ts';
import {
  EMPTY_TAB_STOPS,
  tabAdvanceWidth,
  TAB_LEADER_GLYPH,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';
import { SINGLE_LINE_SPACING, applyLineSpacing } from './paragraph-style.ts';
import {
  DEFAULT_RUN_STYLE,
  displayText,
  resolveRunStyle,
  type ResolvedRunStyle,
} from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import {
  createLineExclusionClearance,
  createLineExclusionProbe,
  exclusionZoneAppliesToLine,
} from './line-exclusion-clearance.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import type { MutableChangeSite } from './field-pieces.ts';
import {
  buildInlineDrawingRecord,
  inlineDrawingVerticalLayout,
  measureInlineDrawing,
  repositionInlineDrawingsForBaseline,
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  type InlineDrawingRecord,
} from './drawing-layout.ts';
import {
  remainingWidthAtX,
  snapXToAvailableInterval,
  synthesizeParagraphTopAndBottomZones,
  synthesizeParagraphWrapExclusionZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import type { ScanlineInterval } from './drawing-wrap.ts';
import { createEquationLayouter } from './equation-layout.ts';
import { anchorLineStartsByModelOffset } from './anchor-line-probe.ts';
import * as lineEndSpaces from './line-end-whitespace.ts';
import { chopOversizedWord } from './oversized-word-break.ts';
import {
  breakClearSelector,
  ownParagraphFramedClearZones,
  withOwnClearZones,
  type TextWrappingBreakClear,
} from './text-wrapping-break-clear.ts';
import { canChopPiece, isLayoutOwnedPiece } from './layout-owned-piece.ts';
import type { WordCarryContext } from './word-carry.ts';
import { carryWordAtOptionalHyphens } from './optional-hyphen-break.ts';
import { measuredWidth, styleCutAtHyphen } from './optional-hyphen-joining.ts';
import { collectLineChangeSites } from './paragraph-change-sites.ts';

/**
 * Ignore subpixel rounding from absolute tab positions converted to line-local widths.
 * A tab ending exactly at the margin must not wrap because of floating-point error.
 */
const OVERFLOW_TOLERANCE_PT = 0.001;

import type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
export type { ParagraphFlowOptions } from './paragraph-flow-options.ts';

export { propertiesOf };

import {
  measureFollowingTabSegment,
  placeableContentSuffixes,
  positionalTabDestination,
} from './paragraph-piece-metrics.ts';

// The pending-line record and its budget/freeze helpers live in pending-line.ts;
// re-exported so every existing import through this module stays stable.
import {
  coalesceIdeographicSpans,
  frozenLine,
  growLineMetrics,
  growLineMetricsForText,
  positionedRunMetrics,
  holdsOnlyPageBreak,
  lineBandText,
  isHeightlessWhitespace,
  onlyPageBreaksBefore,
  pendingLineFlowExtent,
  pendingLineFlowExtentAtPlacement,
  type PendingLine,
} from './pending-line.ts';
export {
  coalesceIdeographicSpans,
  frozenLine,
  pendingLineFlowExtent,
  pendingLineFlowExtentAtPlacement,
  type PendingLine,
};

export { indentTwips, MAX_PARAGRAPH_INDENT_TWIPS, paragraphIndent } from './paragraph-indent.ts';

/**
 * Measure and break one paragraph into pending lines at `available` width.
 * Cache hits skip measurement. Span x offsets are paragraph-relative, never page-relative.
 */
export function breakParagraph(
  paragraph: OoxmlNode,
  paragraphId: string,
  indentLeft: number,
  available: number,
  measurer: TextMeasurer,
  cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined,
  cacheKey: string | null,
  inheritedRunProperties: readonly OoxmlProperty[] = [],
  tabStops: ResolvedTabStops = EMPTY_TAB_STOPS,
  pageContext?: FieldPageContext,
  cascadeRuns?: RunPropertyCascader,
  flow?: ParagraphFlowOptions,
  preserveColonAdvances = false
): readonly PendingLine[] {
  const cached = cacheKey !== null && cache ? cache.get(cacheKey) : undefined;
  if (cached) return cached;

  const lineSpacing = flow?.lineSpacing ?? SINGLE_LINE_SPACING;
  // A manual page break inside a table cell keeps its model offset but has no geometry.
  const pageBreaksIgnored = flow?.cellAnchorScope?.inTableCell === true;

  // Collect deleted ranges during projection: removed content has no visible span.
  const deletedRanges: { start: number; end: number }[] = [];
  // Content a resolved view removed leaves no piece either; its site is collected the same
  // way, for the Simple Markup change bar. Kept content carries its sites on the piece.
  const changeSites: MutableChangeSite[] = [];
  const rawPieces = piecesOfParagraphForDisplay(
    paragraph,
    inheritedRunProperties,
    pageContext,
    cascadeRuns,
    flow?.projectLink,
    flow?.noteMarks,
    flow?.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
    deletedRanges,
    flow?.inlineDrawingLayout,
    flow?.themeFonts,
    flow?.projectFieldLink,
    flow?.documentProperties,
    flow?.bodyPageFields ?? false,
    flow?.refFields,
    flow?.revisionAuthorFilter,
    flow?.showFieldCodes,
    flow?.fieldCodeRanges,
    flow?.tocLinkStyleRanges,
    changeSites
  );
  const paragraphRtl =
    flow?.paragraphRtl ??
    paragraphIsRtl(
      propertiesOf(
        'children' in paragraph
          ? paragraph.children.find((child) => child.kind === 'paragraphProperties')
          : undefined
      )
    );
  const allPieces = bidiPieces(
    rawPieces,
    paragraphRtl,
    bidiSourceBoundaries(paragraph),
    pageBreaksIgnored
  );
  const startOffset = Math.max(0, flow?.startOffset ?? 0);
  const carriesSlot = flow?.firstLineAfterLeadingBreaks === true;
  const slotOpen =
    startOffset === 0 || (carriesSlot && onlyPageBreaksBefore(allPieces, startOffset));
  // The first line starts `firstLineOffset` from the paragraph's left indent — right for
  // `w:firstLine`, left (negative) for `w:hanging`. Every later line starts at the indent. A
  // continuation from `startOffset` is no first line, unless only leading breaks precede it.
  const firstLineOffset = slotOpen ? (flow?.firstLineOffset ?? 0) : 0;
  const markerBaselineFloor = slotOpen ? (flow?.firstLineMinimumBaseline ?? 0) : 0;
  const markerAscent = slotOpen ? Math.max(0, flow?.firstLineMarkerAscent ?? 0) : 0;
  // A zero-width projected piece at the start offset (a `w:sym` glyph, a field-code atom)
  // owns no model text, so `end <= startOffset` would drop it. At the paragraph start no
  // earlier fragment can have painted it, so it always stays; a continuation keeps it only
  // in field-code view, where the atom is the continuation's first visible token.
  const visiblePieces = allPieces.flatMap((piece): FieldAwarePiece[] => {
    if (
      piece.end <= startOffset &&
      !(
        (startOffset === 0 || flow?.showFieldCodes) &&
        piece.projected &&
        piece.start === piece.end &&
        piece.start === startOffset
      )
    )
      return [];
    if (piece.start >= startOffset) return [piece];
    const trim = startOffset - piece.start;
    return [
      {
        ...piece,
        text: piece.projected ? piece.text : piece.text.slice(trim),
        start: startOffset,
      },
    ];
  });
  const typography =
    flow?.typography ??
    resolveCjkTypography(
      propertiesOf(
        'children' in paragraph
          ? paragraph.children.find((child) => child.kind === 'paragraphProperties')
          : undefined
      )
    );
  const pieces = compressCjkPieces(visiblePieces, typography, measurer, preserveColonAdvances);
  const colonNaturalWidths = cjkColonNaturalWidths(pieces, visiblePieces, measurer);
  const opticalParagraph =
    typography.settings?.compression !== undefined &&
    typography.settings.compression !== 'doNotCompress' &&
    !flow?.pageExclusionZones?.length &&
    measurer.inkBounds !== undefined &&
    canFitCjkOptically(allPieces);
  const opticalCompression = opticalParagraph && !preserveColonAdvances;
  const placeableSuffixes = placeableContentSuffixes(pieces, pageBreaksIgnored);
  const replayScope = cellTabReplayScope(flow?.cellAnchorScope, rawPieces);
  const endsParagraph = paragraphEndAt(pieces);
  const cjkBreaks = cjkParagraphBreaks(pieces, typography);
  const fitCjkOptically = createCjkOpticalFitter(
    pieces,
    cjkBreaks,
    measurer,
    typography.overflowPunctuation
  );
  const layoutEquation = createEquationLayouter(measurer, flow?.equationCacheToken);
  const equationLayoutOf = (piece: FieldAwarePiece) =>
    piece.equation ? layoutEquation(piece.equation, piece.style) : null;
  if (pieces.length === 0 && flow?.suppressEmptyPlaceholderLine) {
    return [];
  }
  // Mark face (CT_PPr/rPr), not content inheritance: it sizes a line with nothing on it.
  const markProps = flow?.markRunProperties ?? inheritedRunProperties;
  const emptyStyle =
    markProps.length === 0 ? DEFAULT_RUN_STYLE : resolveRunStyle(markProps, flow?.themeFonts);
  // A line with content never takes the mark's size (`paragraph-mark-metrics.ts`).
  const cascadeStyle =
    markProps === inheritedRunProperties
      ? emptyStyle
      : inheritedRunProperties.length === 0
        ? DEFAULT_RUN_STYLE
        : resolveRunStyle(inheritedRunProperties, flow?.themeFonts);
  // The floor of a script line reads the mark's vertical alignment WITHOUT its character style
  // (`paragraph-mark-run.ts`).
  const unstyledMark = markRunPropertiesWithoutCharacterStyle(markProps);
  const unstyledMarkStyle =
    unstyledMark === markProps ? emptyStyle : resolveRunStyle(unstyledMark, flow?.themeFonts);
  // Before its first piece a line is estimated from the shorter of the unstyled mark and the
  // runs' cascade: a small direct mark usually carries the size of its runs, and a taller one
  // never grows the line. Heights, not sizes, compare, since faces differ. Only an empty
  // paragraph's line, which has no piece to come, reads the whole mark.
  const lineStartStyle =
    pieces.length === 0
      ? emptyStyle
      : measurer.lineMetrics(unstyledMarkStyle).height < measurer.lineMetrics(cascadeStyle).height
        ? unstyledMarkStyle
        : cascadeStyle;
  const rightEdge = indentLeft + available;
  const contentLeft = flow?.contentLeft ?? indentLeft;
  const contentRight = flow?.contentRight ?? rightEdge;
  const contentOriginX = flow?.contentOriginX ?? 0;
  // The right-to-left line's leading (right) indent, from the paragraph's full measure.
  const rtlLeadingIndent = Math.max(0, (flow?.marginExtent?.right ?? rightEdge) - rightEdge);
  const wrapRight = Math.min(contentRight, contentOriginX + rightEdge);
  const lines: PendingLine[] = [];
  let previousLineCut = false; // The last line closed inside a word the oversized cut split.
  let alignedTabRight = 0;
  let line: PendingLine = {
    spans: [],
    start: startOffset,
    end: startOffset,
    drawings: [],
    width: 0,
    height: 0,
    baseline: 0,
    leading: 0,
    trailingSpacing: 0,
  };
  const anchorLineTopByModelStart = new Map<number, number>();

  // The break-time wrap synthesis follows the published records: a drawing the display mode
  // resolves away publishes no record, so it must reserve no line top and carve no hole.
  const anchorDisplayMode = flow?.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;

  // A remainder re-broken on a later page (`startOffset`) holds only the anchors in its own
  // text. A float anchored before it stays with the earlier lines; its band reaches this page
  // only through the zones the page publishes.
  const topAndBottomAnchorStarts = (() => {
    const starts = new Set<number>();
    if (!flow?.inlineDrawingLayout) return starts;
    const offsets = drawingModelOffsetsInParagraph(paragraph);
    for (const atom of anchoredDrawingAtomsInParagraph(paragraph, flow.inlineDrawingLayout)) {
      if (
        !revisionsVisible(atom.revisions, anchorDisplayMode, flow?.revisionAuthorFilter) ||
        revisionMarkupHidesDrawing(atom.revisions, anchorDisplayMode, flow?.revisionAuthorFilter)
      )
        continue;
      if (atom.projection.wrap !== 'topAndBottom') continue;
      const modelStart = offsets.get(atom.atomId);
      if (modelStart !== undefined && modelStart >= startOffset) starts.add(modelStart);
    }
    return starts;
  })();

  const wrapAnchorStarts = (() => {
    const starts = new Set<number>();
    if (!flow?.inlineDrawingLayout) return starts;
    const offsets = drawingModelOffsetsInParagraph(paragraph);
    for (const atom of anchoredDrawingAtomsInParagraph(paragraph, flow.inlineDrawingLayout)) {
      if (
        !revisionsVisible(atom.revisions, anchorDisplayMode, flow?.revisionAuthorFilter) ||
        revisionMarkupHidesDrawing(atom.revisions, anchorDisplayMode, flow?.revisionAuthorFilter)
      )
        continue;
      if (
        atom.projection.wrap === 'topAndBottom' ||
        atom.projection.wrap === 'inline' ||
        atom.projection.wrap === 'behind' ||
        atom.projection.wrap === 'inFront'
      ) {
        continue;
      }
      const modelStart = offsets.get(atom.atomId);
      if (modelStart !== undefined && modelStart >= startOffset) starts.add(modelStart);
    }
    return starts;
  })();

  const sameParagraphAnchorStarts = [
    ...(flow?.pageExclusionZones ?? [])
      .filter((zone) => zone.anchorParagraphId === paragraphId)
      .map((zone) => zone.anchorModelStart),
    ...topAndBottomAnchorStarts,
    ...wrapAnchorStarts,
  ];

  const anchorLineStartByOffset = anchorLineStartsByModelOffset({
    colonNaturalWidths,
    typography,
    cjkBreaks,
    pieces,
    measurer,
    available,
    firstLineOffset,
    anchorStarts: sameParagraphAnchorStarts,
    equationLayoutOf,
    pageBreaksIgnored,
  });

  for (const start of wrapAnchorStarts) {
    const lineStart = anchorLineStartByOffset.get(start);
    if (lineStart !== undefined) anchorLineTopByModelStart.set(start, lineStart);
  }

  const emptyExclusionZones: readonly ExclusionZone[] = Object.freeze([]);
  const activeExclusionZones = (): readonly ExclusionZone[] => {
    if (!flow?.pageExclusionZones?.length && anchorLineTopByModelStart.size === 0)
      return emptyExclusionZones;
    const pageZones =
      flow?.pageExclusionZones?.filter((zone) => {
        if (!exclusionZoneAppliesToLine(zone, paragraphId, line, anchorLineStartByOffset))
          return false;
        // Anchor paragraph uses break-time synthesis; page zones are for inherited bands only.
        if (zone.anchorParagraphId === paragraphId) {
          if (!zone.sourceKind && zone.input.mode === 'topAndBottom') return false;
          if (flow?.anchorCellBox != null) return false;
        }
        return true;
      }) ?? [];
    // A story whose text ignores its anchors' wrap (a header before mode 15) carves nothing.
    const anchorsWrap = flow?.cellAnchorScope?.anchorsWrapText !== false;
    const synthesizedWrap =
      anchorsWrap &&
      flow?.inlineDrawingLayout &&
      flow.anchorCellBox != null &&
      anchorLineTopByModelStart.size > 0
        ? synthesizeParagraphWrapExclusionZones({
            paragraph,
            paragraphId,
            drawingLayout: flow.inlineDrawingLayout,
            contentLeft,
            contentRight,
            paragraphStartY: flow.paragraphStartY ?? 0,
            anchorLineTopByModelStart,
            anchorCellBox: flow.anchorCellBox,
            cellAnchorScope: flow.cellAnchorScope,
            ...(flow.layoutTextboxStory ? { layoutTextboxStory: flow.layoutTextboxStory } : {}),
            displayMode: anchorDisplayMode,
            ...(flow.revisionAuthorFilter
              ? { revisionAuthorFilter: flow.revisionAuthorFilter }
              : {}),
          })
        : Object.freeze([]);
    const synthesized =
      anchorsWrap && flow?.inlineDrawingLayout && anchorLineTopByModelStart.size > 0
        ? synthesizeParagraphTopAndBottomZones({
            paragraph,
            paragraphId,
            drawingLayout: flow.inlineDrawingLayout,
            contentLeft,
            contentRight,
            // `positionV relativeFrom="paragraph"` measures from above the spacing before.
            paragraphStartY:
              (flow.anchorParagraphStartY ?? flow.paragraphStartY ?? 0) -
              (flow.paragraphSpaceBefore ?? 0),
            anchorLineTopByModelStart,
            anchorCellBox: flow.anchorCellBox,
            cellAnchorScope: flow.cellAnchorScope,
            ...(flow.anchorFrameBase ? { frameBase: flow.anchorFrameBase } : {}),
            displayMode: anchorDisplayMode,
            ...(flow.revisionAuthorFilter
              ? { revisionAuthorFilter: flow.revisionAuthorFilter }
              : {}),
          })
        : Object.freeze([]);
    return Object.freeze([...pageZones, ...synthesizedWrap, ...synthesized]);
  };

  // Whether the line being built takes the first-line slot: the first line, or the first
  // after page breaks that open the paragraph when the slot carries past them. Kept as state,
  // so a run of leading breaks costs one check per break line.
  let firstLineOpen = true;
  const opensFirstLine = (): boolean => firstLineOpen;
  const holdsContent = (): boolean => lineHoldsContent(line, pageBreaksIgnored);
  // Where the line being built starts, and how much room it has. Only the first differs.
  const lineOffset = (): number => (opensFirstLine() ? firstLineOffset : 0);
  const lineOrigin = (): number => contentOriginX + indentLeft + lineOffset();
  const baseLineAvailable = (): number => Math.max(1, available - lineOffset());

  // Closed line heights stay fixed. Accumulate in the same order as a full reduction,
  // without rescanning every previous line for each float or drawing placement.
  let closedLineExtent = 0;
  const priorLineExtent = (): number => closedLineExtent;

  const currentLineTopY = (): number => (flow?.paragraphStartY ?? 0) + priorLineExtent();

  const recordTopAndBottomAnchorLineTop = (modelStart: number): void => {
    if (topAndBottomAnchorStarts.has(modelStart)) {
      anchorLineTopByModelStart.set(modelStart, priorLineExtent());
    }
  };
  /**
   * Record the top of each top-and-bottom anchor the probe puts on the line that opens, so the
   * band moves that line before any text on it is placed beside floats at the old height.
   */
  const recordTopAndBottomAnchorsOnOpeningLine = (): void => {
    for (const start of topAndBottomAnchorStarts) {
      if (
        anchorLineStartByOffset.get(start) === line.start &&
        !anchorLineTopByModelStart.has(start)
      )
        anchorLineTopByModelStart.set(start, priorLineExtent());
    }
  };

  const {
    applyTopAndBottomSkipIfNeeded,
    applyNarrowWrapSkipIfNeeded,
    applyInlineObjectSkipIfNeeded,
    applyOpeningSegmentSkipIfNeeded,
    finalizeTopAndBottomClearance,
    clearEmptyParagraph,
    clearBlockedEmptyLine,
    applyBreakClearance,
    commitBreakClearance,
  } = createLineExclusionClearance({
    line: () => line,
    top: currentLineTopY,
    spaceAbove: () => (lines.length === 0 ? (flow?.paragraphSpaceBefore ?? 0) : 0),
    zones: activeExclusionZones,
    left: () => Math.max(contentLeft, lineOrigin()),
    right: wrapRight,
    clearOwnEmptyAnchor: flow?.anchorCellBox == null,
    emptyStyle: lineStartStyle,
    measurer,
    lineSpacing,
    holdsContent,
    paragraphId,
    ...(flow?.regionBottomY !== undefined ? { regionBottom: flow.regionBottomY } : {}),
  });

  // Own floats placed from the paragraph top, which a clearing break finds wherever the paragraph
  // lands, even before a pass has published them on this page.
  let ownClear: readonly ExclusionZone[] | undefined;
  const ownClearZones = (): readonly ExclusionZone[] =>
    (ownClear ??=
      startOffset > 0 || !flow?.inlineDrawingLayout
        ? []
        : ownParagraphFramedClearZones({
            ...(flow.anchorFrameBase ? { frameBase: flow.anchorFrameBase } : {}),
            paragraph,
            paragraphId,
            drawingLayout: flow.inlineDrawingLayout,
            contentLeft,
            contentRight,
            paragraphTop:
              (flow.anchorParagraphStartY ?? flow.paragraphStartY ?? 0) -
              (flow.paragraphSpaceBefore ?? 0),
            displayMode: anchorDisplayMode,
            ...(flow.revisionAuthorFilter
              ? { revisionAuthorFilter: flow.revisionAuthorFilter }
              : {}),
          })).filter((zone) =>
      exclusionZoneAppliesToLine(zone, paragraphId, line, anchorLineStartByOffset)
    );
  /** The floats a `w:br w:clear` on the line being built clears, chosen where the pen stands. */
  const breakClearOnLine = (clear: TextWrappingBreakClear) =>
    clear === 'all'
      ? (zones: readonly ExclusionZone[]) => withOwnClearZones(zones, ownClearZones())
      : breakClearSelector(clear, activeExclusionZones(), {
          y: currentLineTopY() + (line.exclusionSkipBefore ?? 0),
          height: line.height,
          left: Math.max(contentLeft, lineOrigin()),
          right: wrapRight,
          penX: lineOrigin() + line.width,
        });

  // Where the line will actually sit. A band that pushed this line down has already been
  // recorded on it, so probing must ask about the shifted position — probing the unshifted
  // top reports the line as still inside the band it just cleared, which leaves it with no
  // room and strands its first character on a line of its own.
  const exclusionProbe = createLineExclusionProbe({
    line: () => line,
    top: currentLineTopY,
    left: contentLeft,
    right: wrapRight,
    lineSpacing,
    initialMetrics: measurer.lineMetrics(lineStartStyle),
  });
  const availableIntervals = exclusionProbe.intervals;

  /**
   * First usable x at or after the pen, with the first-line indent preserved.
   *
   * Word measures a first-line indent from the start of the line's USABLE segment, so an
   * exclusion that swallows the indent's origin moves the indent along with the edge.
   * Snapping alone deleted it: the first line then began flush with every other line of the
   * paragraph, at the float's near edge.
   */
  const penTargetAfterExclusion = (
    currentX: number,
    intervals: readonly ScanlineInterval[]
  ): number | null => {
    const snap = snapXToAvailableInterval(currentX, intervals);
    if (!snap) return null;
    if (snap.x <= currentX + 0.001 || line.width > 0.001 || lineOffset() <= 0) return snap.x;
    const indented = snapXToAvailableInterval(snap.x + lineOffset(), intervals);
    return indented ? indented.x : snap.x;
  };

  const snapLineToAvailableInterval = (): boolean => {
    const zones = activeExclusionZones();
    if (zones.length === 0) return true;
    applyTopAndBottomSkipIfNeeded();
    const shift = exclusionProbe.relocate(zones);
    if (shift === null) return false;
    wordStartWidth += shift;
    const intervals = availableIntervals(zones);
    const currentX = lineOrigin() + line.width;
    const target = penTargetAfterExclusion(currentX, intervals);
    if (target === null) return false;
    if (target > currentX + 0.001) {
      line.width = target - lineOrigin();
    }
    return true;
  };

  /**
   * Total capacity of the line being built, in `line.width` units: how far the pen may travel
   * from `lineOrigin()`. Callers test `line.width + width` against it, so it MUST stay a
   * capacity; the room ahead of the pen would halve every line beside an exclusion zone.
   */
  const lineAvailable = (): number => {
    const base = baseLineAvailable();
    const zones = activeExclusionZones();
    if (zones.length === 0) return Math.max(base, alignedTabRight - lineOrigin());
    applyTopAndBottomSkipIfNeeded();
    if (!snapLineToAvailableInterval()) return 0;
    const intervals = availableIntervals(zones);
    const origin = lineOrigin() + line.width;
    const remaining = remainingWidthAtX(origin, intervals);
    if (remaining <= 0.001) return 0;
    return Math.min(base, line.width + remaining);
  };

  /** Room left ahead of the pen on the current line. */
  const remainingLineWidth = (): number => Math.max(0, lineAvailable() - line.width);

  /**
   * Record the float passage this line ended up in, for alignment to work inside it.
   *
   * Only a passage that holds the WHOLE line qualifies: a line that steps over a float owns
   * two disjoint runs of x, and centring either of them would move glyphs onto the picture.
   */
  const recordWrapSegment = (): void => {
    // Placement mirrors an RTL line's spans, so its first span is not its left edge.
    if (flow?.paragraphRtl) return;
    const zones = activeExclusionZones();
    if (zones.length === 0) return;
    const intervals = availableIntervals(zones);
    if (intervals.length === 0) return;
    const fallbackStart = Math.max(contentLeft, lineOrigin());
    const contentStart = lineContentX(line.spans, line.drawings, fallbackStart);
    const contentEnd = lineOrigin() + line.width;
    const segment = intervals.find(
      (interval) => contentStart >= interval.start - 0.001 && contentStart <= interval.end + 0.001
    );
    if (!segment || contentEnd > segment.end + 0.001) return;
    // The full measure is what alignment already assumes; recording it would only add a
    // second spelling of the same geometry to every cache key.
    if (segment.start <= contentLeft + 0.001 && segment.end >= wrapRight - 0.001) return;
    line.wrapSegment = { start: contentStart, end: segment.end };
  };

  const tryAdvanceToNextPassage = (): boolean => {
    const zones = activeExclusionZones();
    if (zones.length === 0) return false;
    // A float anchored in an EARLIER paragraph has no offset in this one to be "past" — its
    // zone applies to every line here. Requiring a same-paragraph anchor left those lines
    // stranded in the first passage: they stopped at the picture's near edge and broke,
    // never resuming in the column beside it.
    const zoneIsOpen = zones.some(
      (zone) => zone.anchorParagraphId !== paragraphId || line.end > zone.anchorModelStart
    );
    if (!zoneIsOpen) return false;
    const intervals = availableIntervals(zones);
    const currentX = lineOrigin() + line.width;
    let foundCurrent = false;
    for (const interval of intervals) {
      if (!foundCurrent) {
        if (currentX >= interval.start - 0.000_001 && currentX < interval.end - 0.000_001) {
          foundCurrent = true;
        }
        continue;
      }
      if (interval.end - interval.start > 0.001) {
        line.width = interval.start - lineOrigin();
        return true;
      }
    }
    return false;
  };

  const advancePastAnchorExclusionForPlacement = (modelStart: number): void => {
    if (
      sameParagraphAnchorStarts.length === 0 ||
      modelStart < Math.min(...sameParagraphAnchorStarts)
    ) {
      return;
    }
    const zones = activeExclusionZones().filter(
      (zone) => zone.anchorParagraphId === paragraphId && modelStart >= zone.anchorModelStart
    );
    if (zones.length === 0) return;
    applyTopAndBottomSkipIfNeeded();
    const intervals = availableIntervals(zones);
    const currentX = lineOrigin() + line.width;
    let containingIndex = -1;
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index]!;
      if (currentX >= interval.start - 0.001 && currentX < interval.end - 0.001) {
        containingIndex = index;
        break;
      }
    }
    // Only move a pen standing INSIDE the picture. Skipping to the next passage whenever one
    // existed emptied the near column of a centred float: every word after the anchor hopped
    // the picture, so the space beside it took one word per line and the rest piled up on the
    // far side. Filling the near passage first, then advancing on overflow, is what Word does.
    if (containingIndex >= 0) return;
    const target = penTargetAfterExclusion(currentX, intervals);
    if (target !== null && target > currentX + 0.001) {
      line.width = target - lineOrigin();
    }
  };

  // A top-and-bottom anchor does not end its line: the text before and after it shares one
  // line, which moves below the band as a whole when the band crosses it.
  const clearTopAndBottomAfterAnchor = (modelStart: number): void => {
    const zones = activeExclusionZones().filter(
      (zone) =>
        zone.input.mode === 'topAndBottom' &&
        zone.anchorParagraphId === paragraphId &&
        modelStart >= zone.anchorModelStart
    );
    if (zones.length > 0) applyTopAndBottomSkipIfNeeded(holdsContent());
  };

  // A line admitted to its passage breaks an oversized segment there instead of moving it.
  const movesOpeningSegment = (width: number): boolean =>
    !admittedToNarrowPassage(pieces, line.start, previousLineCut) &&
    applyOpeningSegmentSkipIfNeeded(width, exclusionProbe.height());

  const ensurePlacementWidth = (width: number, depth = 0): boolean => {
    if (depth > 64) return remainingLineWidth() >= width;
    applyTopAndBottomSkipIfNeeded();
    if (!snapLineToAvailableInterval()) {
      if (holdsContent()) {
        closeLine();
        return ensurePlacementWidth(width, depth + 1);
      }
      if (movesOpeningSegment(width)) return ensurePlacementWidth(width, depth + 1);
      return true;
    }
    if (width <= remainingLineWidth() + 0.001) return true;
    if (holdsContent()) {
      if (tryAdvanceToNextPassage() && width <= remainingLineWidth() + 0.001) return true;
      closeLine();
      return ensurePlacementWidth(width, depth + 1);
    }
    // An EMPTY line that cannot hold the word may still have room beside the float. A picture
    // offset a few points from the margin leaves a sliver of a passage in front of it; without
    // this the word was chopped at the character to fill that sliver, one letter per line,
    // while the usable column to its right stayed empty.
    if (tryAdvanceToNextPassage()) return ensurePlacementWidth(width, depth + 1);
    // No passage at this height holds the segment: the line moves down to the first height
    // where one does. Each move clears at least one band, so the recursion makes progress.
    if (movesOpeningSegment(width)) return ensurePlacementWidth(width, depth + 1);
    // Only a segment wider than the clear column remains; it overflows and is broken here.
    return true;
  };

  /** The deleted ranges overlapping one line, clipped to it. */
  const deletedWithin = (start: number, end: number): ModelRange[] =>
    deletedRanges
      .filter((range) => range.start < end && range.end > start)
      .map((range) => ({ start: Math.max(range.start, start), end: Math.min(range.end, end) }));

  const { changeSitesOn, claimTrailingChangeSites } = collectLineChangeSites(changeSites);

  /**
   * Where the word being placed started on this line; `-1` when the line has no partial word.
   *
   * A word can span RUNS (`<w:del>which</w:del><w:ins>that</w:ins>`, or a bold prefix), and a
   * run boundary is not a break opportunity: breaking there split a word across two lines.
   */
  let wordStartSpan = -1;
  let wordStartWidth = 0;
  let wordStartEnd = 0;
  /** Line metrics before the word, restored when the word moves. */
  let wordStartMetrics = { height: 0, baseline: 0 };
  /** The last character emitted, which decides whether the NEXT span may open a line. */
  let lastEmitted = '';

  /**
   * Band of the runs that hold this line's placed inline pictures. Under `auto` spacing it is
   * the text band of a line without text: never the paragraph's run cascade or its mark.
   */
  let pictureRunBand: { height: number; baseline: number } | undefined;
  const growLineMetricsForDrawing = (
    style: ResolvedRunStyle,
    measure: ReturnType<typeof measureInlineDrawing>
  ): { extentTopY: number } => {
    const textMetrics = measurer.lineMetrics(style);
    pictureRunBand ??= { height: 0, baseline: 0 };
    growLineMetrics(pictureRunBand, textMetrics);
    const layout = inlineDrawingVerticalLayout(
      textMetrics.baseline,
      line.height || textMetrics.height,
      measure
    );
    if (line.height === 0) {
      line.height = layout.lineHeight;
      line.baseline = layout.baseline;
    } else if (layout.lineHeight > line.height) {
      line.height = layout.lineHeight;
      line.baseline = Math.max(line.baseline, layout.baseline);
    } else {
      line.baseline = Math.max(line.baseline, layout.baseline);
    }
    return { extentTopY: layout.extentTopY };
  };

  const syncDrawingBaselinesBeforeSpacing = (): void => {
    if (line.drawings.length === 0) return;
    if (line.spans.every((span) => pageBreaksIgnored && span.text === PAGE_BREAK_CHAR)) {
      line.baseline = Math.max(
        line.baseline,
        ...line.drawings.map((drawing) => drawing.y + drawing.height)
      );
    }
    const repositioned = repositionInlineDrawingsForBaseline(line.drawings, line.baseline);
    (line.drawings as InlineDrawingRecord[]).splice(0, line.drawings.length, ...repositioned);
    line.baseline = Math.max(
      line.baseline,
      ...line.drawings.map((drawing) => drawing.y + drawing.height)
    );
  };

  const repositionDrawingsToFinalBaseline = (): void => {
    if (line.drawings.length === 0) return;
    const repositioned = repositionInlineDrawingsForBaseline(line.drawings, line.baseline);
    (line.drawings as InlineDrawingRecord[]).splice(0, line.drawings.length, ...repositioned);
  };

  const closeLine = (options?: { readonly includeParagraphMark?: boolean }): void => {
    previousLineCut = false; // Only the oversized-word cut sets it again.
    placeLeadingIgnoredBreaks(line, pageBreaksIgnored);
    const empty =
      line.drawings.length === 0 && line.spans.every((span) => isHeightlessWhitespace(span.text));
    const metrics = measurer.lineMetrics(empty ? emptyStyle : cascadeStyle);
    // Baseline of the visible glyph band before mark / spacing. Paint's padding-top is
    // `spaced.baseline - glyphBaseline` (space above); auto extras grow BELOW instead.
    let glyphBaseline = line.baseline;
    if (line.height === 0) {
      line.height = metrics.height;
      line.baseline = metrics.baseline;
      glyphBaseline = metrics.baseline;
    } else if (options?.includeParagraphMark && !flow?.paragraphMarkIsCellEnd) {
      // A script line's floor stays below the glyph baseline, so a cover page keeps its rhythm.
      const floor = scriptLineFloor(line.spans, unstyledMarkStyle.verticalAlign, measurer);
      line.height = Math.max(line.height, floor);
    }
    // The list marker is painted as furniture, but it sits on THIS line's baseline, so its
    // face reserves space above it like the run the marker is in Word. The descent is the
    // text's alone. Only the paragraph's first line carries a marker.
    const firstLine = opensFirstLine();
    if (firstLine && firstLineOffset !== 0) line.firstLineOffset = firstLineOffset;
    if (firstLine && markerAscent > line.baseline) {
      const raised = markerAscent - line.baseline;
      line.baseline = markerAscent;
      line.height += raised;
      glyphBaseline += raised;
    }
    growRunBorderLineMetrics(line, measurer);
    syncDrawingBaselinesBeforeSpacing();
    growPendingLineDrawingExtent(line);
    // Apply paragraph line spacing once to the finished box.
    const naturalHeight = line.height;
    // `auto` scales the TEXT band, not a tall inline drawing or equation (ECMA-376
    // 17.3.1.33). A drawing line above single spacing keeps the drawing's box and adds the
    // multiple's extra text band below it; an equation or a smaller multiple keeps the atom
    // as a floor, while a larger text multiple can still win.
    const hasUnscaledInlineExtent =
      line.drawings.length > 0 || line.spans.some((span) => span.equation !== undefined);
    const scalesTextBandOnly = lineSpacing.rule === 'auto' && hasUnscaledInlineExtent;
    const holdsUnscaledPicture =
      scalesTextBandOnly &&
      line.drawings.length > 0 &&
      !line.spans.some((span) => span.equation !== undefined) &&
      lineSpacing.gridPitch === undefined;
    const addsTextBandExtra = holdsUnscaledPicture && lineSpacing.value > 240;
    // Below single spacing the multiple takes its missing text band off the line's top: the
    // line is the picture less that band, never less than the scaled text band.
    const removesTextBand = holdsUnscaledPicture && lineSpacing.value < 240;
    const spacingBase = scalesTextBandOnly
      ? textBandHeightWithBorders(
          line.spans,
          measurer,
          pictureRunBand?.height ?? metrics.height,
          pageBreaksIgnored
        )
      : naturalHeight;
    const spaced = applyLineSpacing(lineSpacing, spacingBase, line.baseline);
    if (!scalesTextBandOnly) line.baseline = spaced.baseline;
    const floored = firstLine && lineSpacing.rule !== 'exact' ? markerBaselineFloor : 0;
    const markerFloor = Math.max(0, floored - line.baseline);
    line.baseline += markerFloor;
    // Space ABOVE the glyph band only (exact baseline placement, not auto/atLeast). Never negative.
    line.leading = Math.max(0, line.baseline - glyphBaseline);
    // The multiple's extra over the text band sits below the drawing.
    const textBandExtra = addsTextBandExtra
      ? Math.max(0, spaced.height - spacingBase)
      : removesTextBand
        ? Math.min(0, spaced.height - spacingBase)
        : 0;
    line.height = scalesTextBandOnly
      ? Math.max(spaced.height, naturalHeight + textBandExtra)
      : spaced.height;
    // A baseline below the shortened line's foot moves up to it, so a picture ends there.
    if (removesTextBand) line.baseline = Math.min(line.baseline, line.height);
    // Like a text line's auto extra, the depth below the drawing may cross the bottom margin.
    const drawingLineTrailing = addsTextBandExtra ? Math.max(0, line.height - naturalHeight) : 0;
    line.height += markerFloor;
    // Baseline shifts from line spacing must move inline drawings too, or authored distT/distB
    // and the text baseline drift apart. For `exact`, keep the authored box — tall drawings
    // clip/overflow per content-clip policy; auto/atLeast still grow to contain distB.
    repositionDrawingsToFinalBaseline();
    // A picture taller than a shortened line paints only below the line's top.
    if (removesTextBand) clipLineDrawingsAtTop(line);
    if (lineSpacing.rule !== 'exact') growPendingLineDrawingExtent(line);
    line.trailingSpacing =
      line.drawings.length === 0 && lineSpacing.rule !== 'exact'
        ? Math.max(0, spaced.trailing ?? spaced.height - naturalHeight)
        : drawingLineTrailing;
    finalizeTopAndBottomClearance();
    commitBreakClearance();
    if (empty && (wrapAnchorStarts.size > 0 || topAndBottomAnchorStarts.size > 0))
      clearEmptyParagraph(paragraphId);
    else if (empty && firstLine) clearBlockedEmptyLine();
    // Mark wrap advances after merging, using the shape paint receives.
    coalesceIdeographicSpans(line);
    markPendingLineWrapAdvances(line);
    const deleted = deletedWithin(line.start, line.end);
    if (deleted.length > 0) line.deletedRanges = deleted;
    const sites = changeSitesOn(line, line.spans, line.changeSites);
    if (sites.length > 0) line.changeSites = sites;
    recordWrapSegment();
    lines.push(line);
    closedLineExtent = closedLineExtent + line.height + (line.exclusionSkipBefore ?? 0);
    firstLineOpen = false;
    wordStartSpan = -1;
    wordStartWidth = 0;
    alignedTabRight = 0;
    pictureRunBand = undefined;
    line = {
      spans: [],
      drawings: [],
      start: line.end,
      end: line.end,
      width: 0,
      height: 0,
      baseline: 0,
      leading: 0,
      trailingSpacing: 0,
    };
    recordTopAndBottomAnchorsOnOpeningLine();
    applyTopAndBottomSkipIfNeeded();
  };

  /** Whether the last thing placed was a line break, so the paragraph ends on a fresh line. */
  let trailingLineBreak = false;
  /** Whether nothing but ignored page breaks precedes the word being placed on its line. */
  const wordOpensLine = (): boolean => {
    for (let index = 0; index < wordStartSpan; index += 1) {
      if (!pageBreaksIgnored || line.spans[index]!.text !== PAGE_BREAK_CHAR) return false;
    }
    return wordStartSpan >= 0;
  };
  /** Whether the pen snapped past a float after the word's last span, which splits the word. */
  const penLeftWord = (): boolean => {
    if (wordStartSpan < 0 || line.spans.length <= wordStartSpan) return false;
    lineAvailable();
    const last = line.spans[line.spans.length - 1]!;
    return lineOrigin() + line.width > last.box.x + last.box.width + 0.001;
  };
  const wordCarry: WordCarryContext = {
    line: () => line,
    measurer,
    pageBreaksIgnored,
    holdsContent,
    closeLine: () => closeLine(),
    ensurePlacementWidth: (width) => ensurePlacementWidth(width),
    tryAdvanceToNextPassage,
    lineAvailable,
    lineOrigin,
    applyNarrowWrapSkipIfNeeded,
    setProbeWidth: (width) => exclusionProbe.setWidth(width),
  };

  // A remainder re-broken after a clearing break (on a later page, say) opens clear as well.
  recordTopAndBottomAnchorsOnOpeningLine();
  const restartClear =
    startOffset > 0
      ? allPieces.find((p) => p.end === startOffset && p.breakClear)?.breakClear
      : undefined;
  if (restartClear) {
    // A remainder clears only floats its region's page publishes, and floats of other
    // paragraphs. A zone of its own rebuilt from the remainder's top (in a table cell) is not
    // where a float anchored earlier is; one anchored on this line moves with it, so clearing
    // it again on every region would leave the line no region to fit.
    const select = breakClearOnLine(restartClear);
    const placed = new Set(flow?.pageExclusionZones ?? []);
    applyBreakClearance((zones) =>
      select(zones).filter((zone) => zone.anchorParagraphId !== paragraphId || placed.has(zone))
    );
  }
  const shrinkTail = spaceShrinkWordTail(pieces, measurer);
  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex]!;
    if (piece.breakKind === 'column') {
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: piece.text,
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
        ...(piece.link ? { link: piece.link } : {}),
        ...paragraphSpanMetadata(piece),
      });
      growLineMetrics(line, breakMetrics);
      line.end = piece.end;
      closeLine();
      lines[lines.length - 1]!.columnBreakAfter = true;
      // Like a trailing hard break, NOT like a page break: Word still lays out the
      // paragraph's remainder after the column advance. The common authoring form
      // `<w:p><w:r><w:br w:type="column"/></w:r></w:p>` therefore opens one empty line
      // at the top of the next column before the following block — the paragraph mark
      // after the break. Suppressing that remainder put "After Column Break" flush with
      // the prior column's first line.
      trailingLineBreak = true;
      continue;
    }
    if (piece.equation) {
      const equation = equationLayoutOf(piece)!;
      const atomWidth = equation.geometry.box.width;
      if (holdsContent() && line.width + atomWidth > lineAvailable()) closeLine();
      exclusionProbe.setMetrics(
        {
          height: equation.geometry.box.height,
          baseline: equation.geometry.baseline,
        },
        atomWidth
      );
      applyInlineObjectSkipIfNeeded(atomWidth, equation.geometry.box.height);
      if (!ensurePlacementWidth(atomWidth)) continue;
      const priorDescent = Math.max(0, line.height - line.baseline);
      const equationDescent = Math.max(
        0,
        equation.geometry.box.height - equation.geometry.baseline
      );
      line.baseline = Math.max(line.baseline, equation.geometry.baseline);
      line.height = line.baseline + Math.max(priorDescent, equationDescent);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: '\uFFFC',
        props: piece.props,
        style: piece.style,
        box: {
          x: lineOrigin() + line.width,
          y: 0,
          width: atomWidth,
          height: equation.geometry.box.height,
        },
        projected: true,
        equation,
        ...paragraphSpanMetadata(piece),
      });
      line.width += atomWidth;
      line.end = piece.end;
      wordStartSpan = -1;
      lastEmitted = '';
      continue;
    }
    if (
      piece.projected &&
      !piece.inlineDrawing &&
      !piece.noteSeparator &&
      piece.text === '\uFFFC'
    ) {
      recordTopAndBottomAnchorLineTop(piece.start);
      // A tracked anchored drawing leaves no span on its anchor line, so the line records the
      // attribution for the margin change bar. A drawing the display mode hides cues no bar.
      if (
        piece.anchoredAtom &&
        piece.revisions !== undefined &&
        revisionsVisible(piece.revisions, anchorDisplayMode, flow?.revisionAuthorFilter)
      ) {
        line.anchorRevisions = [...(line.anchorRevisions ?? []), ...piece.revisions];
      }
      // A resolved view keeps the picture as plain furniture; the line still records the site.
      if (piece.anchoredAtom && piece.changeSites) {
        line.changeSites = [...(line.changeSites ?? []), ...piece.changeSites];
      }
      line.end = piece.end;
      continue;
    }
    if (piece.inlineDrawing) {
      recordTopAndBottomAnchorLineTop(piece.start);
      const measure = measureInlineDrawing(piece.inlineDrawing.projection);
      const atomWidth = measure.totalWidth;
      // A picture that does not fit before a float resumes past it (probed at the line's own
      // metrics: the picture's would move its text), and the text before it stays put.
      let jumps = false;
      if (holdsContent() && line.width + atomWidth > lineAvailable()) {
        const settledWidth = line.width;
        jumps = tryAdvanceToNextPassage() && line.width + atomWidth <= lineAvailable() + 0.001;
        line.width = settledWidth;
        if (!jumps) closeLine();
      }
      exclusionProbe.setMetrics(
        { height: measure.lineContribution, baseline: measure.lineContribution },
        atomWidth
      );
      const jumpedLine = line;
      if (!jumps) applyInlineObjectSkipIfNeeded(atomWidth, measure.lineContribution);
      if (!ensurePlacementWidth(atomWidth)) continue;
      if (jumps && line !== jumpedLine) {
        // Placement refused the jump at the picture's own height and closed the line.
        applyInlineObjectSkipIfNeeded(atomWidth, measure.lineContribution);
        if (!ensurePlacementWidth(atomWidth)) continue;
      }
      const { extentTopY } = growLineMetricsForDrawing(piece.style, measure);
      const slotX = lineOrigin() + line.width;
      line.drawings.push(
        buildInlineDrawingRecord({
          input: piece.inlineDrawing,
          paragraphId,
          start: piece.start,
          slotX,
          y: extentTopY,
          baseline: line.baseline,
          contentLeft: contentOriginX,
          contentRight: contentOriginX + rightEdge,
          ...(piece.revisions ? { revisions: piece.revisions } : {}),
          ...(piece.style.shaping ? { bidiLevel: piece.style.shaping.level } : {}),
          layoutTextboxStory: flow?.layoutTextboxStory,
        })
      );
      // A picture a resolved view kept has no span to carry its site; the line takes it.
      if (piece.changeSites) {
        line.changeSites = [...(line.changeSites ?? []), ...piece.changeSites];
      }
      line.width += atomWidth;
      line.end = piece.end;
      wordStartSpan = -1;
      lastEmitted = '';
      continue;
    }
    if (piece.text === PAGE_BREAK_CHAR) {
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: PAGE_BREAK_CHAR,
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
        ...(piece.link ? { link: piece.link } : {}),
        ...paragraphSpanMetadata(piece),
      });
      line.end = piece.end;
      if (pageBreaksIgnored) continue;
      growLineMetrics(line, breakMetrics);
      const slotLine: boolean = firstLineOpen;
      closeLine();
      const closed = lines[lines.length - 1]!;
      closed.pageBreakAfter = true;
      firstLineOpen = carriesSlot && slotLine && holdsOnlyPageBreak(closed);
      // NOT `trailingLineBreak`: an empty remainder publishes no line on the page the break
      // opened, so the following block sits at its top (`paragraph-spacing-borders` and
      // `section-aware-pagination` pin it). A click beside the mark resolves BEFORE it.
      trailingLineBreak = false;
      continue;
    }
    if (piece.text === '\n') {
      if (piece.breakKind === 'line') line.manualBreakAfter = true;
      // A hard break ends the line without ending the paragraph — and it OCCUPIES a model
      // offset. Emitting no span for it meant the text reconstructed from the records was
      // shorter than the model: Select All stopped short and left residue, a copied break
      // came back as a space, and Delete before a trailing break merged the next paragraph
      // instead of removing the break. A zero-width span keeps the two in step.
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: '\n',
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
        ...(piece.link ? { link: piece.link } : {}),
        ...paragraphSpanMetadata(piece),
      });
      growLineMetrics(line, breakMetrics);
      line.end = piece.end;
      const cleared = piece.breakClear ? breakClearOnLine(piece.breakClear) : undefined;
      closeLine();
      if (cleared) applyBreakClearance(cleared);
      trailingLineBreak = true;
      continue;
    }
    trailingLineBreak = false;
    clearTopAndBottomAfterAnchor(piece.start);
    if (
      sameParagraphAnchorStarts.length > 0 &&
      piece.start >= Math.min(...sameParagraphAnchorStarts)
    ) {
      advancePastAnchorExclusionForPlacement(piece.start);
    }
    // The face this piece MEASURES in. Spans keep `piece.style` — the run's real
    // resolution — plus the slot, and re-resolve through the same helper.
    const faceStyle = styleForFontSlot(piece.style, piece.fontSlot);
    // Layout-owned pieces get no ideographic boundaries: every span publishes the whole
    // piece range, so a per-ideograph split painted dozens of spans claiming one range. An
    // oversized result is cut once per line instead, and checks kinsoku by its own text,
    // because the paragraph table holds a field as one unit.
    const layoutOwned = isLayoutOwnedPiece(piece);
    const canChopWord = canChopPiece(piece);
    const textBreaks = layoutOwned ? null : cjkBreaks;
    let consumed = 0;
    for (const boundary of cjkBreaks?.boundaries(piece) ??
      wordBoundaries(piece.text, !layoutOwned)) {
      const candidate = piece.text.slice(consumed, boundary);
      if (candidate.length === 0) continue;
      const metrics = measurer.lineMetrics(
        faceStyle,
        lineBandText(piece, displayText(candidate, faceStyle))
      );
      exclusionProbe.setMetrics(positionedRunMetrics(metrics, faceStyle));
      const spanRange = layoutOwned
        ? { paragraphId, start: piece.start, end: piece.end }
        : { paragraphId, start: piece.start + consumed, end: piece.start + boundary };

      if (candidate === '\t') {
        const pastCellEdge = shouldReplayCellTab(
          replayScope,
          paragraphRtl,
          Boolean(piece.positionalTab),
          activeExclusionZones().length,
          tabStops,
          lineOrigin() + line.width,
          rightEdge
        );
        if (
          holdsContent() &&
          (line.width >= lineAvailable() || pastCellEdge) &&
          placeableSuffixes[pieceIndex]![boundary] === 1
        )
          closeLine();
        const currentX = lineOrigin() + line.width;
        // RTL stops use leading-edge coordinates before bidi placement and alignment.
        const leading = paragraphRtl ? rtlLeadingIndent : 0;
        const stopX = paragraphRtl ? leading + lineOffset() + line.width : currentX;
        const stopRight = paragraphRtl ? leading + available : rightEdge;
        const segment = measureFollowingTabSegment(
          pieces,
          pieceIndex,
          boundary,
          measurer,
          pageBreaksIgnored
        );
        // A `w:ptab` states its own destination and leader, so it does NOT consult the
        // paragraph's tab stops — a table-of-contents line authored with one has none.
        // A positional tab whose destination is at or behind the caret cannot advance —
        // a left-aligned one almost never can, and it is also the fallback for a malformed
        // `w:alignment`. Falling back to the ordinary stop rule keeps the glyphs apart
        // instead of reproducing the very run-together text this element exists to prevent.
        const positional = piece.positionalTab
          ? positionalTabDestination(piece.positionalTab, indentLeft, rightEdge, flow?.marginExtent)
          : null;
        // Authored aligned tabs may reach the containing margin beyond the paragraph's
        // right indent. Only their following segment gets that extra room.
        const tabEdge =
          activeExclusionZones().length === 0
            ? Math.max(stopRight, flow?.marginExtent?.right ?? stopRight)
            : stopRight;
        const destination = tabDestinationForFlow(
          tabStops,
          stopX,
          stopRight,
          tabEdge,
          currentX,
          rightEdge,
          positional
        );
        if (destination.alignment !== 'left' && !paragraphRtl) {
          alignedTabRight = Math.max(alignedTabRight, Math.min(destination.positionPt, tabEdge));
        }
        const width = tabAdvanceWidth(
          destination.alignment,
          positional === null ? stopX : currentX,
          destination.positionPt,
          segment.width,
          paragraphRtl && positional === null ? segment.rtlDecimalOffset : segment.decimalOffset
        );
        line.spans.push({
          range: spanRange,
          text: '\t',
          props: piece.props,
          style: piece.style,
          box: { x: currentX, y: 0, width, height: metrics.height },
          // The leader belongs to the stop that was REACHED, so it is resolved here with the
          // destination rather than re-derived from the paragraph at paint time — and its
          // glyph is MEASURED here too, in this run's own face, because paint has no
          // measurer and a guessed advance cannot space the dots the way typing them would.
          ...(destination.leader
            ? {
                tabLeader: destination.leader,
                tabLeaderAdvancePt: measurer.measure(
                  TAB_LEADER_GLYPH.get(destination.leader) ?? '.',
                  piece.style
                ),
              }
            : {}),
          ...(piece.link ? { link: piece.link } : {}),
          // destination rather than re-derived from the paragraph at paint time.
          ...(destination.leader ? { tabLeader: destination.leader } : {}),
          ...(layoutOwned && !piece.positionalTab ? { projected: true as const } : {}),
          ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
          ...paragraphSpanMetadata(piece),
        });
        line.width += width;
        growLineMetricsForText(line, metrics, '\t', faceStyle);
        line.end = layoutOwned ? piece.end : piece.start + boundary;
        // A tab lets the next word open a line. Clear the previous word so overflow
        // cannot carry it with the tab and replay the old advance from a new origin.
        lastEmitted = '\t';
        consumed = boundary;
        continue;
      }

      // Measured as DRAWN: `w:caps` changes the glyphs, so measuring the source text
      // would size the line for characters the reader never sees. Note marks may reserve
      // a wider measureText (eachPage) while painting the real digits.
      const measureSource = piece.measureText ?? candidate;
      let width = piece.noteSeparator
        ? Math.min(piece.noteSeparator === 'separator' ? 144 : lineAvailable(), lineAvailable())
        : piece.fieldAtom?.formControl?.kind === 'checkbox'
          ? faceStyle.fontSizePt
          : measurer.measure(displayText(measureSource, faceStyle), faceStyle);
      exclusionProbe.setWidth(width);
      // A candidate may open a line only at a real break opportunity — the shared
      // decision in `lineOpenDecisionAt`, which the anchor-line probe above consumes too.
      const openDecision =
        piece.noteSeparator || line.spans.at(-1)?.noteSeparator
          ? 'opens'
          : (cjkBreaks?.decision(piece, consumed) ??
            lineOpenDecisionAt(lastEmitted, candidate, consumed > 0));
      const opensWord = openDecision === 'opens';
      if (opensWord) {
        wordStartSpan = line.spans.length;
        wordStartWidth = line.width;
        wordStartEnd = line.end;
        wordStartMetrics = { height: line.height, baseline: line.baseline };
      }
      advancePastAnchorExclusionForPlacement(piece.start + consumed);
      applyNarrowWrapSkipIfNeeded(candidate, faceStyle);
      // A space belongs to a following protected group even across a source-run seam.
      const protectedEnd =
        opticalParagraph &&
        sameParagraphAnchorStarts.length === 0 &&
        boundary === piece.text.length &&
        pieces[pieceIndex + 1] !== undefined &&
        cjkBreaks?.decision(pieces[pieceIndex + 1]!, 0) === 'forbidden';
      const clipsWordEnd = !layoutOwned && piece.measureText === undefined && !protectedEnd;
      const naturalWidth = width;
      const measureFace = (text: string) =>
        measurer.measure(displayText(text, faceStyle), faceStyle);
      // Against the line the word lands on: it may move before it is placed.
      const clipWordEndAtPen = () =>
        clipsWordEnd
          ? lineEndSpaces.clipWordEnd(
              candidate,
              naturalWidth,
              lineAvailable() - line.width,
              measureFace,
              OVERFLOW_TOLERANCE_PT
            )
          : undefined;
      let clippedWordEnd = clipWordEndAtPen();
      width = clippedWordEnd?.width ?? width;
      const hangs =
        typography.overflowPunctuation &&
        canHangCjkPunctuation(candidate, piece, lineAvailable() - line.width, width, measurer);
      const applyOpticalFit =
        opticalCompression && sameParagraphAnchorStarts.length === 0
          ? () => {
              const fit = fitCjkOptically(
                line,
                pieceIndex,
                candidate,
                spanRange,
                width,
                lineOrigin() + line.width,
                lineAvailable(),
                !lineEndSpaces.isCollapsibleLineEndWhitespace(candidate) ||
                  (opensWord && placeableSuffixes[pieceIndex]![boundary] === 1)
              );
              if (fit) {
                width = fit.width;
                if (wordStartSpan >= 0 && fit.spanStarts) {
                  wordStartSpan = fit.spanStarts[wordStartSpan]!;
                  wordStartWidth =
                    wordStartSpan < line.spans.length
                      ? line.spans[wordStartSpan]!.box.x - lineOrigin()
                      : line.width;
                }
              }
              return fit;
            }
          : undefined;
      const opticalSourceLine = line;
      let opticalFit = applyOpticalFit?.();
      // Hang overflowing space runs on this line, preserving text/ranges and authored leading spaces.
      const lineEndWhitespace =
        !protectedEnd &&
        lineEndSpaces.isCollapsibleLineEndWhitespace(candidate) &&
        ((placeableSuffixes[pieceIndex]![boundary] !== 1 &&
          !(
            pageBreaksIgnored &&
            consumed === 0 &&
            lineEndSpaces.endsWordAcrossIgnoredBreaks(pieces, pieceIndex, candidate, lastEmitted)
          )) ||
          (!layoutOwned &&
            holdsContent() &&
            line.width + width > lineAvailable() + OVERFLOW_TOLERANCE_PT));
      if (lineEndWhitespace) {
        width = Math.min(width, Math.max(0, lineAvailable() - line.width));
      }
      // Word tests a centred colon's natural advance before applying the shared
      // bearing on its destination line. Keep the compressed advance for paint.
      const fitWidth = opticalFit ? width : (colonNaturalWidths.get(piece) ?? width);
      const overflows =
        !hangs &&
        // A space after a word that borrowed inter-word space hangs on its line.
        !(lineEndWhitespace && flow?.justifySpaceShrink) &&
        line.width + fitWidth > lineAvailable() + OVERFLOW_TOLERANCE_PT;
      const followingWidth =
        overflows && flow?.justifySpaceShrink ? shrinkTail(pieceIndex, boundary) : undefined;
      const borrowsSpace =
        overflows &&
        flow?.justifySpaceShrink === true &&
        // A word split across source runs overflows on a later piece than the one
        // that opened it, where the open decision is `continues`. The shrink test
        // still applies to the whole word: `wordStartSpan` says where it began.
        (opensWord || (openDecision === 'continues' && wordStartSpan > 0)) &&
        !flow.paragraphRtl &&
        !flow.pageExclusionZones?.length &&
        sameParagraphAnchorStarts.length === 0 &&
        line.drawings.length === 0 &&
        (placeableSuffixes[pieceIndex]![boundary] === 1 || endsParagraph(pieceIndex, boundary)) &&
        fitsWithSpaceShrink(
          line.spans,
          candidate,
          faceStyle,
          measurer,
          line.width,
          lineAvailable(),
          opensWord ? line.spans.length : wordStartSpan,
          opensWord ? line.width : wordStartWidth,
          followingWidth !== undefined ||
            endsParagraph(pieceIndex, boundary) ||
            (boundary < piece.text.length
              ? !layoutOwned && piece.text[boundary] === ' '
              : opensWithHangingSpace(pieces[pieceIndex + 1])),
          followingWidth ?? 0
        );
      // Leading tabs define the opening word's remaining measure. Chop the word
      // there instead of closing a line that contains only those tabs.
      const chopsAfterLeadingTabs =
        overflows &&
        canChopWord &&
        !paragraphRtl &&
        alignedTabRight === 0 &&
        !flow?.pageExclusionZones?.length &&
        sameParagraphAnchorStarts.length === 0 &&
        wordFollowsOnlyTabs(line, wordStartSpan);
      if (
        (!opensWord && penLeftWord()) ||
        (overflows && !borrowsSpace && holdsContent() && !chopsAfterLeadingTabs)
      ) {
        // Trailing spaces hang at a line end, so only the word's ink needs room where it goes.
        const inkWidth =
          clipsWordEnd && !opticalFit
            ? lineEndSpaces.wordInkWidth(candidate, measureFace)
            : undefined;
        const placeWidth = inkWidth ?? fitWidth;
        if (openDecision === 'forbidden' && (wordStartSpan < 0 || wordOpensLine())) {
          // Keep the protected seam on this line. The chop below may still use later safe
          // cuts inside an oversized Latin word; only its leading fragment must stay here.
        } else if (opensWord || wordStartSpan < 0) {
          if (tryAdvanceToNextPassage() && line.width + placeWidth <= lineAvailable() + 0.001) {
            // carry on in the next horizontal passage on this line
          } else {
            closeLine();
            if (!ensurePlacementWidth(placeWidth)) continue;
            wordStartSpan = 0;
            wordStartWidth = 0;
            wordStartEnd = line.end;
            wordStartMetrics = { height: line.height, baseline: line.baseline };
          }
        } else {
          // Mid-word overflow: a run boundary is not a break opportunity, so the whole word
          // moves to where the same text in one run would go, unless an optional hyphen fits.
          const start = carryWordAtOptionalHyphens(
            wordCarry,
            { span: wordStartSpan, width: wordStartWidth, end: wordStartEnd, ...wordStartMetrics },
            placeWidth,
            overflows,
            OVERFLOW_TOLERANCE_PT
          );
          wordStartSpan = start.span;
          wordStartWidth = start.width;
          wordStartEnd = start.end;
          wordStartMetrics = { height: start.height, baseline: start.baseline };
        }
        if (inkWidth !== undefined) {
          clippedWordEnd = clipWordEndAtPen();
          width = clippedWordEnd?.width ?? naturalWidth;
        }
      } else if (!holdsContent() && fitWidth > remainingLineWidth() + 0.001) {
        // The pen of an empty line may already stand in a later passage: the test above is
        // the room ahead of it, not the line's capacity from its origin.
        if (!ensurePlacementWidth(fitWidth)) continue;
      } else if (borrowsSpace && endsParagraph(pieceIndex, boundary)) {
        // Only this admission may compress the paragraph's last line when it is aligned.
        line.spaceShrink = true;
      }
      // Overflow can close the previous line after the clearance check above.
      // Recheck the newly opened line before placing this candidate, including
      // floats that intersect its lower glyph band but not its top scanline.
      applyNarrowWrapSkipIfNeeded(candidate, faceStyle);
      // A protected group that moves must also fit against its destination line.
      if (!opticalFit && line !== opticalSourceLine) opticalFit = applyOpticalFit?.();
      // A word opening the line after a break at an optional hyphen no longer joins back
      // across it, so it is placed, and may be cut, at its unjoined width.
      const lineStartStyle =
        consumed === 0 && line.spans.length === 0 && !clippedWordEnd
          ? styleCutAtHyphen(piece.style, 'before')
          : null;
      if (lineStartStyle)
        width = measuredWidth(candidate, lineStartStyle, piece.fontSlot, measurer);
      let remaining = candidate;
      let remainingStart = piece.start + consumed;
      let remainingWidth = width;
      let remainingStyle = lineStartStyle ?? piece.style;
      if (
        canChopWord &&
        !hangs &&
        (!holdsContent() || (!opensWord && wordOpensLine()) || chopsAfterLeadingTabs) &&
        width > remainingLineWidth() + OVERFLOW_TOLERANCE_PT
      ) {
        // Only the cut word's first piece opens the line after a hyphen break.
        let opening = lineStartStyle;
        const prefixFace = () => (opening ? styleForFontSlot(opening, piece.fontSlot) : faceStyle);
        const chopped = chopOversizedWord(candidate, remainingStart, width, {
          remainingLineWidth,
          lineHasText: holdsContent,
          measureText: (text) => measurer.measure(displayText(text, prefixFace()), prefixFace()),
          appendPrefix: (prefix) => {
            const metrics = measurer.lineMetrics(faceStyle, displayText(prefix.text, faceStyle));
            line.spans.push({
              range: layoutOwned
                ? spanRange
                : {
                    paragraphId,
                    start: prefix.modelStart,
                    end: prefix.modelStart + prefix.text.length,
                  },
              text: prefix.text,
              props: piece.props,
              style: opening ?? piece.style,
              box: {
                x: lineOrigin() + line.width,
                y: 0,
                width: prefix.width,
                height: metrics.height,
              },
              ...(piece.link ? { link: piece.link } : {}),
              ...(layoutOwned ? { projected: true as const } : {}),
              ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
              ...(piece.fontSlot ? { fontSlot: piece.fontSlot } : {}),
              ...(piece.glyphOffsetPt !== undefined ? { glyphOffsetPt: piece.glyphOffsetPt } : {}),
              ...paragraphSpanMetadata(piece),
            });
            line.width += prefix.width;
            growLineMetricsForText(line, metrics, prefix.text, faceStyle);
            line.end = layoutOwned ? piece.end : prefix.modelStart + prefix.text.length;
            opening = null;
          },
          closeLine,
          // A line the cut closes ends inside the word, so the next line continues it.
          closeCutLine: () => {
            closeLine();
            previousLineCut = true;
          },
          overflowTolerancePt: OVERFLOW_TOLERANCE_PT,
          keepWithPrevious: openDecision === 'forbidden',
          // Kinsoku vetoes measured cuts: 天。地。人。 must not chop onto a leading 。.
          cutAllowedAt: textBreaks
            ? (_text, index) => textBreaks.cutAllowed(piece, consumed, index)
            : cjkChopCutAllowedAt,
        });
        remaining = chopped.text;
        remainingStart = chopped.modelStart;
        remainingWidth = chopped.width;
        remainingStyle = opening ?? piece.style;
        if (chopped.brokeLine) {
          wordStartSpan = 0;
          wordStartWidth = 0;
          wordStartEnd = line.end;
          wordStartMetrics = { height: line.height, baseline: line.baseline };
        }
      }
      // The chop leaves its final protected group pending, including oversized groups
      // whose next run may start with another closing character or combining mark.
      if (remaining.length > 0) {
        const metrics = measurer.lineMetrics(
          faceStyle,
          lineBandText(piece, displayText(remaining, faceStyle))
        );
        const span: StyleSpanRecord = {
          range: layoutOwned
            ? spanRange
            : { paragraphId, start: remainingStart, end: piece.start + boundary },
          text: remaining,
          props: piece.props,
          style: remainingStyle,
          box: {
            x: lineOrigin() + line.width,
            y: 0,
            width: remainingWidth,
            height: metrics.height,
          },
          ...(piece.link ? { link: piece.link } : {}),
          ...(layoutOwned && !piece.positionalTab ? { projected: true as const } : {}),
          ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
          ...(piece.fontSlot ? { fontSlot: piece.fontSlot } : {}),
          ...(piece.glyphOffsetPt !== undefined ? { glyphOffsetPt: piece.glyphOffsetPt } : {}),
          ...(lineEndWhitespace ? { lineEndWhitespace: true as const } : {}),
          ...paragraphSpanMetadata(piece),
        };
        if (opticalFit) appendOpticalCjkCandidate(line.spans, span, opticalFit);
        else lineEndSpaces.appendWordEnd(line.spans, span, clippedWordEnd);
        line.width += remainingWidth;
        growLineMetricsForText(line, metrics, remaining, faceStyle);
        line.end = layoutOwned ? piece.end : piece.start + boundary;
      }
      lastEmitted = candidate;
      consumed = boundary;
    }
  }
  // Retain the final line for the caret and paragraph mark; wraps do not inherit mark metrics.
  if (line.spans.length > 0 || line.drawings.length > 0 || lines.length === 0 || trailingLineBreak)
    closeLine({ includeParagraphMark: true });
  // A centred colon can use the next opening bracket's bearing only on the same line.
  // Retry once with natural colon advances instead of forcing a new unbreakable group.
  if (!preserveColonAdvances && colonLostOpeningBearing(lines))
    return breakParagraph(
      paragraph,
      paragraphId,
      indentLeft,
      available,
      measurer,
      cache,
      cacheKey,
      inheritedRunProperties,
      tabStops,
      pageContext,
      cascadeRuns,
      flow,
      true
    );
  claimTrailingChangeSites(lines);
  if (cacheKey !== null && cache)
    cache.set(cacheKey, cache.retainAcrossPasses === false ? lines : lines.map(frozenLine));
  return lines;
}
