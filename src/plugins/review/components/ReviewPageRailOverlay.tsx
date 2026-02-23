import { useCallback, useEffect, useMemo, useState } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { RenderedDomContext } from '../../../plugin-api/types';
import {
  applyBodyModelRevisionDecisionToDocument,
  applyHeaderFooterRevisionDecisionToDocument,
  applyRevisionDecision,
  canApplyBodyModelRevisionDecision,
  canApplyHeaderFooterRevisionDecision,
} from '../actions';
import type {
  ReviewDecision,
  ReviewPluginState,
  ReviewRevisionItem,
  ReviewRevisionType,
} from '../types';

interface ReviewPageRailOverlayProps {
  context: RenderedDomContext;
  editorView: EditorView | null;
  pluginState: ReviewPluginState;
  railWidth: number;
}

interface PageRail {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  revisions: ReviewRevisionItem[];
  hiddenCount: number;
}

interface PmRange {
  from: number;
  to: number;
}

const RAIL_GAP = 10;
const VISIBLE_PAGE_BUFFER = 1;
const MAX_REVISIONS_PER_PAGE_RAIL = 300;

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

function revisionLocationLabel(revision: ReviewRevisionItem): string {
  if (revision.location === 'header') {
    const ref = revision.headerFooterRefType ? ` (${revision.headerFooterRefType})` : '';
    return `Header${ref}`;
  }
  if (revision.location === 'footer') {
    const ref = revision.headerFooterRefType ? ` (${revision.headerFooterRefType})` : '';
    return `Footer${ref}`;
  }
  return 'Body';
}

function formatRevisionDate(date: string | null): string {
  if (!date) return 'Unknown date';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleString();
}

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function parseIntSafe(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPagePmRange(pageEl: HTMLElement): PmRange | null {
  const runs = pageEl.querySelectorAll<HTMLElement>('[data-pm-start][data-pm-end]');
  if (runs.length === 0) return null;

  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;

  for (const run of runs) {
    const start = parseIntSafe(run.dataset.pmStart);
    const end = parseIntSafe(run.dataset.pmEnd);
    if (start === null || end === null) continue;
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || minStart >= maxEnd) {
    return null;
  }

  return { from: minStart, to: maxEnd };
}

function getVisiblePageWindow(
  visiblePageNumbers: ReadonlySet<number>
): (pageNumber: number) => boolean {
  if (visiblePageNumbers.size === 0) {
    return (pageNumber) => pageNumber <= 2;
  }

  return (pageNumber) => {
    for (const visiblePage of visiblePageNumbers) {
      if (Math.abs(visiblePage - pageNumber) <= VISIBLE_PAGE_BUFFER) {
        return true;
      }
    }
    return false;
  };
}

function createPageRails(
  context: RenderedDomContext,
  revisions: readonly ReviewRevisionItem[],
  visiblePageNumbers: ReadonlySet<number>,
  railWidth: number
): PageRail[] {
  const pages = context.pagesContainer.querySelectorAll<HTMLElement>('.layout-page');
  if (pages.length === 0) return [];

  const includePage = getVisiblePageWindow(visiblePageNumbers);
  const containerRect = context.pagesContainer.getBoundingClientRect();
  const offset = context.getContainerOffset();
  const zoom = context.zoom;
  const rails: PageRail[] = [];

  for (const pageEl of pages) {
    const pageNumber = parseIntSafe(pageEl.dataset.pageNumber) ?? rails.length + 1;
    if (!includePage(pageNumber)) continue;

    const pmRange = getPagePmRange(pageEl);
    const pageRevisions = revisions
      .filter((revision) => {
        if (revision.location === 'body') {
          if (!pmRange) return false;
          return revision.to > pmRange.from && revision.from < pmRange.to;
        }
        return revision.anchorPageNumber === pageNumber;
      })
      .sort((a, b) => {
        if (a.location !== b.location) {
          return a.location === 'body' ? 1 : -1;
        }
        if (a.from !== b.from) return a.from - b.from;
        return a.id.localeCompare(b.id);
      });
    if (pageRevisions.length === 0) continue;

    const pageRect = pageEl.getBoundingClientRect();
    const x = (pageRect.left - containerRect.left) / zoom + offset.x;
    const y = (pageRect.top - containerRect.top) / zoom + offset.y;
    const width = pageRect.width / zoom;
    const height = pageRect.height / zoom;
    const visibleRevisions = pageRevisions.slice(0, MAX_REVISIONS_PER_PAGE_RAIL);

    rails.push({
      pageNumber,
      x: x + width + RAIL_GAP,
      y,
      width: railWidth,
      height,
      revisions: visibleRevisions,
      hiddenCount: pageRevisions.length - visibleRevisions.length,
    });
  }

  return rails;
}

export function ReviewPageRailOverlay({
  context,
  editorView,
  pluginState,
  railWidth,
}: ReviewPageRailOverlayProps) {
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [visiblePageNumbers, setVisiblePageNumbers] = useState<Set<number>>(new Set());

  useEffect(() => {
    const handleWindowResize = () => {
      requestAnimationFrame(() => setLayoutVersion((current) => current + 1));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => setLayoutVersion((current) => current + 1));
    });
    resizeObserver.observe(context.pagesContainer);

    const mutationObserver = new MutationObserver(() => {
      requestAnimationFrame(() => setLayoutVersion((current) => current + 1));
    });
    mutationObserver.observe(context.pagesContainer, { childList: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [context.pagesContainer]);

  useEffect(() => {
    const pages = context.pagesContainer.querySelectorAll<HTMLElement>('.layout-page');
    const fallbackFirst = parseIntSafe(pages[0]?.dataset.pageNumber);
    if (fallbackFirst !== null) {
      setVisiblePageNumbers((prev) => {
        if (prev.size > 0) return prev;
        return new Set([fallbackFirst]);
      });
    }

    const rootCandidate = context.pagesContainer.closest('.paged-editor');
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePageNumbers((previous) => {
          const next = new Set(previous);

          for (const entry of entries) {
            const pageEl = entry.target as HTMLElement;
            const pageNumber = parseIntSafe(pageEl.dataset.pageNumber);
            if (pageNumber === null) continue;

            if (entry.isIntersecting) {
              next.add(pageNumber);
            } else {
              next.delete(pageNumber);
            }
          }

          return setsEqual(previous, next) ? previous : next;
        });
      },
      {
        root: rootCandidate instanceof HTMLElement ? rootCandidate : null,
        threshold: 0.05,
      }
    );

    for (const page of pages) {
      observer.observe(page);
    }

    return () => observer.disconnect();
  }, [context.pagesContainer, layoutVersion]);

  const rails = useMemo(
    () => createPageRails(context, pluginState.revisions, visiblePageNumbers, railWidth),
    [context, pluginState.revisions, visiblePageNumbers, railWidth]
  );

  const selectRevision = useCallback(
    (revision: ReviewRevisionItem) => {
      if (!editorView) return;

      if (revision.location !== 'body') {
        const pageSelector =
          revision.anchorPageNumber !== null
            ? `.layout-page[data-page-number="${revision.anchorPageNumber}"]`
            : '.layout-page';
        const pageEl = context.pagesContainer.querySelector<HTMLElement>(pageSelector);
        if (!pageEl) return;

        const regionSelector =
          revision.location === 'header' ? '.layout-page-header' : '.layout-page-footer';
        const region = pageEl.querySelector<HTMLElement>(regionSelector);
        (region ?? pageEl).scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
        return;
      }

      const state = editorView.state;
      const maxPos = Math.max(1, state.doc.content.size);
      const safeFrom = Math.max(1, Math.min(revision.from, maxPos));
      const safeTo = Math.max(safeFrom, Math.min(revision.to, maxPos));
      const tr = state.tr.setSelection(TextSelection.create(state.doc, safeFrom, safeTo));
      editorView.dispatch(tr);
      editorView.focus();

      const target = context.findElementsForRange(safeFrom, safeTo)[0];
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        return;
      }

      const coords = context.getCoordinatesForPosition(safeFrom);
      const scrollContainer = context.pagesContainer.closest('.paged-editor');
      if (!coords || !(scrollContainer instanceof HTMLElement)) return;

      const containerOffset = context.getContainerOffset();
      const targetTop = (coords.y + containerOffset.y) * context.zoom;
      scrollContainer.scrollTo({
        top: Math.max(0, targetTop - scrollContainer.clientHeight * 0.45),
        behavior: 'smooth',
      });
    },
    [context, editorView]
  );

  const runDecision = useCallback(
    (revision: ReviewRevisionItem, decision: ReviewDecision) => {
      if (!editorView) return;
      if (revision.status !== 'supported') return;

      if (revision.location === 'body') {
        if (applyRevisionDecision(editorView, pluginState.revisions, revision.id, decision)) {
          return;
        }
        if (!pluginState.mutateDocumentModel) return;
        if (!canApplyBodyModelRevisionDecision(pluginState.revisions, revision.id)) return;
        pluginState.mutateDocumentModel((document) =>
          applyBodyModelRevisionDecisionToDocument(
            document,
            pluginState.revisions,
            revision.id,
            decision
          )
        );
        return;
      }

      if (!pluginState.mutateDocumentModel) return;
      if (!canApplyHeaderFooterRevisionDecision(pluginState.revisions, revision.id)) return;
      pluginState.mutateDocumentModel((document) =>
        applyHeaderFooterRevisionDecisionToDocument(
          document,
          pluginState.revisions,
          revision.id,
          decision
        )
      );
    },
    [editorView, pluginState]
  );

  const canApplyRevisionFromRail = useCallback(
    (revision: ReviewRevisionItem): boolean => {
      if (revision.status !== 'supported') return false;

      if (revision.location === 'body') {
        if (revision.applyTarget === 'pm') {
          return !!editorView;
        }
        return (
          !!pluginState.mutateDocumentModel &&
          canApplyBodyModelRevisionDecision(pluginState.revisions, revision.id)
        );
      }

      return (
        !!pluginState.mutateDocumentModel &&
        canApplyHeaderFooterRevisionDecision(pluginState.revisions, revision.id)
      );
    },
    [editorView, pluginState]
  );

  if (rails.length === 0) return null;

  return (
    <div className="review-page-rails-overlay">
      {rails.map((rail) => (
        <aside
          key={`page-rail-${rail.pageNumber}`}
          className="review-page-rail"
          style={{
            left: rail.x,
            top: rail.y,
            width: rail.width,
            height: rail.height,
          }}
          aria-label={`Tracked changes for page ${rail.pageNumber}`}
        >
          <div className="review-page-rail__header">
            <span>Page {rail.pageNumber}</span>
            <span>{rail.revisions.length + rail.hiddenCount} changes</span>
          </div>
          <div className="review-page-rail__list">
            {rail.revisions.map((revision) => (
              <article
                key={revision.id}
                className={`review-page-item ${revision.id === pluginState.activeRevisionId ? 'active' : ''} ${
                  revision.status === 'unsupported' ? 'unsupported' : ''
                }`}
                onClick={() => selectRevision(revision)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectRevision(revision);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="review-page-item__top">
                  <span
                    className={`review-page-item__type review-page-item__type--${revision.type}`}
                  >
                    {revisionTypeLabel(revision.type)}
                  </span>
                  <span className="review-page-item__author">{revision.author}</span>
                </div>
                <div className="review-page-item__location">{revisionLocationLabel(revision)}</div>
                <div className="review-page-item__preview">{revision.textPreview}</div>
                <div className="review-page-item__meta">{formatRevisionDate(revision.date)}</div>
                <div className="review-page-item__actions">
                  <button
                    type="button"
                    className="review-page-item__action review-page-item__action--accept"
                    onClick={(event) => {
                      event.stopPropagation();
                      runDecision(revision, 'accept');
                    }}
                    disabled={!canApplyRevisionFromRail(revision)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="review-page-item__action review-page-item__action--reject"
                    onClick={(event) => {
                      event.stopPropagation();
                      runDecision(revision, 'reject');
                    }}
                    disabled={!canApplyRevisionFromRail(revision)}
                  >
                    Reject
                  </button>
                </div>
                {revision.reason && <div className="review-page-item__meta">{revision.reason}</div>}
              </article>
            ))}
            {rail.hiddenCount > 0 && (
              <div className="review-page-rail__truncated">
                +{rail.hiddenCount} more changes on this page
              </div>
            )}
          </div>
        </aside>
      ))}
    </div>
  );
}

export const REVIEW_PAGE_RAIL_OVERLAY_STYLES = `
.review-page-rails-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

.review-page-rail {
  position: absolute;
  display: flex;
  flex-direction: column;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
  pointer-events: auto;
}

.review-page-rail__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 11px;
  font-weight: 700;
  color: #1f2937;
  background: rgba(248, 250, 252, 0.96);
}

.review-page-rail__list {
  flex: 1;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-page-item {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  padding: 7px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
}

.review-page-item:hover {
  border-color: #cbd5e1;
}

.review-page-item.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.18);
}

.review-page-item.unsupported {
  background: #fef2f2;
  border-color: #fecaca;
}

.review-page-item__top {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  align-items: center;
}

.review-page-item__type {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.review-page-item__type--insertion,
.review-page-item__type--moveTo {
  color: #166534;
}

.review-page-item__type--formatChange {
  color: #1d4ed8;
}

.review-page-item__type--deletion,
.review-page-item__type--moveFrom {
  color: #991b1b;
}

.review-page-item__author {
  font-size: 11px;
  color: #475569;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-page-item__location {
  font-size: 10px;
  font-weight: 600;
  color: #475569;
}

.review-page-item__preview {
  font-size: 12px;
  line-height: 1.3;
  color: #0f172a;
}

.review-page-item__meta {
  font-size: 10px;
  color: #64748b;
}

.review-page-item__actions {
  display: flex;
  gap: 6px;
}

.review-page-item__action {
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 3px 7px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.review-page-item__action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.review-page-item__action--accept {
  border-color: #bbf7d0;
  color: #166534;
  background: #f0fdf4;
}

.review-page-item__action--reject {
  border-color: #fecaca;
  color: #991b1b;
  background: #fef2f2;
}

.review-page-rail__truncated {
  font-size: 11px;
  color: #64748b;
  padding: 4px 2px 2px;
}
`;
