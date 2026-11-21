// Placing one body line: its spans and inline pictures at the pen, aligned inside the line's
// measure, as the line record a page publishes.
//
// A full pass over content that did not change places most lines where an earlier pass placed
// them: a footnote reserve round, a pass in another layout session, a pass after an edit
// further down. The break cache hands every such pass the same frozen broken line, so what the
// last placements of that line produced is kept beside it:
//
// - A placement whose inputs all equal a kept one takes its record: no span is copied and
//   nothing is aligned or measured again.
// - A placement that differs only in the line's top takes the kept record moved to that top.
//   Alignment works along the line and never reads its top.
//
// What a placement reads, and so what a kept one is compared by:
//
// - the broken line itself, by identity. It carries the spans with their tab and float
//   positions, the passages a float left the line, the first-line offset, the space-shrink and
//   space-compression flags, and the hanging punctuation.
// - the paragraph id and the line's index in the paragraph, which name the record.
// - where the line sits: its top, the column's left edge, the paragraph's left indent, and the
//   width its lines have.
// - how it aligns: the alignment, the paragraph direction, whether it is the paragraph's last
//   line, the paragraph properties and the style cascade (the last-line and distribution rules
//   and the East Asian spacing settings), and the measurer.
//
// A few tops are kept, because a search for footnote reserves places a line at trial tops and
// then again at the top the published layout has. Records are held weakly: a kept placement
// never keeps a line record alive that no layout holds, and a record that is gone is placed
// again.
//
// A line with inline pictures is placed every time: a picture is also clipped to its column
// and to the page's body band, which no line owns. A line the break cache does not hold is not
// frozen, and is placed every time too.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { bodyLineId } from './body-line-id.ts';
import { shiftInlineDrawingRecord, type InlineDrawingRecord } from './drawing-layout.ts';
import { alignLineWithPictures } from './line-picture-alignment.ts';
import {
  alignBodyLineSpans,
  lineAlignmentMeasure,
  lineAlignOffset,
  type Alignment,
} from './paragraph-alignment.ts';
import { lineBreakAfterFields, lineContentX, type PendingLine } from './pending-line.ts';
import type { LineRecord, TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/** Everything one placement of a body line reads. */
export interface BodyLinePlacement {
  readonly pendingLine: PendingLine;
  readonly paragraphId: string;
  /** The line's index among its paragraph's lines. */
  readonly lineIndex: number;
  readonly isLastLine: boolean;
  /** The line's top in the page's content box. */
  readonly y: number;
  /** The left edge of the column the line is in. */
  readonly columnX: number;
  /** The paragraph's left indent. */
  readonly indentLeft: number;
  /** The width the paragraph's lines have, before any first-line offset. */
  readonly available: number;
  readonly rtl: boolean;
  readonly alignment: Alignment;
  readonly props: readonly OoxmlProperty[];
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly measurer: TextMeasurer;
  /** Clip a placed inline picture to its column and to the page's body band. */
  readonly clipDrawing: (drawing: InlineDrawingRecord) => InlineDrawingRecord;
}

/** A placed line, and how far alignment moved its content. */
export interface PlacedBodyLine {
  readonly record: LineRecord;
  readonly alignOffset: number;
}

/**
 * How each input of a placement reaches the kept placement. Every input is named here, so a new
 * one does not compile until it is given a role:
 *
 * - `line`: the frozen broken line, the key the placement is kept under.
 * - `top`: the line's top, kept with each record.
 * - `compared`: compared with the kept value. One that differs places the line in full.
 * - `pictures`: read only for a line with inline pictures, which is never kept.
 */
const PLACEMENT_INPUT_ROLES = {
  pendingLine: 'line',
  y: 'top',
  paragraphId: 'compared',
  lineIndex: 'compared',
  isLastLine: 'compared',
  columnX: 'compared',
  indentLeft: 'compared',
  available: 'compared',
  rtl: 'compared',
  alignment: 'compared',
  props: 'compared',
  styleCascade: 'compared',
  measurer: 'compared',
  clipDrawing: 'pictures',
} as const satisfies Record<keyof BodyLinePlacement, 'line' | 'top' | 'compared' | 'pictures'>;

type ComparedInput = {
  [
    Key in keyof typeof PLACEMENT_INPUT_ROLES
  ]: (typeof PLACEMENT_INPUT_ROLES)[Key] extends 'compared' ? Key : never;
}[keyof typeof PLACEMENT_INPUT_ROLES];

const COMPARED_INPUTS = (Object.keys(PLACEMENT_INPUT_ROLES) as (keyof BodyLinePlacement)[]).filter(
  (key): key is ComparedInput => PLACEMENT_INPUT_ROLES[key] === 'compared'
);

/** One top a line was placed at, and the record of that placement while a layout holds it. */
interface KeptRecord {
  readonly y: number;
  readonly record: WeakRef<LineRecord>;
  /** Whether a later placement took this record: a top a search or a layout came back to. */
  reused: boolean;
}

/** What the last placements of one frozen line read and produced. */
interface KeptPlacement {
  readonly inputs: Pick<BodyLinePlacement, ComparedInput>;
  readonly alignOffset: number;
  /** The placements at the last tops, newest first, at most {@link MAX_KEPT_TOPS}. */
  readonly tops: KeptRecord[];
}

/**
 * Tops kept for one line. A search for footnote reserves places a line at trial tops, then
 * again at the top a published layout holds it at. When a new top makes one too many, the
 * oldest top that no placement came back to goes: a trial top of an earlier search. A top that
 * a placement came back to stays while another can go.
 */
const MAX_KEPT_TOPS = 4;

/** The last placements of each frozen broken line. An entry lives as long as its line does. */
const keptPlacements = new WeakMap<PendingLine, KeptPlacement>();

interface PlacementObserver {
  placed: number;
  moved: number;
  reused: number;
  readonly disabled: boolean;
  readonly previous: PlacementObserver | null;
}

let observer: PlacementObserver | null = null;

/**
 * @internal Counts body lines by how they were placed, for tests that must see the reuse:
 * `placed` in full, `moved` from a kept placement at another top without aligning again, and
 * `reused` as the record of a kept placement. `disabled` places every line in full, exactly as
 * without the reuse. A recorder made while another is active counts until it is disposed, then
 * the other counts again.
 *
 * The recorder is one module variable, as the other layout test recorders are. With none
 * active, a placement reads it once and finds it null.
 */
export function bodyLinePlacementTestRecorder(disabled = false): {
  readonly placed: number;
  readonly moved: number;
  readonly reused: number;
  dispose(): void;
} {
  const counts: PlacementObserver = {
    placed: 0,
    moved: 0,
    reused: 0,
    disabled,
    previous: observer,
  };
  observer = counts;
  return {
    get placed() {
      return counts.placed;
    },
    get moved() {
      return counts.moved;
    },
    get reused() {
      return counts.reused;
    },
    dispose() {
      if (observer === counts) observer = counts.previous;
    },
  };
}

/** Whether `kept` read what `placement` reads, the line's top aside. */
function sameAlignment(kept: KeptPlacement, placement: BodyLinePlacement): boolean {
  for (const key of COMPARED_INPUTS) if (kept.inputs[key] !== placement[key]) return false;
  return true;
}

/** The compared inputs of `placement`. The type names each one, so none can be left out. */
function comparedInputs(placement: BodyLinePlacement): Pick<BodyLinePlacement, ComparedInput> {
  return {
    paragraphId: placement.paragraphId,
    lineIndex: placement.lineIndex,
    isLastLine: placement.isLastLine,
    columnX: placement.columnX,
    indentLeft: placement.indentLeft,
    available: placement.available,
    rtl: placement.rtl,
    alignment: placement.alignment,
    props: placement.props,
    styleCascade: placement.styleCascade,
    measurer: placement.measurer,
  };
}

/**
 * A kept record is in every layout that placed its line there, so nothing may change it. The
 * record, its box, each span, and each span box are frozen, so a write to one of them fails at
 * once. Every span here is a copy this module or alignment made for the record, never a span of
 * the broken line or of another record.
 *
 * The span list itself is not frozen. A frozen array is slower to freeze and to read in some
 * script engines than all the other freezes together, and every reader of a line walks its
 * spans. The list is typed `readonly`, and nothing reorders or resizes the spans of a published
 * line.
 */
function shared(record: LineRecord): LineRecord {
  for (const span of record.spans) {
    Object.freeze(span.box);
    Object.freeze(span);
  }
  Object.freeze(record.box);
  return Object.freeze(record);
}

/** Make room for one more top; see {@link MAX_KEPT_TOPS}. */
function dropOneTop(tops: KeptRecord[]): void {
  for (let index = tops.length - 1; index >= 0; index -= 1) {
    if (!tops[index]!.reused) {
      tops.splice(index, 1);
      return;
    }
  }
  tops.pop();
}

/** `record` with its box and every span box at the top `y`. Nothing else of a line holds a top. */
function atTop(record: LineRecord, y: number): LineRecord {
  return {
    ...record,
    spans: record.spans.map((span) => ({ ...span, box: { ...span.box, y } })),
    box: { ...record.box, y },
  };
}

function place(placement: BodyLinePlacement): PlacedBodyLine {
  const { pendingLine, paragraphId, y, columnX, rtl, alignment } = placement;
  const firstLineOffset = pendingLine.firstLineOffset ?? 0;
  const lineIndent = columnX + placement.indentLeft + (rtl ? 0 : firstLineOffset);
  const lineAvailableWidth = Math.max(1, placement.available - firstLineOffset);
  // Spans and inline drawings come from one pen, so they share one origin.
  const penX = columnX - (rtl ? firstLineOffset : 0);
  const placedSpans = pendingLine.spans.map((span) => ({
    ...span,
    // The broken range already names this paragraph unless a shared break was reused.
    range: span.range.paragraphId === paragraphId ? span.range : { ...span.range, paragraphId },
    box: { ...span.box, x: span.box.x + penX, y },
  }));
  // A line aligns inside the passage a float leaves it, not inside the page margins.
  const measure = lineAlignmentMeasure(pendingLine, penX, lineIndent, lineAvailableWidth);
  const placedDrawings = pendingLine.drawings.map((drawing) =>
    Object.freeze({ ...shiftInlineDrawingRecord(drawing, penX, y), paragraphId })
  );
  const content = alignLineWithPictures(
    placedSpans,
    placedDrawings,
    rtl,
    (spans) =>
      alignBodyLineSpans(
        spans,
        placement.measurer,
        measure,
        alignment,
        placement.props,
        pendingLine,
        placement.isLastLine,
        placement.styleCascade,
        rtl
      ),
    (aligned) => lineAlignOffset(placedSpans, aligned, alignment, measure.available, measure.used)
  );
  const { spans: alignedSpans, offset: alignOffset } = content;
  // Clip where alignment put each picture: paper or mid-gap sideways, the body band vertically.
  const alignedDrawings =
    content.drawings.length > 0 ? content.drawings.map(placement.clipDrawing) : content.drawings;
  const record: LineRecord = {
    id: bodyLineId(paragraphId, pendingLine.start, placement.lineIndex),
    range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
    spans: alignedSpans,
    box: {
      x: columnX + placement.indentLeft,
      y,
      width: placement.available,
      height: pendingLine.height,
    },
    contentX: lineContentX(alignedSpans, alignedDrawings, lineIndent + alignOffset),
    baseline: pendingLine.baseline,
    leading: pendingLine.leading,
    trailingSpacing: pendingLine.trailingSpacing,
    ...(pendingLine.characterFillBand ? { characterFillBand: pendingLine.characterFillBand } : {}),
    ...(pendingLine.manualBreakAfter ? { manualBreakAfter: true } : {}),
    ...lineBreakAfterFields(pendingLine),
    ...(pendingLine.deletedRanges ? { deletedRanges: pendingLine.deletedRanges } : {}),
    ...(alignedDrawings.length > 0 ? { drawings: alignedDrawings } : {}),
    ...(pendingLine.anchorRevisions ? { anchorRevisions: pendingLine.anchorRevisions } : {}),
    ...(pendingLine.changeSites ? { changeSites: pendingLine.changeSites } : {}),
  };
  return { record, alignOffset };
}

/**
 * The line record of `placement.pendingLine` placed and aligned at `placement`, and the offset
 * alignment gave its content. Equal placements of one frozen line return one record.
 */
export function placeBodyLine(placement: BodyLinePlacement): PlacedBodyLine {
  const { pendingLine, y } = placement;
  const counts = observer;
  // Only a frozen line is the same line in a later pass, and only it can never change.
  const keeps =
    counts?.disabled !== true && pendingLine.drawings.length === 0 && Object.isFrozen(pendingLine);
  if (!keeps) {
    if (counts) counts.placed += 1;
    return place(placement);
  }
  const kept = keptPlacements.get(pendingLine);
  if (kept && sameAlignment(kept, placement)) {
    let source: LineRecord | undefined;
    for (let index = 0; index < kept.tops.length; index += 1) {
      const top = kept.tops[index]!;
      const record = top.record.deref();
      if (!record) {
        // No layout holds this placement any more.
        kept.tops.splice(index, 1);
        index -= 1;
        continue;
      }
      if (top.y === y) {
        top.reused = true;
        if (counts) counts.reused += 1;
        return { record, alignOffset: kept.alignOffset };
      }
      source ??= record;
    }
    if (source) {
      const record = shared(atTop(source, y));
      if (kept.tops.length >= MAX_KEPT_TOPS) dropOneTop(kept.tops);
      kept.tops.unshift({ y, record: new WeakRef(record), reused: false });
      if (counts) counts.moved += 1;
      return { record, alignOffset: kept.alignOffset };
    }
  }
  if (counts) counts.placed += 1;
  const placed = place(placement);
  keptPlacements.set(pendingLine, {
    inputs: comparedInputs(placement),
    alignOffset: placed.alignOffset,
    tops: [{ y, record: new WeakRef(shared(placed.record)), reused: false }],
  });
  return placed;
}
