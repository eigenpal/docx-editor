import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { MaterialSymbol } from '../ui/Icons';
import type { SidebarItemRenderProps } from '../../plugin-api/types';

export interface ResolvedCommentMarkerProps extends SidebarItemRenderProps {
  comment: Comment;
}

export function ResolvedCommentMarker({
  comment,
  measureRef,
  onToggleExpand,
}: ResolvedCommentMarkerProps) {
  return (
    <div
      ref={measureRef}
      data-comment-id={comment.id}
      data-comment-resolved="true"
      onClick={onToggleExpand}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'pointer',
        color: 'var(--doc-text-muted)',
        padding: 2,
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = '0.7';
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = '1';
      }}
    >
      <MaterialSymbol name="chat_bubble_check" size={20} />
    </div>
  );
}
