/**
 * Pure layout algorithm: given a list of sidebar items + their
 * anchor sources, return a list of resolved Y positions with
 * collision avoidance applied. Lifted from React's
 * components/sidebar/resolveItemPositions.ts so the Vue adapter
 * can call it directly.
 *
 * The algorithm walks the items in three priority stages:
 *   1. explicit fixedY (already in scroll-container coords)
 *   2. anchorKey lookup in anchorPositions (pagination coords)
 *   3. DOM-based anchor lookup via renderedDomContext.getRectsForRange
 *   4. last-known cache so cards don't pop out during transient layout
 *
 * Then it sorts by target Y and pushes overlapping cards down by
 * their height + MIN_CARD_GAP.
 * @packageDocumentation
 * @public
 */
import type { RenderedDomContext, SidebarItem } from './core-types';
import { MIN_CARD_GAP } from '../lib/sidebarConstants';

/** Generic sidebar item with optional fixedY / estimatedHeight. */
export interface ResolvableSidebarItem extends SidebarItem {
  fixedY?: number;
  estimatedHeight?: number;
}

export interface ResolvedPosition<T extends ResolvableSidebarItem = ResolvableSidebarItem> {
  item: T;
  y: number;
}

export function resolveItemPositions<T extends ResolvableSidebarItem>(
  items: T[],
  anchorPositions: Map<string, number>,
  renderedDomContext: RenderedDomContext | null,
  zoom: number,
  cardHeights: Map<string, number>,
  lastKnown: Map<string, number>
): ResolvedPosition<T>[] {
  if (items.length === 0) return [];

  const containerOffset = renderedDomContext?.getContainerOffset();
  const positioned: { item: T; targetY: number }[] = [];

  for (const item of items) {
    let y: number | undefined;

    // 1. explicit fixedY
    if (item.fixedY != null) {
      y = item.fixedY * zoom;
    }

    // 2. anchorKey lookup
    if (y == null && item.anchorKey) {
      const layoutY = anchorPositions.get(item.anchorKey);
      if (layoutY != null) y = layoutY * zoom;
    }

    // 3. DOM-based lookup
    if (y == null && renderedDomContext) {
      const rects = renderedDomContext.getRectsForRange(item.anchorPos, item.anchorPos + 1);
      if (rects.length > 0 && containerOffset) {
        y = (rects[0].y + containerOffset.y) * zoom;
      }
    }

    // 4. cache fallback
    if (y == null) {
      const cached = lastKnown.get(item.id);
      if (cached != null) y = cached;
    }

    if (y != null) {
      positioned.push({ item, targetY: y });
      lastKnown.set(item.id, y);
    }
  }

  positioned.sort((a, b) => {
    const dy = a.targetY - b.targetY;
    if (dy !== 0) return dy;
    return (a.item.priority ?? 0) - (b.item.priority ?? 0);
  });

  const result: ResolvedPosition<T>[] = [];
  let lastBottom = 0;
  for (const pos of positioned) {
    const rawHeight = cardHeights.get(pos.item.id) ?? pos.item.estimatedHeight ?? 80;
    const height = rawHeight * zoom;
    const gap = MIN_CARD_GAP * zoom;
    const y = Math.max(pos.targetY, lastBottom + gap);
    result.push({ item: pos.item, y });
    lastBottom = y + height;
  }
  return result;
}
