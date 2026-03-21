import type { RenderedDomContext } from '../../plugin-api/types';
import type { ReactSidebarItem } from '../../plugin-api/types';
import { MIN_CARD_GAP } from './constants';

export interface ResolvedPosition {
  item: ReactSidebarItem;
  y: number;
}

/**
 * Resolve Y positions for sidebar items, then run collision avoidance.
 *
 * Position sources (in priority order):
 * 1. anchorKey → anchorPositions Map (layout-engine-computed, zoom-scaled)
 * 2. anchorPos → renderedDomContext.getRectsForRange (DOM-based)
 * 3. lastKnown cache (prevents items vanishing during layout transitions)
 */
export function resolveItemPositions(
  items: ReactSidebarItem[],
  anchorPositions: Map<string, number>,
  renderedDomContext: RenderedDomContext | null,
  zoom: number,
  cardHeights: Map<string, number>,
  lastKnown: Map<string, number>
): ResolvedPosition[] {
  if (items.length === 0) return [];

  const containerOffset = renderedDomContext?.getContainerOffset();
  const positioned: { item: ReactSidebarItem; targetY: number }[] = [];

  for (const item of items) {
    let y: number | undefined;

    // Source 0: explicit fixed Y (pre-computed, already in scroll-container coords)
    if (item.fixedY != null) {
      y = item.fixedY * zoom;
    }

    // Source 1: pre-computed anchor positions (layout engine)
    if (y == null && item.anchorKey) {
      const layoutY = anchorPositions.get(item.anchorKey);
      if (layoutY != null) {
        y = layoutY * zoom;
      }
    }

    // Source 2: DOM-based position lookup
    // getRectsForRange and getContainerOffset return unscaled coords (divided by zoom),
    // so we multiply by zoom to match anchorPositions coordinate space.
    if (y == null && renderedDomContext) {
      const rects = renderedDomContext.getRectsForRange(item.anchorPos, item.anchorPos + 1);
      if (rects.length > 0 && containerOffset) {
        y = (rects[0].y + containerOffset.y) * zoom;
      }
    }

    // Source 3: last known position (cache)
    if (y == null) {
      const cached = lastKnown.get(item.id);
      if (cached != null) {
        y = cached;
      }
    }

    if (y != null) {
      positioned.push({ item, targetY: y });
      lastKnown.set(item.id, y);
    }
  }

  // Sort by target Y, then by priority
  positioned.sort((a, b) => {
    const dy = a.targetY - b.targetY;
    if (dy !== 0) return dy;
    return (a.item.priority ?? 0) - (b.item.priority ?? 0);
  });

  // Collision avoidance: push overlapping items down
  const result: ResolvedPosition[] = [];
  let lastBottom = 0;

  for (const pos of positioned) {
    const height = cardHeights.get(pos.item.id) ?? pos.item.estimatedHeight ?? 80;
    const y = Math.max(pos.targetY, lastBottom + MIN_CARD_GAP);
    result.push({ item: pos.item, y });
    lastBottom = y + height;
  }

  return result;
}
