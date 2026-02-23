import { useCallback, useMemo, useState } from 'react';
import type { PluginPanelProps } from '../../../plugin-api/types';
import {
  applyBodyModelRevisionDecisionToDocument,
  applyBulkBodyModelRevisionDecisionToDocument,
  applyBulkHeaderFooterRevisionDecisionToDocument,
  applyBulkRevisionDecision,
  applyHeaderFooterRevisionDecisionToDocument,
  applyRevisionDecision,
  canApplyBodyModelRevisionDecision,
  canApplyBulkBodyModelRevisionDecision,
  canApplyBulkHeaderFooterRevisionDecision,
  canApplyHeaderFooterRevisionDecision,
  createBulkRevisionDecisionTransaction,
  createRevisionDecisionTransaction,
} from '../actions';
import type {
  ReviewDecision,
  ReviewPluginState,
  ReviewRevisionItem,
  ReviewRevisionType,
} from '../types';

type RevisionFilter =
  | 'all'
  | 'supported'
  | 'unsupported'
  | 'insertion'
  | 'deletion'
  | 'moveFrom'
  | 'moveTo'
  | 'formatChange';

const EMPTY_REVISIONS: ReadonlyArray<ReviewRevisionItem> = [];
const MAX_RENDERED_REVISIONS = 500;

const FILTERS: ReadonlyArray<{ key: RevisionFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'supported', label: 'Supported' },
  { key: 'unsupported', label: 'Unsupported' },
  { key: 'insertion', label: 'Insertions' },
  { key: 'deletion', label: 'Deletions' },
  { key: 'moveFrom', label: 'Move From' },
  { key: 'moveTo', label: 'Move To' },
  { key: 'formatChange', label: 'Formatting' },
];

function revisionTypeLabel(type: ReviewRevisionType): string {
  switch (type) {
    case 'insertion':
      return 'Insertion';
    case 'deletion':
      return 'Deletion';
    case 'moveFrom':
      return 'Move From';
    case 'moveTo':
      return 'Move To';
    case 'formatChange':
      return 'Formatting';
  }
}

function formatRevisionDate(date: string | null): string {
  if (!date) return 'Unknown date';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleString();
}

function filterRevisions(
  revisions: readonly ReviewRevisionItem[],
  filter: RevisionFilter
): ReviewRevisionItem[] {
  switch (filter) {
    case 'all':
      return [...revisions];
    case 'supported':
      return revisions.filter((revision) => revision.status === 'supported');
    case 'unsupported':
      return revisions.filter((revision) => revision.status === 'unsupported');
    case 'insertion':
    case 'deletion':
    case 'moveFrom':
    case 'moveTo':
    case 'formatChange':
      return revisions.filter((revision) => revision.type === filter);
  }
}

export interface RevisionPanelProps extends PluginPanelProps<ReviewPluginState> {}

export function RevisionPanel({
  pluginState,
  editorView,
  selectRange,
  scrollToPosition,
}: RevisionPanelProps) {
  const [filter, setFilter] = useState<RevisionFilter>('all');
  const revisions = pluginState?.revisions ?? EMPTY_REVISIONS;
  const activeRevisionId = pluginState?.activeRevisionId ?? null;
  const activeRevision = useMemo(
    () => revisions.find((revision) => revision.id === activeRevisionId) ?? null,
    [revisions, activeRevisionId]
  );

  const filteredRevisions = useMemo(() => filterRevisions(revisions, filter), [revisions, filter]);
  const renderedRevisions = useMemo(
    () => filteredRevisions.slice(0, MAX_RENDERED_REVISIONS),
    [filteredRevisions]
  );
  const hasHiddenRevisions = filteredRevisions.length > renderedRevisions.length;

  const selectRevision = useCallback(
    (revision: ReviewRevisionItem) => {
      if (revision.location !== 'body') {
        return;
      }
      selectRange(revision.from, revision.to);
      scrollToPosition(revision.from);
    },
    [selectRange, scrollToPosition]
  );

  const runDecision = useCallback(
    (decision: ReviewDecision) => {
      if (!activeRevision) return;
      if (activeRevision.location === 'body') {
        if (
          editorView &&
          createRevisionDecisionTransaction(
            editorView.state,
            revisions,
            activeRevision.id,
            decision
          )
        ) {
          applyRevisionDecision(editorView, revisions, activeRevision.id, decision);
          return;
        }

        if (!pluginState?.mutateDocumentModel) return;
        if (!canApplyBodyModelRevisionDecision(revisions, activeRevision.id)) {
          return;
        }
        pluginState.mutateDocumentModel((document) =>
          applyBodyModelRevisionDecisionToDocument(document, revisions, activeRevision.id, decision)
        );
        return;
      }

      if (!pluginState?.mutateDocumentModel) return;
      if (!canApplyHeaderFooterRevisionDecision(revisions, activeRevision.id)) return;
      pluginState.mutateDocumentModel((document) =>
        applyHeaderFooterRevisionDecisionToDocument(
          document,
          revisions,
          activeRevision.id,
          decision
        )
      );
    },
    [editorView, activeRevision, pluginState, revisions]
  );

  const runBulkDecision = useCallback(
    (decision: ReviewDecision) => {
      if (
        editorView &&
        createBulkRevisionDecisionTransaction(editorView.state, revisions, decision)
      ) {
        applyBulkRevisionDecision(editorView, revisions, decision);
      }

      if (pluginState?.mutateDocumentModel && canApplyBulkBodyModelRevisionDecision(revisions)) {
        pluginState.mutateDocumentModel((document) =>
          applyBulkBodyModelRevisionDecisionToDocument(document, revisions, decision)
        );
      }

      if (pluginState?.mutateDocumentModel && canApplyBulkHeaderFooterRevisionDecision(revisions)) {
        pluginState.mutateDocumentModel((document) =>
          applyBulkHeaderFooterRevisionDecisionToDocument(document, revisions, decision)
        );
      }
    },
    [editorView, pluginState, revisions]
  );

  const canAcceptActive =
    !!activeRevision &&
    (activeRevision.location === 'body'
      ? (!!editorView &&
          !!createRevisionDecisionTransaction(
            editorView.state,
            revisions,
            activeRevision.id,
            'accept'
          )) ||
        (!!pluginState?.mutateDocumentModel &&
          canApplyBodyModelRevisionDecision(revisions, activeRevision.id))
      : !!pluginState?.mutateDocumentModel &&
        canApplyHeaderFooterRevisionDecision(revisions, activeRevision.id));
  const canRejectActive =
    !!activeRevision &&
    (activeRevision.location === 'body'
      ? (!!editorView &&
          !!createRevisionDecisionTransaction(
            editorView.state,
            revisions,
            activeRevision.id,
            'reject'
          )) ||
        (!!pluginState?.mutateDocumentModel &&
          canApplyBodyModelRevisionDecision(revisions, activeRevision.id))
      : !!pluginState?.mutateDocumentModel &&
        canApplyHeaderFooterRevisionDecision(revisions, activeRevision.id));
  const canAcceptAll =
    (!!editorView &&
      !!createBulkRevisionDecisionTransaction(editorView.state, revisions, 'accept')) ||
    (!!pluginState?.mutateDocumentModel && canApplyBulkBodyModelRevisionDecision(revisions)) ||
    (!!pluginState?.mutateDocumentModel && canApplyBulkHeaderFooterRevisionDecision(revisions));
  const canRejectAll =
    (!!editorView &&
      !!createBulkRevisionDecisionTransaction(editorView.state, revisions, 'reject')) ||
    (!!pluginState?.mutateDocumentModel && canApplyBulkBodyModelRevisionDecision(revisions)) ||
    (!!pluginState?.mutateDocumentModel && canApplyBulkHeaderFooterRevisionDecision(revisions));

  return (
    <div className="review-panel">
      <div className="review-panel__header">
        <h3 className="review-panel__title">Tracked Changes</h3>
        <div className="review-panel__counts">
          <span>{pluginState?.totalCount ?? 0} total</span>
          <span>{pluginState?.supportedCount ?? 0} actionable</span>
          <span>{pluginState?.unsupportedCount ?? 0} unsupported</span>
        </div>
      </div>

      <div className="review-panel__filters">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`review-panel__filter ${filter === entry.key ? 'active' : ''}`}
            onClick={() => setFilter(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="review-panel__list" role="list" aria-label="Tracked changes list">
        {filteredRevisions.length === 0 ? (
          <div className="review-panel__empty">No revisions match this filter.</div>
        ) : (
          renderedRevisions.map((revision) => (
            <button
              key={revision.id}
              type="button"
              role="listitem"
              className={`review-item ${revision.id === activeRevisionId ? 'active' : ''} ${
                revision.status === 'unsupported' ? 'unsupported' : ''
              }`}
              onClick={() => selectRevision(revision)}
            >
              <div className="review-item__top">
                <span className={`review-item__type review-item__type--${revision.type}`}>
                  {revisionTypeLabel(revision.type)}
                </span>
                {revision.status === 'unsupported' && (
                  <span className="review-item__badge">Unsupported</span>
                )}
              </div>
              <div className="review-item__meta">
                <span>{revision.author}</span>
                <span>{formatRevisionDate(revision.date)}</span>
              </div>
              <div className="review-item__preview">{revision.textPreview}</div>
              {revision.reason && <div className="review-item__reason">{revision.reason}</div>}
            </button>
          ))
        )}
        {hasHiddenRevisions && (
          <div className="review-panel__truncated">
            Showing first {MAX_RENDERED_REVISIONS} of {filteredRevisions.length} revisions. Narrow
            filters to load fewer items.
          </div>
        )}
      </div>

      <div className="review-panel__actions">
        <button
          type="button"
          className="review-action review-action--accept"
          onClick={() => runDecision('accept')}
          disabled={!canAcceptActive}
        >
          Accept Selected
        </button>
        <button
          type="button"
          className="review-action review-action--reject"
          onClick={() => runDecision('reject')}
          disabled={!canRejectActive}
        >
          Reject Selected
        </button>
        <button
          type="button"
          className="review-action review-action--accept"
          onClick={() => runBulkDecision('accept')}
          disabled={!canAcceptAll}
        >
          Accept All
        </button>
        <button
          type="button"
          className="review-action review-action--reject"
          onClick={() => runBulkDecision('reject')}
          disabled={!canRejectAll}
        >
          Reject All
        </button>
      </div>
    </div>
  );
}

export const REVIEW_PANEL_STYLES = `
.review-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 10px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid #dbe4ee;
  border-radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.review-panel__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.review-panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
}

.review-panel__counts {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #4b5563;
}

.review-panel__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.review-panel__filter {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  border-radius: 4px;
  padding: 3px 7px;
  font-size: 11px;
  cursor: pointer;
}

.review-panel__filter.active {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

.review-panel__list {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-panel__empty {
  font-size: 12px;
  color: #6b7280;
  padding: 10px 0;
}

.review-panel__truncated {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.3;
  color: #6b7280;
  border-top: 1px solid #e5e7eb;
  padding-top: 6px;
}

.review-item {
  text-align: left;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  padding: 7px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
}

.review-item.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.2);
}

.review-item.unsupported {
  background: #fef2f2;
  border-color: #fecaca;
}

.review-item__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.review-item__type {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.review-item__type--insertion,
.review-item__type--moveTo {
  color: #166534;
}

.review-item__type--formatChange {
  color: #1d4ed8;
}

.review-item__type--deletion,
.review-item__type--moveFrom {
  color: #991b1b;
}

.review-item__badge {
  font-size: 10px;
  color: #b91c1c;
  font-weight: 700;
}

.review-item__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #4b5563;
}

.review-item__preview {
  font-size: 12px;
  color: #111827;
  line-height: 1.3;
}

.review-item__reason {
  font-size: 11px;
  color: #991b1b;
}

.review-panel__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.review-action {
  border-radius: 5px;
  border: 1px solid transparent;
  padding: 7px 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.review-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.review-action--accept {
  border-color: #bbf7d0;
  color: #166534;
  background: #f0fdf4;
}

.review-action--reject {
  border-color: #fecaca;
  color: #991b1b;
  background: #fef2f2;
}
`;
