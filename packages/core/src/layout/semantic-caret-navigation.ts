import type { IndexedCaretStops } from './semantic-caret-stop-index.ts';

interface VerticalCaretStop {
  readonly lineId: string;
  readonly x: number;
  readonly position: { readonly paragraphId: string; readonly offset: number };
}

function lineIdsOf(stops: readonly VerticalCaretStop[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const stop of stops) {
    if (seen.has(stop.lineId)) continue;
    seen.add(stop.lineId);
    ids.push(stop.lineId);
  }
  return ids;
}

function nearestOnLine<T extends VerticalCaretStop>(
  stops: readonly T[],
  lineId: string,
  targetX: number
): T | null {
  let best: T | null = null;
  for (const stop of stops) {
    if (stop.lineId !== lineId) continue;
    if (!best || Math.abs(stop.x - targetX) < Math.abs(best.x - targetX)) best = stop;
  }
  return best;
}

/** Home/End within the active paragraph's current visual line. */
export function moveToLineEdge<T extends VerticalCaretStop>(
  position: VerticalCaretStop['position'],
  direction: -1 | 1,
  indexed: IndexedCaretStops<T>
): VerticalCaretStop['position'] | null {
  const stopIndex = indexed.index.get(position.paragraphId)?.get(position.offset);
  if (stopIndex === undefined) return null;
  const lineId = indexed.stops[stopIndex]!.lineId;
  const onLine = indexed.stops.filter((stop) => stop.lineId === lineId);
  return (direction === -1 ? onLine[0] : onLine[onLine.length - 1])?.position ?? null;
}

/** Body ArrowLeft/ArrowRight using only the active and boundary-neighbour paragraphs. */
export function moveHorizontalCaret<T extends VerticalCaretStop>(
  position: VerticalCaretStop['position'],
  direction: -1 | 1,
  order: readonly string[],
  paragraphIndex: number,
  stopsForParagraph: (paragraphId: string) => IndexedCaretStops<T>
): { position: VerticalCaretStop['position']; desiredX: null } | null {
  const current = stopsForParagraph(position.paragraphId);
  const stopIndex = current.index.get(position.paragraphId)?.get(position.offset);
  if (stopIndex === undefined) return null;
  const localTarget = stopIndex + direction;
  if (localTarget >= 0 && localTarget < current.stops.length) {
    return { position: current.stops[localTarget]!.position, desiredX: null };
  }
  const neighbourId = order[paragraphIndex + direction];
  if (!neighbourId) return { position, desiredX: null };
  const neighbour = stopsForParagraph(neighbourId).stops;
  const target = direction === -1 ? neighbour[neighbour.length - 1] : neighbour[0];
  return target ? { position: target.position, desiredX: null } : null;
}

/** Ctrl/Cmd+Home/End from the first or last semantic paragraph only. */
export function moveToDocumentEdge<T extends VerticalCaretStop>(
  direction: -1 | 1,
  order: readonly string[],
  stopsForParagraph: (paragraphId: string) => IndexedCaretStops<T>
): VerticalCaretStop['position'] | null {
  const paragraphId = direction === -1 ? order[0] : order[order.length - 1];
  if (!paragraphId) return null;
  const stops = stopsForParagraph(paragraphId).stops;
  return (direction === -1 ? stops[0] : stops[stops.length - 1])?.position ?? null;
}

/** Body ArrowUp/ArrowDown without constructing caret stops for the whole document. */
export function moveVerticalCaret<T extends VerticalCaretStop>(
  position: VerticalCaretStop['position'],
  direction: -1 | 1,
  desiredX: number | null,
  order: readonly string[],
  paragraphIndex: number,
  stopsForParagraph: (paragraphId: string) => IndexedCaretStops<T>
): { position: VerticalCaretStop['position']; desiredX: number } | null {
  const current = stopsForParagraph(position.paragraphId);
  const stopIndex = current.index.get(position.paragraphId)?.get(position.offset);
  if (stopIndex === undefined) return null;
  const currentStop = current.stops[stopIndex]!;
  const targetX = desiredX ?? currentStop.x;
  const currentLines = lineIdsOf(current.stops);
  const currentLineIndex = currentLines.indexOf(currentStop.lineId);
  const localLine = currentLines[currentLineIndex + direction];
  if (localLine) {
    const target = nearestOnLine(current.stops, localLine, targetX);
    return target ? { position: target.position, desiredX: targetX } : null;
  }

  for (
    let index = paragraphIndex + direction;
    index >= 0 && index < order.length;
    index += direction
  ) {
    const neighbour = stopsForParagraph(order[index]!);
    const lines = lineIdsOf(neighbour.stops);
    const targetLine = direction === -1 ? lines[lines.length - 1] : lines[0];
    if (!targetLine) continue;
    const target = nearestOnLine(neighbour.stops, targetLine, targetX);
    if (target) return { position: target.position, desiredX: targetX };
  }

  const edge = direction === -1 ? current.stops[0] : current.stops[current.stops.length - 1];
  return edge ? { position: edge.position, desiredX: targetX } : null;
}
