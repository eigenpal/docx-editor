/**
 * CommentMarginMarkers — small icons in the page right margin
 *
 * - Active comments: speech bubble icon when sidebar is closed
 * - Resolved comments: speech bubble + check icon always visible
 * - Click resolved marker → floating popup card appears next to it
 */

import type { Comment } from '@eigenpal/docx-core/types/content';
import { MaterialSymbol } from './ui/Icons';
import { SIDEBAR_DOCUMENT_SHIFT, SIDEBAR_WIDTH } from './sidebar/constants';
import { getCommentText, formatDate, getInitials, avatarStyle } from './sidebar/cardUtils';
import { CARD_STYLE_EXPANDED } from './sidebar/cardStyles';

export interface CommentMarginMarkersProps {
  comments: Comment[];
  anchorPositions: Map<string, number>;
  zoom: number;
  pageWidth: number;
  sidebarOpen: boolean;
  resolvedCommentIds: Set<number>;
  expandedResolvedId: number | null;
  onMarkerClick: (commentId: number) => void;
  onUnresolve?: (commentId: number) => void;
  onDelete?: (commentId: number) => void;
}

export function CommentMarginMarkers({
  comments,
  anchorPositions,
  zoom,
  pageWidth,
  sidebarOpen,
  resolvedCommentIds,
  expandedResolvedId,
  onMarkerClick,
  onUnresolve,
  onDelete,
}: CommentMarginMarkersProps) {
  const rootComments = comments.filter((c) => c.parentId == null);
  const expandedComment =
    expandedResolvedId != null ? comments.find((c) => c.id === expandedResolvedId) : null;
  const expandedY =
    expandedResolvedId != null ? anchorPositions.get(`comment-${expandedResolvedId}`) : null;

  const markers = rootComments
    .map((comment) => {
      const isResolved = resolvedCommentIds.has(comment.id);
      if (!isResolved && sidebarOpen) return null;
      const y = anchorPositions.get(`comment-${comment.id}`);
      if (y == null) return null;
      return { comment, isResolved, y };
    })
    .filter(Boolean) as { comment: Comment; isResolved: boolean; y: number }[];

  if (markers.length === 0 && !expandedComment) return null;

  const containerLeft = `calc(50% - ${sidebarOpen ? SIDEBAR_DOCUMENT_SHIFT : 0}px + ${(pageWidth * zoom) / 2 + 4}px)`;

  return (
    <div
      className="docx-comment-margin-markers"
      style={{
        position: 'absolute',
        top: 0,
        left: containerLeft,
        zIndex: 40,
        pointerEvents: 'none',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Marker icons */}
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
            display: expandedResolvedId === comment.id ? 'none' : 'flex',
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

      {/* Floating popup for expanded resolved comment */}
      {expandedComment && expandedY != null && (
        <div
          className="docx-comment-card"
          style={{
            ...CARD_STYLE_EXPANDED,
            position: 'absolute',
            top: expandedY * zoom,
            left: 0,
            width: SIDEBAR_WIDTH,
            pointerEvents: 'auto',
            zIndex: 50,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              marginBottom: 8,
              fontSize: 11,
              fontWeight: 500,
              color: '#188038',
              backgroundColor: '#e6f4ea',
              borderRadius: 10,
            }}
          >
            <MaterialSymbol name="check" size={12} />
            Resolved
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={avatarStyle(expandedComment.author || 'U')}>
              {getInitials(expandedComment.author || 'U')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#202124' }}>
                {expandedComment.author || 'Unknown'}
              </div>
              <div style={{ fontSize: 11, color: '#5f6368' }}>
                {formatDate(expandedComment.date)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUnresolve?.(expandedComment.id);
                }}
                title="Reopen"
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  color: '#5f6368',
                  borderRadius: 4,
                }}
              >
                <MaterialSymbol name="undo" size={18} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(expandedComment.id);
                }}
                title="Delete"
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  color: '#5f6368',
                  borderRadius: 4,
                }}
              >
                <MaterialSymbol name="delete" size={18} />
              </button>
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#202124', lineHeight: '20px', marginTop: 6 }}>
            {getCommentText(expandedComment.content)}
          </div>
        </div>
      )}
    </div>
  );
}
