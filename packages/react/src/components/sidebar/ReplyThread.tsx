import type { Comment } from '@eigenpal/docx-core/types/content';
import { getCommentText, formatDate, getInitials, avatarStyle } from './cardUtils';

export interface ReplyThreadProps {
  replies: Comment[];
  isExpanded: boolean;
}

export function ReplyThread({ replies, isExpanded }: ReplyThreadProps) {
  if (replies.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {(isExpanded ? replies : replies.slice(-1)).map((reply) => (
        <div
          key={reply.id}
          style={{
            marginBottom: isExpanded ? 8 : 0,
            paddingTop: 8,
            borderTop: '1px solid #e8eaed',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={avatarStyle(reply.author || 'U', 28)}>
              {getInitials(reply.author || 'U')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#202124' }}>
                {reply.author || 'Unknown'}
              </div>
              <div style={{ fontSize: 11, color: '#5f6368' }}>{formatDate(reply.date)}</div>
            </div>
          </div>
          <div
            style={{
              fontSize: 13,
              color: '#202124',
              lineHeight: '20px',
              marginTop: 4,
              ...(!isExpanded
                ? {
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                  }
                : {}),
            }}
          >
            {getCommentText(reply.content)}
          </div>
        </div>
      ))}
      {!isExpanded && replies.length > 1 && (
        <div style={{ fontSize: 12, color: '#5f6368', marginTop: 4 }}>
          {replies.length - 1} more {replies.length - 1 === 1 ? 'reply' : 'replies'}
        </div>
      )}
    </div>
  );
}
