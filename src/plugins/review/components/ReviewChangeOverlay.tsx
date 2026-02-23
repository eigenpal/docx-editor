import { useEffect, useState } from 'react';
import type { RenderedDomContext } from '../../../plugin-api/types';
import type { ReviewRevisionItem, ReviewRevisionType } from '../types';

interface ReviewChangeOverlayProps {
  context: RenderedDomContext;
  revisions: readonly ReviewRevisionItem[];
  activeRevisionId: string | null;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OverlaySegment {
  key: string;
  revisionId: string;
  type: ReviewRevisionType;
  x: number;
  y: number;
  width: number;
  height: number;
  laneX: number;
  active: boolean;
  unsupported: boolean;
}

function mergeRectsByLine(rects: readonly Rect[]): Rect[] {
  if (rects.length <= 1) return [...rects];

  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: Rect[] = [];

  for (const rect of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      Math.abs(previous.y - rect.y) <= 1.5 &&
      Math.abs(previous.height - rect.height) <= 2
    ) {
      const left = Math.min(previous.x, rect.x);
      const right = Math.max(previous.x + previous.width, rect.x + rect.width);
      previous.x = left;
      previous.width = right - left;
      previous.height = Math.max(previous.height, rect.height);
      continue;
    }
    merged.push({ ...rect });
  }

  return merged;
}

function getRevisionRects(context: RenderedDomContext, revision: ReviewRevisionItem): Rect[] {
  const from = Math.max(0, revision.from);
  const to = Math.max(from + 1, revision.to);
  const rawRects = context.getRectsForRange(from, to);

  if (rawRects.length > 0) {
    return mergeRectsByLine(rawRects.map((rect) => ({ ...rect })));
  }

  const fallback = context.getCoordinatesForPosition(from);
  if (!fallback) return [];

  return [
    {
      x: fallback.x,
      y: fallback.y,
      width: Math.max(8, fallback.height * 0.6),
      height: fallback.height,
    },
  ];
}

function computeSegments(
  context: RenderedDomContext,
  revisions: readonly ReviewRevisionItem[],
  activeRevisionId: string | null
): OverlaySegment[] {
  const offset = context.getContainerOffset();
  const segments: OverlaySegment[] = [];

  for (const revision of revisions) {
    const lineRects = getRevisionRects(context, revision);
    if (lineRects.length === 0) continue;

    for (let index = 0; index < lineRects.length; index += 1) {
      const rect = lineRects[index];
      const x = rect.x + offset.x;
      const y = rect.y + offset.y;
      const height = Math.max(2, rect.height);
      const laneX = Math.max(offset.x + 6, x - 14);

      segments.push({
        key: `${revision.id}:${index}`,
        revisionId: revision.id,
        type: revision.type,
        x,
        y,
        width: Math.max(1, rect.width),
        height,
        laneX,
        active: revision.id === activeRevisionId,
        unsupported: revision.status === 'unsupported',
      });
    }
  }

  return segments;
}

export function ReviewChangeOverlay({
  context,
  revisions,
  activeRevisionId,
}: ReviewChangeOverlayProps) {
  const [, setLayoutVersion] = useState(0);

  useEffect(() => {
    const onResize = () => {
      requestAnimationFrame(() => setLayoutVersion((current) => current + 1));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => setLayoutVersion((current) => current + 1));
    });
    observer.observe(context.pagesContainer);
    return () => observer.disconnect();
  }, [context.pagesContainer]);

  const segments = computeSegments(context, revisions, activeRevisionId);

  if (segments.length === 0) return null;

  return (
    <div className="review-change-overlay">
      {segments.map((segment) => {
        const connectorWidth = Math.max(3, segment.x - segment.laneX);

        return (
          <div key={segment.key}>
            <div
              className={`review-change-overlay__range review-change-overlay__range--${segment.type} ${
                segment.active ? 'active' : ''
              } ${segment.unsupported ? 'unsupported' : ''}`}
              data-review-revision-id={segment.revisionId}
              data-review-change-type={segment.type}
              style={{
                left: segment.x,
                top: segment.y,
                width: segment.width,
                height: segment.height,
              }}
            />
            <div
              className={`review-change-overlay__line review-change-overlay__line--${segment.type} ${
                segment.active ? 'active' : ''
              } ${segment.unsupported ? 'unsupported' : ''}`}
              style={{
                left: segment.laneX,
                top: segment.y,
                height: segment.height,
              }}
            />
            <div
              className={`review-change-overlay__connector review-change-overlay__connector--${segment.type} ${
                segment.active ? 'active' : ''
              } ${segment.unsupported ? 'unsupported' : ''}`}
              style={{
                left: segment.laneX + 3,
                top: segment.y + segment.height / 2,
                width: connectorWidth,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export const REVIEW_CHANGE_OVERLAY_STYLES = `
.review-change-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

.review-change-overlay__range {
  position: absolute;
  border-radius: 2px;
  opacity: 0.18;
}

.review-change-overlay__range.active {
  opacity: 0.32;
}

.review-change-overlay__range--insertion,
.review-change-overlay__range--moveTo {
  background: rgba(46, 125, 50, 0.25);
}

.review-change-overlay__range--formatChange {
  background: rgba(29, 78, 216, 0.22);
}

.review-change-overlay__range--deletion,
.review-change-overlay__range--moveFrom {
  background: rgba(198, 40, 40, 0.22);
}

.review-change-overlay__line {
  position: absolute;
  width: 3px;
  border-radius: 999px;
  opacity: 0.55;
}

.review-change-overlay__line.active {
  width: 4px;
  opacity: 0.95;
}

.review-change-overlay__line--insertion,
.review-change-overlay__line--moveTo {
  background: #2e7d32;
}

.review-change-overlay__line--formatChange {
  background: #1d4ed8;
}

.review-change-overlay__line--deletion,
.review-change-overlay__line--moveFrom {
  background: #c62828;
}

.review-change-overlay__connector {
  position: absolute;
  height: 1px;
  opacity: 0.4;
  transform: translateY(-0.5px);
}

.review-change-overlay__connector.active {
  height: 2px;
  opacity: 0.8;
}

.review-change-overlay__connector--insertion,
.review-change-overlay__connector--moveTo {
  background: #2e7d32;
}

.review-change-overlay__connector--formatChange {
  background: #1d4ed8;
}

.review-change-overlay__connector--deletion,
.review-change-overlay__connector--moveFrom {
  background: #c62828;
}

.review-change-overlay__range.unsupported,
.review-change-overlay__line.unsupported,
.review-change-overlay__connector.unsupported {
  filter: grayscale(1);
  opacity: 0.25;
}
`;
