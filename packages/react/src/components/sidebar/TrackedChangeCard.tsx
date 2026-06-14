import type { Comment } from '@eigenpal/docx-editor-core/types/content';
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
  /**
   * @deprecated Prefer `onAcceptById`. Range-based accept only clears
   * marks within `(from, to)` and silently leaves paragraph-mark and
   * coalesced sibling sites behind. Kept as fallback for hosts that
   * haven't migrated to the by-id channel.
   */
  onAccept?: (from: number, to: number) => void;
  /**
   * @deprecated Prefer `onRejectById`. Same caveat as `onAccept`.
   */
  onReject?: (from: number, to: number) => void;
  /**
   * Accept every site of the revision. Walks the doc for all sites
   * sharing the `revisionId` (inline marks + paragraph attrs + table
   * row/cell attrs) and clears them in one transaction. This is the
   * right channel for any coalesced revision.
   */
  onAcceptById?: (revisionId: number) => void;
  /** Reject every site of the revision. Counterpart to `onAcceptById`. */
  onRejectById?: (revisionId: number) => void;
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
  onAcceptById,
  onRejectById,
  onReply,
}: TrackedChangeCardProps) {
  const { t } = useTranslation();
  const authorName = change.author || t('trackedChanges.unknown');

  // Dispatch by `revisionId` whenever the host wired the by-id handlers.
  // A single coalesced edit can scatter sites across paragraphs (inline
  // marks + pPrIns attrs sharing one id); a range-based accept only clears
  // marks within the entry's (from, to), leaving sibling pPrIns attrs
  // behind so the user would need a second Accept. By-id walks every site
  // sharing the id in one pass — correct for all entry types.
  // Collect every `w:id` the card represents: the primary revisionId, the
  // replacement's distinct insertion id, plus any ids the extractor merged
  // in via (author, date) coalescing (a foreign editor minting fresh ids
  // per atomic edit). Walking the full set keeps Accept/Reject atomic.
  const allRevisionIds = (): number[] => {
    const ids = new Set<number>([change.revisionId]);
    if (change.type === 'replacement' && change.insertionRevisionId != null) {
      ids.add(change.insertionRevisionId);
    }
    for (const id of change.coalescedRevisionIds ?? []) ids.add(id);
    return [...ids];
  };
  const handleAccept = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAcceptById) {
      for (const id of allRevisionIds()) onAcceptById(id);
    } else {
      onAccept?.(change.from, change.to);
    }
  };
  const handleReject = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRejectById) {
      for (const id of allRevisionIds()) onRejectById(id);
    } else {
      onReject?.(change.from, change.to);
    }
  };

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
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--doc-text)' }}>
            {authorName}
          </div>
          {change.date && (
            <div style={{ fontSize: 11, color: 'var(--doc-text-muted)' }}>
              {formatDate(change.date)}
            </div>
          )}
        </div>
        {isExpanded && (
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            <button onClick={handleAccept} title={t('common.accept')} style={ICON_BUTTON_STYLE}>
              <MaterialSymbol name="check" size={20} />
            </button>
            <button onClick={handleReject} title={t('common.reject')} style={ICON_BUTTON_STYLE}>
              <MaterialSymbol name="close" size={20} />
            </button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 13, lineHeight: '20px', color: 'var(--doc-text)', marginTop: 6 }}>
        {change.type === 'replacement' ? (
          <>
            {t('trackedChanges.replaced')}{' '}
            <span style={{ color: 'var(--doc-error)', fontWeight: 500 }}>
              &quot;{truncateText(change.deletedText || '')}&quot;
            </span>{' '}
            {t('trackedChanges.with')}{' '}
            <span style={{ color: 'var(--doc-success)', fontWeight: 500 }}>
              &quot;{truncateText(change.text)}&quot;
            </span>
          </>
        ) : change.type === 'paragraphMarkInsertion' ? (
          <>
            {t('revisions.paragraphMarkInserted')}
            {change.text ? (
              <>
                {': '}
                <span style={{ color: 'var(--doc-success)', fontWeight: 500 }}>
                  &quot;{truncateText(change.text)}&quot;
                </span>
              </>
            ) : null}
          </>
        ) : change.type === 'paragraphMarkDeletion' ? (
          <>
            {t('revisions.paragraphMarkDeleted')}
            {change.text ? (
              <>
                {': '}
                <span style={{ color: 'var(--doc-error)', fontWeight: 500 }}>
                  &quot;{truncateText(change.text)}&quot;
                </span>
              </>
            ) : null}
          </>
        ) : change.type === 'paragraphPropertiesChanged' ? (
          <>
            {t('revisions.paragraphPropertiesChanged')}
            {change.text ? (
              <>
                {': '}
                <span style={{ color: 'var(--doc-text-muted)', fontWeight: 500 }}>
                  &quot;{truncateText(change.text)}&quot;
                </span>
              </>
            ) : null}
          </>
        ) : change.type === 'rowInserted' ? (
          <span style={{ color: 'var(--doc-success)', fontWeight: 500 }}>
            {t('revisions.rowInserted')}
          </span>
        ) : change.type === 'rowDeleted' ? (
          <span style={{ color: 'var(--doc-error)', fontWeight: 500 }}>
            {t('revisions.rowDeleted')}
          </span>
        ) : change.type === 'cellInserted' ? (
          <span style={{ color: 'var(--doc-success)', fontWeight: 500 }}>
            {t('revisions.cellInserted')}
          </span>
        ) : change.type === 'cellDeleted' ? (
          <span style={{ color: 'var(--doc-error)', fontWeight: 500 }}>
            {t('revisions.cellDeleted')}
          </span>
        ) : change.type === 'cellMerged' ? (
          <span style={{ color: 'var(--doc-text-muted)', fontWeight: 500 }}>
            {t('revisions.cellMerged')}
          </span>
        ) : change.type === 'rowPropertiesChanged' ? (
          <span style={{ color: 'var(--doc-text-muted)' }}>
            {t('revisions.rowPropertiesChanged')}
          </span>
        ) : change.type === 'cellPropertiesChanged' ? (
          <span style={{ color: 'var(--doc-text-muted)' }}>
            {t('revisions.cellPropertiesChanged')}
          </span>
        ) : change.type === 'tablePropertiesChanged' ? (
          <span style={{ color: 'var(--doc-text-muted)' }}>
            {t('revisions.tablePropertiesChanged')}
          </span>
        ) : change.type === 'tableInserted' ? (
          <span style={{ color: 'var(--doc-success)', fontWeight: 500 }}>
            {t('revisions.tableInserted')}
          </span>
        ) : change.type === 'tableDeleted' ? (
          <span style={{ color: 'var(--doc-error)', fontWeight: 500 }}>
            {t('revisions.tableDeleted')}
          </span>
        ) : (
          <>
            {change.type === 'insertion' ? t('trackedChanges.added') : t('trackedChanges.deleted')}{' '}
            <span
              style={{
                color: change.type === 'insertion' ? 'var(--doc-success)' : 'var(--doc-error)',
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
