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
        padding: 2,
        position: 'relative',
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = '0.7';
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = '1';
      }}
    >
      <span style={{ color: '#5f6368' }}>
        <MaterialSymbol name="chat_bubble_outline" size={20} />
      </span>
      <span style={{ position: 'absolute', left: 5, top: 4, color: '#188038' }}>
        <MaterialSymbol name="check" size={12} />
      </span>
    </div>
  );
}
