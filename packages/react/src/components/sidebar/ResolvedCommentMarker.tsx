import type { Comment } from '@eigenpal/docx-core/types/content';
import { MaterialSymbol } from '../ui/Icons';
import type { SidebarItemRenderProps } from '../../plugin-api/types';

export interface ResolvedCommentMarkerProps extends SidebarItemRenderProps {
  comment: Comment;
}

export function ResolvedCommentMarker({ measureRef, onToggleExpand }: ResolvedCommentMarkerProps) {
  return (
    <div
      ref={measureRef}
      onClick={onToggleExpand}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'pointer',
        color: '#9aa0a6',
        padding: 2,
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLElement).style.color = '#5f6368';
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLElement).style.color = '#9aa0a6';
      }}
    >
      <MaterialSymbol name="chat_bubble_check" size={20} />
    </div>
  );
}
