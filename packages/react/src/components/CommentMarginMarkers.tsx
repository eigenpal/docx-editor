/**
 * CommentMarginMarkers — small icons at the page right edge
 *
 * Active comments: speech bubble when sidebar closed
 * Resolved comments: speech bubble + check, always visible
 * Clicking opens sidebar / toggles resolved popup
 */

import type { Comment } from '@eigenpal/docx-core/types/content';
import { MaterialSymbol } from './ui/Icons';

export interface CommentMarginMarkersProps {
  comments: Comment[];
  anchorPositions: Map<string, number>;
  zoom: number;
  pageWidth: number;
  sidebarOpen: boolean;
  resolvedCommentIds: Set<number>;
  onMarkerClick: (commentId: number) => void;
}

export function CommentMarginMarkers({
  comments,
  anchorPositions,
  zoom,
  pageWidth,
  sidebarOpen,
  resolvedCommentIds,
  onMarkerClick,
}: CommentMarginMarkersProps) {
  const rootComments = comments.filter((c) => c.parentId == null);

  const markers = rootComments
    .map((comment) => {
      const isResolved = resolvedCommentIds.has(comment.id);
      // Active: hide when sidebar is open (card visible in sidebar)
      if (!isResolved && sidebarOpen) return null;
      // Resolved: hide when sidebar is open (expanded resolved card visible in sidebar)
      if (isResolved && sidebarOpen) return null;
      const y = anchorPositions.get(`comment-${comment.id}`);
      if (y == null) return null;
      return { comment, isResolved, y };
    })
    .filter(Boolean) as { comment: Comment; isResolved: boolean; y: number }[];

  if (markers.length === 0) return null;

  return (
    <div
      className="docx-comment-margin-markers"
      style={{
        position: 'absolute',
        top: 0,
        // Position just past the page right edge
        left: `calc(50% + ${(pageWidth * zoom) / 2 + 6}px)`,
        zIndex: 30,
        pointerEvents: 'none',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {markers.map(({ comment, isResolved, y }) => (
        <button
          key={comment.id}
          onClick={() => onMarkerClick(comment.id)}
          title={isResolved ? 'Resolved comment' : 'Comment'}
          style={{
            position: 'absolute',
            top: y * zoom,
            left: 0,
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            borderRadius: 4,
            background: 'transparent',
            cursor: 'pointer',
            pointerEvents: 'auto',
            color: isResolved ? '#9aa0a6' : '#5f6368',
            opacity: isResolved ? 0.7 : 0.9,
            padding: 0,
            fontFamily: 'inherit',
          }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLElement).style.color = isResolved ? '#5f6368' : '#1a73e8';
            (e.currentTarget as HTMLElement).style.opacity = '1';
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLElement).style.color = isResolved ? '#9aa0a6' : '#5f6368';
            (e.currentTarget as HTMLElement).style.opacity = isResolved ? '0.7' : '0.9';
          }}
        >
          <MaterialSymbol
            name={isResolved ? 'chat_bubble_check' : 'chat_bubble_outline'}
            size={18}
          />
        </button>
      ))}
    </div>
  );
}
