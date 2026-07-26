// Trusted navigable caret stops from layout-published navigation geometry (task 5.5).

import type { SemanticTarget } from '@docx-editor.dev/core-contract/interaction';
import { caretAffinity } from './semantic-index.ts';
import type { CaretStopProvenance, NavigationGeometry } from './navigation-geometry.ts';

export interface NavigableCaretStop {
  readonly target: Extract<SemanticTarget, { kind: 'text' }>;
  readonly graphemeOffset: number;
  readonly provenance: CaretStopProvenance;
}

/** Geometry-trusted caret stops for vertical/page/caret overlay resolution. */
export function geometryStopsForBlock(
  navigation: NavigationGeometry,
  storyId: string,
  blockId: string
): readonly NavigableCaretStop[] {
  const stops: NavigableCaretStop[] = [];
  const seen = new Set<string>();
  for (const line of navigation.visualLines) {
    if (line.identity.storyId !== storyId || line.identity.blockId !== blockId) continue;
    for (const edge of line.edges) {
      if (!edge.navigable || edge.provenance !== 'geometry') continue;
      const key = `${edge.target.graphemeOffset}:${edge.target.affinity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stops.push({
        target: edge.target,
        graphemeOffset: edge.target.graphemeOffset,
        provenance: 'geometry',
      });
    }
  }
  return stops.sort(
    (a, b) =>
      a.graphemeOffset - b.graphemeOffset || a.target.affinity.localeCompare(b.target.affinity)
  );
}

/** Horizontal transition stops: geometry trust plus semantic whole-grapheme boundaries. */
export function horizontalTransitionStopsForBlock(
  navigation: NavigationGeometry,
  storyId: string,
  blockId: string,
  paragraphGraphemeCount: number
): readonly NavigableCaretStop[] {
  const geometry = geometryStopsForBlock(navigation, storyId, blockId);
  const byOffset = new Map<number, NavigableCaretStop>();
  for (const stop of geometry) byOffset.set(stop.graphemeOffset, stop);
  const semantic = navigation.semanticHorizontalBoundariesByBlockId[blockId] ?? [];
  for (const offset of semantic) {
    if (byOffset.has(offset)) continue;
    byOffset.set(offset, {
      target: {
        kind: 'text',
        scope: geometry[0]?.target.scope ?? { kind: 'body' },
        identity: { storyId, blockId },
        graphemeOffset: offset,
        affinity: caretAffinity(offset, paragraphGraphemeCount),
      },
      graphemeOffset: offset,
      provenance: 'semanticWholeGrapheme',
    });
  }
  return [...byOffset.values()].sort(
    (a, b) =>
      a.graphemeOffset - b.graphemeOffset || a.target.affinity.localeCompare(b.target.affinity)
  );
}

/** @deprecated use geometryStopsForBlock or horizontalTransitionStopsForBlock */
export function navigableStopsForBlock(
  navigation: NavigationGeometry,
  storyId: string,
  blockId: string
): readonly NavigableCaretStop[] {
  return geometryStopsForBlock(navigation, storyId, blockId);
}

export function hasGeometryStopAtOffset(
  navigation: NavigationGeometry,
  storyId: string,
  blockId: string,
  graphemeOffset: number
): boolean {
  return geometryStopsForBlock(navigation, storyId, blockId).some(
    (stop) => stop.graphemeOffset === graphemeOffset
  );
}

export function isHorizontalTransitionOffset(
  navigation: NavigationGeometry,
  storyId: string,
  blockId: string,
  graphemeOffset: number,
  paragraphGraphemeCount: number
): boolean {
  return horizontalTransitionStopsForBlock(
    navigation,
    storyId,
    blockId,
    paragraphGraphemeCount
  ).some((stop) => stop.graphemeOffset === graphemeOffset);
}

/** @deprecated */
export function hasNavigableStopAtOffset(
  navigation: NavigationGeometry,
  storyId: string,
  blockId: string,
  graphemeOffset: number
): boolean {
  return hasGeometryStopAtOffset(navigation, storyId, blockId, graphemeOffset);
}

export function isNavigableOffset(
  navigation: NavigationGeometry,
  storyId: string,
  blockId: string,
  graphemeOffset: number,
  affinity?: Extract<SemanticTarget, { kind: 'text' }>['affinity']
): boolean {
  const stops = geometryStopsForBlock(navigation, storyId, blockId);
  if (affinity === undefined)
    return hasGeometryStopAtOffset(navigation, storyId, blockId, graphemeOffset);
  return stops.some(
    (stop) => stop.graphemeOffset === graphemeOffset && stop.target.affinity === affinity
  );
}

export function nextHorizontalTransitionStop(
  navigation: NavigationGeometry,
  head: Extract<SemanticTarget, { kind: 'text' }>,
  dir: -1 | 1,
  paragraphGraphemeCount: number
): { target: Extract<SemanticTarget, { kind: 'text' }>; provenance: CaretStopProvenance } | null {
  const stops = horizontalTransitionStopsForBlock(
    navigation,
    head.identity.storyId,
    head.identity.blockId,
    paragraphGraphemeCount
  );
  if (stops.length === 0) return null;
  const currentIndex = stops.findIndex((stop) => stop.graphemeOffset === head.graphemeOffset);
  if (currentIndex < 0) return null;
  const next = stops[currentIndex + dir];
  if (!next) return null;
  return { target: next.target, provenance: next.provenance };
}

/** @deprecated */
export function nextNavigableHorizontalStop(
  navigation: NavigationGeometry,
  head: Extract<SemanticTarget, { kind: 'text' }>,
  dir: -1 | 1
): Extract<SemanticTarget, { kind: 'text' }> | null {
  const stops = geometryStopsForBlock(navigation, head.identity.storyId, head.identity.blockId);
  if (stops.length === 0) return null;
  const currentIndex = stops.findIndex((stop) => stop.graphemeOffset === head.graphemeOffset);
  if (currentIndex < 0) return null;
  return stops[currentIndex + dir]?.target ?? null;
}
