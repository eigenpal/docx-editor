/**
 * UnifiedSidebar
 *
 * Renders sidebar items from any source (comments, template tags, plugins)
 * in a single column with shared collision avoidance and positioning.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { ReactSidebarItem, RenderedDomContext } from '../plugin-api/types';
import { SIDEBAR_WIDTH, SIDEBAR_PAGE_GAP, SIDEBAR_DOCUMENT_SHIFT } from './sidebar/constants';
import { resolveItemPositions } from './sidebar/resolveItemPositions';
import { useTranslation } from '../i18n';

export { SIDEBAR_WIDTH, SIDEBAR_PAGE_GAP, SIDEBAR_DOCUMENT_SHIFT } from './sidebar/constants';

export interface UnifiedSidebarProps {
  items: ReactSidebarItem[];
  anchorPositions: Map<string, number>;
  renderedDomContext: RenderedDomContext | null;
  pageWidth: number;
  zoom: number;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  onExpandedItemChange?: (itemId: string | null) => void;
  /** Controlled: sidebar item to expand based on cursor position. */
  activeItemId?: string | null;
}

export function UnifiedSidebar({
  items,
  anchorPositions,
  renderedDomContext,
  pageWidth,
  zoom,
  editorContainerRef,
  onExpandedItemChange,
  activeItemId,
}: UnifiedSidebarProps) {
  const { t } = useTranslation();
  // Fully controlled: parent owns expansion state via activeItemId
  const expandedItem = activeItemId ?? null;

  const [initialPositionsDone, setInitialPositionsDone] = useState(false);
  const cardHeightsRef = useRef<Map<string, number>>(new Map());
  const lastKnownRef = useRef<Map<string, number>>(new Map());
  const knownCardsRef = useRef<Set<string>>(new Set());
  const sidebarRef = useRef<HTMLDivElement>(null);
  const cardElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Stable ref callbacks per item ID — avoids creating new closures on every render
  const measureRefsRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());

  const [positionVersion, setPositionVersion] = useState(0);

  const resolved = useMemo(
    () =>
      resolveItemPositions(
        items,
        anchorPositions,
        renderedDomContext,
        zoom,
        cardHeightsRef.current,
        lastKnownRef.current
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, anchorPositions, renderedDomContext, zoom, positionVersion]
  );

  const hasPositions = resolved.length > 0;

  // Build position map for O(1) lookup by item ID
  const positionMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of resolved) {
      map.set(r.item.id, r.y);
    }
    return map;
  }, [resolved]);

  // Track newly positioned cards in an effect (not during render)
  useEffect(() => {
    for (const r of resolved) {
      knownCardsRef.current.add(r.item.id);
    }
  }, [resolved]);

  useEffect(() => {
    const timerQuick = setTimeout(() => setPositionVersion((v) => v + 1), 50);
    const timerFull = setTimeout(() => {
      setPositionVersion((v) => v + 1);
      setInitialPositionsDone(true);
    }, 400);

    return () => {
      clearTimeout(timerQuick);
      clearTimeout(timerFull);
    };
  }, [items.length]);

  useEffect(() => {
    const container = editorContainerRef?.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => setPositionVersion((v) => v + 1));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [editorContainerRef]);

  // Re-measure ALL card heights after expand/collapse so collision avoidance
  // uses up-to-date sizes (the ref callback only fires on mount, not resize).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      for (const [id, el] of cardElsRef.current) {
        cardHeightsRef.current.set(id, el.offsetHeight);
      }
      setPositionVersion((v) => v + 1);
    });
    return () => cancelAnimationFrame(raf);
  }, [expandedItem]);

  // Watch expanded card for ongoing size changes (e.g. typing in reply input)
  useEffect(() => {
    if (!expandedItem) return;
    const el = cardElsRef.current.get(expandedItem);
    if (!el) {
      // Card just expanded but element not measured yet — trigger one recalc
      const raf = requestAnimationFrame(() => setPositionVersion((v) => v + 1));
      return () => cancelAnimationFrame(raf);
    }

    let rafId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        cardHeightsRef.current.set(expandedItem, el.offsetHeight);
        setPositionVersion((v) => v + 1);
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [expandedItem]);

  const getMeasureRef = useCallback((itemId: string): ((el: HTMLDivElement | null) => void) => {
    let fn = measureRefsRef.current.get(itemId);
    if (!fn) {
      fn = (el: HTMLDivElement | null) => {
        if (el) {
          cardElsRef.current.set(itemId, el);
          cardHeightsRef.current.set(itemId, el.offsetHeight);
        } else {
          cardElsRef.current.delete(itemId);
          cardHeightsRef.current.delete(itemId);
        }
      };
      measureRefsRef.current.set(itemId, fn);
    }
    return fn;
  }, []);

  const toggleExpand = useCallback(
    (itemId: string) => {
      onExpandedItemChange?.(expandedItem === itemId ? null : itemId);
    },
    [expandedItem, onExpandedItemChange]
  );

  if (items.length === 0) return null;

  return (
    <aside
      ref={sidebarRef}
      className="docx-unified-sidebar"
      role="complementary"
      aria-label={t('sidebar.ariaLabel')}
      style={{
        position: 'absolute',
        top: 0,
        left: `calc(50% - ${SIDEBAR_DOCUMENT_SHIFT}px + ${(pageWidth * zoom) / 2 + SIDEBAR_PAGE_GAP}px)`,
        width: SIDEBAR_WIDTH,
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        zIndex: 40,
        backgroundColor: 'transparent',
        overflowY: 'visible',
        overflowX: 'visible',
        opacity: hasPositions ? 1 : 0,
        transition: 'opacity 0.15s ease',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ position: 'relative' }}>
        {items.map((item) => {
          const yPos = positionMap.get(item.id);
          const isExpanded = expandedItem === item.id;
          const isKnown = knownCardsRef.current.has(item.id);
          const isNewCard = !isKnown && yPos !== undefined;
          const noPosition = hasPositions && !positionMap.has(item.id);

          const style: React.CSSProperties = hasPositions
            ? yPos !== undefined
              ? { position: 'absolute', top: yPos, left: 0, right: 0, opacity: 1 }
              : {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  opacity: 0,
                  visibility: 'hidden',
                }
            : { marginBottom: 6 };

          const transition = noPosition
            ? 'none'
            : isNewCard || item.isTemporary
              ? 'opacity 0.2s ease'
              : initialPositionsDone
                ? 'opacity 0.2s ease, top 0.15s ease'
                : 'none';

          return (
            <div key={item.id} style={{ ...style, transition }}>
              {item.render({
                isExpanded,
                onToggleExpand: () => toggleExpand(item.id),
                measureRef: getMeasureRef(item.id),
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
