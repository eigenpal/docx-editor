import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { getCommentText, formatDate, getInitials, avatarStyle } from './cardUtils';
import { useTranslation } from '../../i18n';

export interface ReplyThreadProps {
  replies: Comment[];
  isExpanded: boolean;
}

export function ReplyThread({ replies, isExpanded }: ReplyThreadProps) {
  const { t } = useTranslation();
  if (replies.length === 0) return null;
  const visibleReplies = isExpanded ? replies : replies.slice(-1);
  const hiddenCount = isExpanded ? 0 : replies.length - 1;

  return (
    <div style={{ marginTop: 8 }}>
      {hiddenCount > 0 && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--doc-primary)',
            paddingTop: 6,
            paddingBottom: 6,
            borderTop: '1px solid var(--doc-border-light)',
          }}
        >
          {t('comments.replyCount', { count: hiddenCount })}
        </div>
      )}
      {visibleReplies.map((reply) => (
        <div
          key={reply.id}
          style={{
            marginBottom: isExpanded ? 8 : 0,
            paddingTop: 8,
            borderTop: '1px solid var(--doc-border-light)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={avatarStyle(reply.author || 'U', 28)}>
              {getInitials(reply.author || 'U')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--doc-text)' }}>
                {reply.author || t('comments.unknown')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--doc-text-muted)' }}>
                {formatDate(reply.date)}
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--doc-text)',
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
    </div>
  );
}
