/**
 * Compact resolved comment marker — small icon shown in the sidebar
 * at the comment's anchor position. Click to expand the full card.
 */

import type { Comment } from '@eigenpal/docx-core/types/content';
import { MaterialSymbol } from '../ui/Icons';
import type { SidebarItemRenderProps } from '../../plugin-api/types';

export interface ResolvedCommentMarkerProps extends SidebarItemRenderProps {
  comment: Comment;
  onClick?: () => void;
}

export function ResolvedCommentMarker({
  comment,
  measureRef,
  onClick,
}: ResolvedCommentMarkerProps) {
  return (
    <div
      ref={measureRef}
      data-comment-id={comment.id}
      className="docx-comment-card"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 12,
        background: '#f1f3f4',
        border: '1px solid #dadce0',
        cursor: 'pointer',
        fontSize: 11,
        color: '#5f6368',
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        transition: 'background 0.15s',
        whiteSpace: 'nowrap',
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLElement).style.background = '#e8eaed';
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLElement).style.background = '#f1f3f4';
      }}
    >
      <MaterialSymbol name="check" size={12} style={{ color: '#188038' }} />
      <span>Resolved</span>
    </div>
  );
}
