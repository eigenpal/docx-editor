// Engine line catalog for keyboard navigation (task 5.5).
// Consumes layout-published visual line records — never Y-bucketing or interpolation.

import type {
  InteractionFrame,
  InteractionRole,
  SemanticTarget,
} from '@docx-editor.dev/core-contract/interaction';
import type { Point } from '@docx-editor.dev/core-contract/types';
import { scopesEqual } from './bidi-policy.ts';
import { pageLocalToContent, pageStackBox } from './coordinate-mapper.ts';
import { caretOverlayForTarget } from './interaction-geometry.ts';
import type { NavigationGeometry, VisualLineRecord } from './navigation-geometry.ts';

export interface LineCaretStop {
  readonly target: Extract<SemanticTarget, { kind: 'text' }>;
  readonly role: InteractionRole;
  readonly pageIndex: number;
  readonly contentX: number;
  readonly contentY: number;
  readonly line: VisualLineRecord['line'];
}

export interface VisualLine {
  readonly pageIndex: number;
  readonly lineOrder: number;
  readonly fragmentOrder: number;
  readonly storyId: string;
  readonly blockId: string;
  readonly scope: VisualLineRecord['scope'];
  readonly line: VisualLineRecord['line'];
  readonly contentY: number;
  readonly stops: readonly LineCaretStop[];
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === 'object') deepFreeze(child);
  }
  return value;
}

function targetsEqual(
  a: Extract<SemanticTarget, { kind: 'text' }>,
  b: Extract<SemanticTarget, { kind: 'text' }>,
): boolean {
  return (
    a.graphemeOffset === b.graphemeOffset &&
    a.affinity === b.affinity &&
    a.identity.storyId === b.identity.storyId &&
    a.identity.blockId === b.identity.blockId &&
    scopesEqual(a.scope, b.scope)
  );
}

function edgeToStop(frame: InteractionFrame, line: VisualLineRecord, edge: VisualLineRecord['edges'][number]): LineCaretStop | null {
  const stacked = pageStackBox(frame, line.pageIndex);
  if (!stacked) return null;
  const content = pageLocalToContent(line.pageIndex, { x: edge.pageLocalX, y: edge.pageLocalY + edge.pageLocalHeight / 2 }, frame);
  if (!content.ok) return null;
  return {
    target: deepFreeze({
      ...edge.target,
      identity: deepFreeze({ ...edge.target.identity }),
    }),
    role: edge.role,
    pageIndex: line.pageIndex,
    contentX: content.value.x,
    contentY: content.value.y,
    line: line.line,
  };
}

function stopVisible(
  frame: InteractionFrame,
  navigation: NavigationGeometry | null | undefined,
  stop: LineCaretStop,
): boolean {
  const overlay = caretOverlayForTarget(frame, navigation, stop.target);
  return overlay !== null && overlay !== 'singular';
}

/** Build visual lines from layout-published navigation geometry only. */
export function buildLineCatalog(
  frame: InteractionFrame,
  navigation: NavigationGeometry | null | undefined,
): { ok: true; lines: readonly VisualLine[] } | { ok: false; reason: string } {
  const published = navigation?.visualLines;
  if (!published || published.length === 0) {
    return { ok: false, reason: 'interaction frame lacks layout-published visual lines' };
  }

  const lines: VisualLine[] = [];
  for (const record of published) {
    const stops: LineCaretStop[] = [];
    for (const edge of record.edges) {
      const stop = edgeToStop(frame, record, edge);
      if (!stop) return { ok: false, reason: 'visual line edge geometry is not invertible' };
      if (!stopVisible(frame, navigation, stop)) continue;
      if (!stops.some((existing) => targetsEqual(existing.target, stop.target))) stops.push(stop);
    }
    if (stops.length === 0) continue;
    const contentY = stops.reduce((sum, stop) => sum + stop.contentY, 0) / stops.length;
    lines.push({
      pageIndex: record.pageIndex,
      lineOrder: record.lineOrder,
      fragmentOrder: record.fragmentOrder,
      storyId: record.identity.storyId,
      blockId: record.identity.blockId,
      scope: record.scope,
      line: record.line,
      contentY,
      stops: deepFreeze(stops.map((stop) => deepFreeze({ ...stop, target: deepFreeze({ ...stop.target, identity: deepFreeze({ ...stop.target.identity }) }) }))),
    });
  }

  if (lines.length === 0) {
    return { ok: false, reason: 'no visible layout-published visual lines remain after clip filtering' };
  }

  return { ok: true, lines: deepFreeze(lines) };
}

export function lineForTarget(
  lines: readonly VisualLine[],
  target: Extract<SemanticTarget, { kind: 'text' }>,
  frame: InteractionFrame,
  navigation: NavigationGeometry | null | undefined,
): VisualLine | null {
  const line =
    lines.find((line) => line.stops.some((stop) => targetsEqual(stop.target, target))) ??
    lines.find((line) =>
      line.stops.some(
        (stop) =>
          stop.target.identity.storyId === target.identity.storyId &&
          stop.target.identity.blockId === target.identity.blockId &&
          stop.target.graphemeOffset === target.graphemeOffset &&
          scopesEqual(stop.target.scope, target.scope),
      ),
    ) ??
    null;
  if (!line) return null;
  const overlay = caretOverlayForTarget(frame, navigation, target);
  if (!overlay || overlay === 'singular') return null;
  return line;
}

export function nearestStopOnLine(line: VisualLine, contentX: number): LineCaretStop {
  let best = line.stops[0]!;
  let bestDist = Math.abs(best.contentX - contentX);
  for (const stop of line.stops) {
    const dist = Math.abs(stop.contentX - contentX);
    if (dist < bestDist - 1e-9) {
      best = stop;
      bestDist = dist;
    } else if (Math.abs(dist - bestDist) <= 1e-9 && stop.contentX > best.contentX) {
      best = stop;
    }
  }
  return best;
}

export function caretContentX(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
  navigation: NavigationGeometry | null | undefined,
): number | 'singular' | null {
  const catalog = buildLineCatalog(frame, navigation);
  if (!catalog.ok) return 'singular';
  const line = lineForTarget(catalog.lines, target, frame, navigation);
  if (!line) return null;
  const stop =
    line.stops.find((s) => targetsEqual(s.target, target)) ??
    line.stops.find(
      (s) =>
        s.target.identity.storyId === target.identity.storyId &&
        s.target.identity.blockId === target.identity.blockId &&
        s.target.graphemeOffset === target.graphemeOffset &&
        scopesEqual(s.target.scope, target.scope),
    );
  return stop?.contentX ?? null;
}

export function pageRelativeY(frame: InteractionFrame, pageIndex: number, contentY: number): number | null {
  const stacked = pageStackBox(frame, pageIndex);
  if (!stacked) return null;
  return contentY - stacked.y;
}

export function contentPointOnPage(
  frame: InteractionFrame,
  pageIndex: number,
  pageRelativeYValue: number,
  contentX: number,
): Point | null {
  const point = pageLocalToContent(pageIndex, { x: 0, y: pageRelativeYValue }, frame);
  if (!point.ok) return null;
  return { x: contentX, y: point.value.y };
}

export function stopsForBlock(lines: readonly VisualLine[], storyId: string, blockId: string): readonly LineCaretStop[] {
  return lines.filter((line) => line.storyId === storyId && line.blockId === blockId).flatMap((line) => line.stops);
}

export function measuredWhitespaceOffset(
  navigation: NavigationGeometry | null | undefined,
  blockId: string,
  graphemeOffset: number,
): boolean {
  return (
    navigation?.visualLines.some((line) =>
      line.identity.blockId === blockId && line.edges.some((edge) => edge.target.graphemeOffset === graphemeOffset),
    ) ?? false
  );
}

export function destinationOverlayVisible(
  frame: InteractionFrame,
  navigation: NavigationGeometry | null | undefined,
  target: Extract<SemanticTarget, { kind: 'text' }>,
): boolean {
  const overlay = caretOverlayForTarget(frame, navigation, target);
  return overlay !== null && overlay !== 'singular';
}
