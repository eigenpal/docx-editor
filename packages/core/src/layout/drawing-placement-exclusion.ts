import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
} from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  pageFramedVertically,
  synthesizeParagraphTopAndBottomZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import type { PendingLine } from './pending-line.ts';
import { holdsClearingBreak } from './text-wrapping-break-clear.ts';

const topAndBottomAnchorMemo = new WeakMap<OoxmlElement, boolean>();

/**
 * True when the paragraph anchors a `wrapTopAndBottom` drawing, or anchors a drawing and holds
 * a line break that clears floats. Its own band then depends on the paragraph's spacing before,
 * so the break cache must key that spacing.
 */
export function anchorsSpacingDependentBand(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined
): boolean {
  if (!context) return false;
  let value = topAndBottomAnchorMemo.get(paragraph);
  if (value === undefined) {
    const atoms = anchoredDrawingAtomsInParagraph(paragraph, context);
    value =
      atoms.some((atom) => atom.projection.wrap === 'topAndBottom') ||
      (atoms.length > 0 && holdsClearingBreak(paragraph));
    topAndBottomAnchorMemo.set(paragraph, value);
  }
  return value;
}

/** What the break cache keys for a paragraph's own spacing-dependent band. */
export interface OwnBandKeyInputs {
  /** The paragraph synthesizes its own band during the break (see above). */
  readonly anchorsTopAndBottom: boolean;
  /**
   * The band sits at a fixed page position (a page- or margin-framed vertical frame), so the
   * lines around it depend on where the paragraph starts on the page.
   */
  readonly ownBandPageFramed: boolean;
}

const NO_OWN_BAND: OwnBandKeyInputs = Object.freeze({
  anchorsTopAndBottom: false,
  ownBandPageFramed: false,
});
const ownBandMemo = new WeakMap<OoxmlElement, OwnBandKeyInputs>();

/** The own-band inputs of a paragraph's break key; one frozen answer per paragraph node. */
export function ownBandKeyInputs(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined
): OwnBandKeyInputs {
  if (!context || !anchorsSpacingDependentBand(paragraph, context)) return NO_OWN_BAND;
  let value = ownBandMemo.get(paragraph);
  if (value === undefined) {
    const ownBandPageFramed = anchoredDrawingAtomsInParagraph(paragraph, context).some((atom) => {
      const vertical = atom.projection.position?.vertical;
      return (
        !!vertical &&
        !atom.projection.anchor?.simplePos &&
        pageFramedVertically(vertical.relativeFrom)
      );
    });
    value = Object.freeze({ anchorsTopAndBottom: true, ownBandPageFramed });
    ownBandMemo.set(paragraph, value);
  }
  return value;
}

// By context first: whether an atom is anchored can depend on `projectionForAtom`.
const anyAnchorMemo = new WeakMap<InlineDrawingLayoutContext, WeakMap<OoxmlElement, boolean>>();

/** True when the paragraph anchors any drawing, whose own band then moves with the paragraph. */
export function anchorsAnyDrawing(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined
): boolean {
  if (!context) return false;
  let byParagraph = anyAnchorMemo.get(context);
  if (!byParagraph) {
    byParagraph = new WeakMap();
    anyAnchorMemo.set(context, byParagraph);
  }
  let value = byParagraph.get(paragraph);
  if (value === undefined) {
    value = anchoredDrawingAtomsInParagraph(paragraph, context).length > 0;
    byParagraph.set(paragraph, value);
  }
  return value;
}

/** Placeholder lines preceding a floating atom do not inherit its placement skip. */
export function anchorLineSkipsExclusion(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined,
  line: PendingLine
): boolean {
  // A break's clearance belongs to the break, not to the paragraph's anchors.
  if (!context || line.breakClearance) return false;
  const offsets = drawingModelOffsetsInParagraph(paragraph);
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, context);
  const starts = atoms
    .map((atom) => offsets.get(atom.atomId))
    .filter((offset): offset is number => offset !== undefined);
  if (starts.length === 0) return false;
  const first = starts.reduce((minimum, start) => Math.min(minimum, start), Infinity);
  if (line.end <= first) return true;
  return (
    starts.some((start) => start >= line.start && start < line.end) &&
    line.end <= first + 1 &&
    !atoms.some((atom) => {
      const start = offsets.get(atom.atomId);
      return (
        atom.projection.wrap === 'topAndBottom' &&
        start !== undefined &&
        start >= line.start &&
        start < line.end
      );
    })
  );
}

/** Combine page exclusions with anchors encountered earlier in this paragraph fragment. */
export function drawingZonesAtLinePlacement(
  options: Omit<
    Parameters<typeof synthesizeParagraphTopAndBottomZones>[0],
    'anchorLineTopByModelStart'
  > & {
    readonly pageZones: readonly ExclusionZone[];
    readonly brokenLines: readonly PendingLine[];
    readonly lineIndex: number;
    readonly fragmentFirstLine: number;
    readonly appliedSkipByLineIndex: ReadonlyMap<number, number>;
  }
): readonly ExclusionZone[] {
  const { pageZones, brokenLines, lineIndex, fragmentFirstLine, appliedSkipByLineIndex } = options;
  if (lineIndex <= fragmentFirstLine) return pageZones;
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const anchorLineTopByModelStart = new Map<number, number>();
  let extent = 0;
  for (let index = fragmentFirstLine; index < lineIndex; index++) {
    const line = brokenLines[index]!;
    for (const modelStart of offsets.values()) {
      if (modelStart >= line.start && modelStart < line.end)
        anchorLineTopByModelStart.set(modelStart, extent);
    }
    extent += (appliedSkipByLineIndex.get(index) ?? line.exclusionSkipBefore ?? 0) + line.height;
  }
  if (anchorLineTopByModelStart.size === 0) return pageZones;
  return Object.freeze([
    ...pageZones,
    ...synthesizeParagraphTopAndBottomZones({ ...options, anchorLineTopByModelStart }),
  ]);
}
