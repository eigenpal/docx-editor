import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
} from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { synthesizeParagraphTopAndBottomZones, type ExclusionZone } from './drawing-exclusion.ts';
import type { PendingLine } from './pending-line.ts';

/** Placeholder lines preceding a floating atom do not inherit its placement skip. */
export function anchorLineSkipsExclusion(
  paragraph: OoxmlElement,
  context: InlineDrawingLayoutContext | undefined,
  line: PendingLine
): boolean {
  if (!context) return false;
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
