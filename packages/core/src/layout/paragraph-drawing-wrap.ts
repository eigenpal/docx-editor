import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { verticalBandOfExclusion, type ExclusionZone } from './drawing-exclusion.ts';
import type { PendingLine } from './pending-line.ts';
import type { ParagraphFrame } from './paragraph-frame.ts';

interface WrapParagraph {
  readonly paragraph: OoxmlElement;
  readonly styleId: string | null;
  readonly contextualSpacing: boolean;
  readonly spacing: { readonly after: number };
  readonly frame?: ParagraphFrame;
}

/** Select paragraph wrap bands and track displacement caused by the following anchor. */
export function createParagraphDrawingWrap(options: {
  readonly drawingLayout?: InlineDrawingLayoutContext;
  readonly paragraphAt: (index: number) => WrapParagraph | undefined;
  readonly paragraphOrder: ReadonlyMap<string, number>;
  readonly paragraphIndex: (id: string) => number;
  readonly columnCount: number;
}) {
  // A rectangular exclusion anchored at the next paragraph can reach back into the
  // preceding paragraph's after-spacing. Its origin excludes the extra lines that
  // its own wrap caused there, just as a top-and-bottom anchor excludes its own skip.
  const displacements = new Map<string, number>();
  const followingAnchors = new Map<string, ReadonlySet<string>>();
  const followingAnchor = (zone: ExclusionZone, index: number): boolean => {
    if (
      zone.sourceKind ||
      (zone.input.mode !== 'square' && zone.input.mode !== 'topAndBottom') ||
      zone.anchorModelStart !== 0 ||
      !options.drawingLayout
    )
      return false;
    const next = options.paragraphAt(index + 1);
    if (!next || next.frame || next.paragraph.id !== zone.anchorParagraphId) return false;
    let eligible = followingAnchors.get(next.paragraph.id);
    if (!eligible) {
      eligible = new Set(
        anchoredDrawingAtomsInParagraph(next.paragraph, options.drawingLayout)
          .filter(
            ({ projection }) =>
              projection.position?.vertical.relativeFrom === 'paragraph' &&
              projection.position.vertical.align === null &&
              (projection.position.vertical.offsetEmu ?? 0) >= 0
          )
          .map(({ projection }) => projection.drawingNodeId)
      );
      followingAnchors.set(next.paragraph.id, eligible);
    }
    return eligible.has(zone.drawingNodeId);
  };
  const extent = (lines: readonly PendingLine[]) =>
    lines.reduce((sum, line) => sum + line.height + (line.exclusionSkipBefore ?? 0), 0);
  return {
    select(
      entry: WrapParagraph,
      index: number,
      columnIndex: number,
      zones: readonly ExclusionZone[],
      selection: {
        readonly placement?: boolean;
        readonly omittedAnchor?: string;
        readonly spaceBefore?: number;
      } = {}
    ): readonly ExclusionZone[] {
      const { placement = false, omittedAnchor, spaceBefore = 0 } = selection;
      return zones
        .filter((zone) => {
          if (zone.anchorParagraphId === omittedAnchor) return false;
          if (zone.sourceKind === 'furniture') return true;
          const entryOrder = options.paragraphOrder.get(entry.paragraph.id);
          const anchorOrder = options.paragraphOrder.get(zone.anchorParagraphId);
          // A page- or margin-framed band does not move when the text before it reflows, so it
          // reaches back over the whole page. A flow-framed one would chase its own anchor.
          const reachesBack =
            zone.pageFramedBand === true || (!placement && followingAnchor(zone, index));
          if (entryOrder !== undefined && anchorOrder !== undefined) {
            if (anchorOrder > entryOrder && !reachesBack) return false;
          } else {
            const anchorIndex = options.paragraphIndex(zone.anchorParagraphId);
            if (anchorIndex < 0 || (anchorIndex > index && !reachesBack)) return false;
          }
          if (options.columnCount > 1 && zone.columnIndex !== columnIndex) return false;
          return !(
            placement &&
            !zone.sourceKind &&
            zone.anchorParagraphId === entry.paragraph.id &&
            zone.input.mode === 'topAndBottom'
          );
        })
        .map((zone) => {
          if (placement || !followingAnchor(zone, index)) return zone;
          // Include the trailing gap in the predecessor's wrap probe, without adding
          // that gap to every line's height or moving the published picture.
          const next = options.paragraphAt(index + 1);
          const after =
            entry.contextualSpacing && entry.styleId !== null && entry.styleId === next?.styleId
              ? 0
              : entry.spacing.after;
          const input = {
            ...zone.input,
            wrapDistances: {
              ...zone.input.wrapDistances,
              top: zone.input.wrapDistances.top + after,
              bottom:
                zone.input.wrapDistances.bottom +
                (zone.input.mode === 'topAndBottom' ? spaceBefore : 0),
            },
          };
          // Recompute from the same arithmetic as the scanline reader: subtracting the
          // gap separately can round just outside its exclusion edge.
          return { ...zone, input, verticalBand: verticalBandOfExclusion(input) };
        });
    },
    measure(
      pageIndex: number,
      index: number,
      zones: readonly ExclusionZone[],
      lines: readonly PendingLine[],
      breakWithout: (anchorId: string) => readonly PendingLine[]
    ): void {
      // All eligible zones belong to the immediately following paragraph. Omit its
      // complete set once, even when it owns several pictures.
      const zone = zones.find((candidate) => followingAnchor(candidate, index));
      if (zone)
        displacements.set(
          `${pageIndex}:${zone.anchorParagraphId}`,
          Math.max(0, extent(lines) - extent(breakWithout(zone.anchorParagraphId)))
        );
    },
    displacement(pageIndex: number, paragraphId: string): number {
      return displacements.get(`${pageIndex}:${paragraphId}`) ?? 0;
    },
  };
}
