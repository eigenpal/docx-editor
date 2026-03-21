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

export { SIDEBAR_WIDTH, SIDEBAR_PAGE_GAP, SIDEBAR_DOCUMENT_SHIFT } from './sidebar/constants';

export interface UnifiedSidebarProps {
  items: ReactSidebarItem[];
  anchorPositions: Map<string, number>;
  renderedDomContext: RenderedDomContext | null;
  pageWidth: number;
  zoom: number;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function UnifiedSidebar({
  items,
  anchorPositions,
  renderedDomContext,
  pageWidth,
  zoom,
  editorContainerRef,
}: UnifiedSidebarProps) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [initialPositionsDone, setInitialPositionsDone] = useState(false);
  const cardHeightsRef = useRef<Map<string, number>>(new Map());
  const lastKnownRef = useRef<Map<string, number>>(new Map());
  const knownCardsRef = useRef<Set<string>>(new Set());
  const sidebarRef = useRef<HTMLDivElement>(null);
  const cardElsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Force re-render trigger for position updates
  const [positionVersion, setPositionVersion] = useState(0);

  // Resolve all item positions with collision avoidance
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

  // Build a Set of resolved item IDs for quick lookup
  const resolvedIds = useMemo(() => new Set(resolved.map((r) => r.item.id)), [resolved]);

  // Update positions on mount and when dependencies change
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

  // ResizeObserver on container
  useEffect(() => {
    const container = editorContainerRef?.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => setPositionVersion((v) => v + 1));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [editorContainerRef]);

  // Recalculate when expanded card changes
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPositionVersion((v) => v + 1));
    return () => cancelAnimationFrame(raf);
  }, [expandedItem]);

  // Watch expanded card for size changes
  useEffect(() => {
    const targets: HTMLElement[] = [];
    if (expandedItem) {
      const el = cardElsRef.current.get(expandedItem);
      if (el) targets.push(el);
    }
    if (targets.length === 0) return;

    let rafId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setPositionVersion((v) => v + 1));
    });
    for (const el of targets) observer.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [expandedItem]);

  // Listen for clicks on comment/change highlights in the document
  useEffect(() => {
    const container = editorContainerRef?.current;
    if (!container) return;

    const pagesEl = container.querySelector('.paged-editor__pages');
    if (!pagesEl) return;

    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (sidebarRef.current?.contains(target)) return;

      if (pagesEl.contains(target)) {
        const commentEl = target.closest('[data-comment-id]') as HTMLElement | null;
        if (commentEl?.dataset.commentId) {
          setExpandedItem(`comment-${commentEl.dataset.commentId}`);
          return;
        }
        const changeEl =
          (target.closest('.docx-insertion') as HTMLElement | null) ||
          (target.closest('.docx-deletion') as HTMLElement | null);
        if (changeEl?.dataset.revisionId) {
          // Find matching item
          const prefix = `tc-${changeEl.dataset.revisionId}`;
          const match = items.find((i) => i.id.startsWith(prefix));
          if (match) {
            setExpandedItem(match.id);
            return;
          }
        }
      }

      setExpandedItem(null);
    };

    container.addEventListener('click', handleDocClick);
    return () => container.removeEventListener('click', handleDocClick);
  }, [editorContainerRef, items]);

  const createMeasureRef = useCallback(
    (itemId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        cardElsRef.current.set(itemId, el);
        cardHeightsRef.current.set(itemId, el.offsetHeight);
      } else {
        cardElsRef.current.delete(itemId);
        cardHeightsRef.current.delete(itemId);
      }
    },
    []
  );

  const toggleExpand = useCallback((itemId: string) => {
    setExpandedItem((prev) => (prev === itemId ? null : itemId));
  }, []);

  // Build a map from item ID to resolved Y for quick lookup
  const positionMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of resolved) {
      map.set(r.item.id, r.y);
    }
    return map;
  }, [resolved]);

  if (items.length === 0) return null;

  return (
    <aside
      ref={sidebarRef}
      className="docx-unified-sidebar"
      role="complementary"
      aria-label="Annotations sidebar"
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

          if (yPos !== undefined) {
            knownCardsRef.current.add(item.id);
          }

          const isNewCard = !isKnown && yPos !== undefined;
          const noPosition = hasPositions && !resolvedIds.has(item.id);

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
                measureRef: createMeasureRef(item.id),
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
