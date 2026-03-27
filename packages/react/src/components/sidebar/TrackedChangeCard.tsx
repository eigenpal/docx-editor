import type { Comment } from '@eigenpal/docx-core/types/content';
import { MaterialSymbol } from '../ui/Icons';
import type { SidebarItemRenderProps } from '../../plugin-api/types';
import type { TrackedChangeEntry } from './cardUtils';
import { formatDate, getInitials, avatarStyle, ICON_BUTTON_STYLE, truncateText } from './cardUtils';
import { ReplyThread } from './ReplyThread';
import { ReplyInput } from './ReplyInput';
import { CARD_STYLE_COLLAPSED, CARD_STYLE_EXPANDED } from './cardStyles';
import { useTranslation } from '../../i18n';

export interface TrackedChangeCardProps extends SidebarItemRenderProps {
  change: TrackedChangeEntry;
  replies: Comment[];
  onAccept?: (from: number, to: number) => void;
  onReject?: (from: number, to: number) => void;
  onReply?: (revisionId: number, text: string) => void;
}

export function TrackedChangeCard({
  change,
  replies,
  isExpanded,
  onToggleExpand,
  measureRef,
  onAccept,
  onReject,
  onReply,
}: TrackedChangeCardProps) {
  const { t } = useTranslation();
  const authorName = change.author || t('trackedChanges.unknown');

  return (
    <div
      ref={measureRef}
      className="docx-tracked-change-card"
      onClick={() => onToggleExpand()}
      onMouseDown={(e) => e.stopPropagation()}
      style={isExpanded ? CARD_STYLE_EXPANDED : CARD_STYLE_COLLAPSED}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={avatarStyle(authorName)}>{getInitials(authorName)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#202124' }}>{authorName}</div>
          {change.date && (
            <div style={{ fontSize: 11, color: '#5f6368' }}>{formatDate(change.date)}</div>
          )}
        </div>
        {isExpanded && (
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAccept?.(change.from, change.to);
              }}
              title={t('common.accept')}
              style={ICON_BUTTON_STYLE}
            >
              <MaterialSymbol name="check" size={20} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReject?.(change.from, change.to);
              }}
              title={t('common.reject')}
              style={ICON_BUTTON_STYLE}
            >
              <MaterialSymbol name="close" size={20} />
            </button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 13, lineHeight: '20px', color: '#202124', marginTop: 6 }}>
        {change.type === 'replacement' ? (
          <>
            {t('trackedChanges.replaced')}{' '}
            <span style={{ color: '#c5221f', fontWeight: 500 }}>
              &quot;{truncateText(change.deletedText || '')}&quot;
            </span>{' '}
            {t('trackedChanges.with')}{' '}
            <span style={{ color: '#137333', fontWeight: 500 }}>
              &quot;{truncateText(change.text)}&quot;
            </span>
          </>
        ) : (
          <>
            {change.type === 'insertion' ? t('trackedChanges.added') : t('trackedChanges.deleted')}{' '}
            <span
              style={{
                color: change.type === 'insertion' ? '#137333' : '#c5221f',
                fontWeight: 500,
              }}
            >
              &quot;{truncateText(change.text)}&quot;
            </span>
          </>
        )}
      </div>

      <ReplyThread replies={replies} isExpanded={isExpanded} />

      {isExpanded && <ReplyInput onSubmit={(text) => onReply?.(change.revisionId, text)} />}
    </div>
  );
}
