/**
 * Comments & Track Changes Sidebar
 *
 * Google Docs-style floating cards positioned relative to their anchored text.
 * Cards appear at the Y position of their corresponding text in the document.
 * Clicking a card expands it to show reply input and action buttons.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { Comment, Paragraph } from '@eigenpal/docx-core/types/content';
import { MaterialSymbol } from './ui/Icons';

/** Extract plain text from a Comment's paragraph content */
function getCommentText(paragraphs?: Paragraph[]): string {
  if (!paragraphs?.length) return '';
  return paragraphs
    .flatMap((p) =>
      p.content
        .filter((c) => c.type === 'run')
        .flatMap((r) => ('content' in r ? r.content : []))
        .filter((c) => c.type === 'text')
        .map((t) => ('text' in t ? t.text : ''))
    )
    .join('');
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Kibana-style avatar colors — deterministic per author name
const AVATAR_COLORS = [
  '#6DCCB1', // teal
  '#79AAD9', // blue
  '#EE789D', // pink
  '#A987D1', // purple
  '#E6A85F', // orange
  '#F2CC8F', // gold
  '#68B3A2', // seafoam
  '#B07AA1', // mauve
  '#59A14F', // green
  '#FF9DA7', // salmon
  '#E15759', // red
  '#76B7B2', // cyan
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export interface TrackedChangeEntry {
  type: 'insertion' | 'deletion';
  text: string;
  author: string;
  date?: string;
  from: number;
  to: number;
  revisionId: number;
}

export interface CommentsSidebarProps {
  comments: Comment[];
  trackedChanges: TrackedChangeEntry[];
  activeCommentId: number | null;
  onClose: () => void;
  onCommentClick?: (commentId: number) => void;
  onCommentReply?: (commentId: number, text: string) => void;
  onCommentResolve?: (commentId: number) => void;
  onCommentReopen?: (commentId: number) => void;
  onCommentDelete?: (commentId: number) => void;
  onAddComment?: (text: string) => void;
  onCancelAddComment?: () => void;
  onAcceptChange?: (from: number, to: number) => void;
  onRejectChange?: (from: number, to: number) => void;
  onTrackedChangeReply?: (revisionId: number, text: string) => void;
  topOffset?: number;
  showResolved?: boolean;
  isAddingComment?: boolean;
  /** Y position (relative to scroll container) for the new comment input */
  addCommentYPosition?: number | null;
  /** Page width in pixels — used to position sidebar next to page edge */
  pageWidth?: number;
  /** Ref to the editor scroll container for DOM position queries */
  editorContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export const SIDEBAR_WIDTH = 340;

// Minimum gap between stacked cards to avoid overlap
const MIN_CARD_GAP = 8;

export const CommentsSidebar: React.FC<CommentsSidebarProps> = ({
  comments,
  trackedChanges,
  activeCommentId: _activeCommentId,
  onClose: _onClose,
  onCommentClick,
  onCommentReply,
  onCommentResolve,
  onCommentReopen: _onCommentReopen,
  onCommentDelete,
  onAddComment,
  onCancelAddComment,
  onAcceptChange,
  onRejectChange,
  onTrackedChangeReply,
  topOffset = 0,
  showResolved: showResolvedProp = false,
  isAddingComment = false,
  addCommentYPosition = null,
  pageWidth = 816,
  editorContainerRef,
}) => {
  const [showResolved] = useState(showResolvedProp);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [newCommentText, setNewCommentText] = useState('');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [cardPositions, setCardPositions] = useState<Map<string, number>>(new Map());
  const [initialPositionsDone, setInitialPositionsDone] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const visibleComments = comments.filter((c) => {
    if (c.parentId != null) return false;
    if (c.done && !showResolved) return false;
    return true;
  });

  const getReplies = (commentId: number) => comments.filter((c) => c.parentId === commentId);

  // Find DOM Y positions for comment/change anchors
  // IMPORTANT: queries must be scoped to .paged-editor__pages to avoid
  // matching sidebar card elements (which also have data-comment-id).
  const updateCardPositions = useCallback(() => {
    const container = editorContainerRef?.current;
    if (!container) return;

    const pagesEl = container.querySelector('.paged-editor__pages');
    if (!pagesEl) return;

    const containerRect = container.getBoundingClientRect();
    const scrollTop = container.scrollTop;
    const positions: { id: string; targetY: number; height: number }[] = [];

    // Find comment highlight elements (inside pages only, not sidebar)
    for (const comment of visibleComments) {
      const el = pagesEl.querySelector(`[data-comment-id="${comment.id}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        positions.push({
          id: `comment-${comment.id}`,
          targetY: rect.top - containerRect.top + scrollTop,
          height: cardRefs.current.get(`comment-${comment.id}`)?.offsetHeight || 80,
        });
      }
    }

    // Find tracked change elements (inside pages only)
    trackedChanges.forEach((change, idx) => {
      const cardId = `tc-${change.revisionId}-${idx}`;
      const selector = change.type === 'insertion' ? '.docx-insertion' : '.docx-deletion';
      const els = pagesEl.querySelectorAll(selector);
      for (const el of els) {
        const htmlEl = el as HTMLElement;
        if (
          htmlEl.dataset.changeAuthor === change.author &&
          htmlEl.textContent?.includes(change.text.slice(0, 20))
        ) {
          const rect = el.getBoundingClientRect();
          positions.push({
            id: cardId,
            targetY: rect.top - containerRect.top + scrollTop,
            height: cardRefs.current.get(cardId)?.offsetHeight || 80,
          });
          break;
        }
      }
    });

    // Include the "add comment" input box in the layout if it has a Y position
    if (isAddingComment && addCommentYPosition != null) {
      positions.push({
        id: 'new-comment-input',
        targetY: addCommentYPosition,
        height: cardRefs.current.get('new-comment-input')?.offsetHeight || 120,
      });
    }

    // Sort by target Y and resolve overlaps
    positions.sort((a, b) => a.targetY - b.targetY);
    const resolvedPositions = new Map<string, number>();
    let lastBottom = 0;

    for (const pos of positions) {
      const y = Math.max(pos.targetY, lastBottom + MIN_CARD_GAP);
      resolvedPositions.set(pos.id, y);
      lastBottom = y + pos.height;
    }

    setCardPositions(resolvedPositions);
  }, [visibleComments, trackedChanges, editorContainerRef, isAddingComment, addCommentYPosition]);

  // Listen for clicks on comment/change elements in the document body → expand the sidebar card
  useEffect(() => {
    const container = editorContainerRef?.current;
    if (!container) return;

    const pagesEl = container.querySelector('.paged-editor__pages');
    if (!pagesEl) return;

    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Clicks inside the sidebar itself are handled by card onClick — ignore here
      if (sidebarRef.current?.contains(target)) return;

      // Clicks inside the pages area — check for comment/change highlights
      if (pagesEl.contains(target)) {
        // Check for comment highlight click
        const commentEl = target.closest('[data-comment-id]') as HTMLElement | null;
        if (commentEl?.dataset.commentId) {
          setExpandedCard(`comment-${commentEl.dataset.commentId}`);
          onCommentClick?.(Number(commentEl.dataset.commentId));
          return;
        }

        // Check for tracked change click
        const insertionEl = target.closest('.docx-insertion') as HTMLElement | null;
        const deletionEl = target.closest('.docx-deletion') as HTMLElement | null;
        const changeEl = insertionEl || deletionEl;
        if (changeEl) {
          const author = changeEl.dataset.changeAuthor || '';
          const text = changeEl.textContent || '';
          const type = insertionEl ? 'insertion' : 'deletion';
          const idx = trackedChanges.findIndex(
            (tc) => tc.type === type && tc.author === author && text.includes(tc.text.slice(0, 20))
          );
          if (idx >= 0) {
            setExpandedCard(`tc-${trackedChanges[idx].revisionId}-${idx}`);
            return;
          }
        }
      }

      // Click on grey area or anywhere else outside sidebar/highlights → collapse
      setExpandedCard(null);
      setMenuOpenFor(null);
    };

    container.addEventListener('click', handleDocClick);
    return () => container.removeEventListener('click', handleDocClick);
  }, [editorContainerRef, trackedChanges, onCommentClick]);

  // Update positions on mount, resize, and when comments/changes list changes.
  // We do NOT use a MutationObserver — it caused feedback loops because the sidebar
  // cards (which have data-comment-id) live inside the same scroll container.
  useEffect(() => {
    const container = editorContainerRef?.current;
    if (!container) return;

    // Calculate positions after a short delay to let the layout-painter render.
    // Run twice: once quickly for existing elements, once delayed for new marks.
    const timerQuick = setTimeout(() => {
      updateCardPositions();
    }, 50);
    const timerFull = setTimeout(() => {
      updateCardPositions();
      setInitialPositionsDone(true);
    }, 400);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(updateCardPositions);
    });
    resizeObserver.observe(container);

    return () => {
      clearTimeout(timerQuick);
      clearTimeout(timerFull);
      resizeObserver.disconnect();
    };
  }, [updateCardPositions, editorContainerRef]);

  const handleNewCommentSubmit = () => {
    if (newCommentText.trim()) {
      onAddComment?.(newCommentText.trim());
      setNewCommentText('');
    }
  };

  const handleCardClick = (cardId: string, commentId?: number) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
    setMenuOpenFor(null);
    if (commentId !== undefined) {
      onCommentClick?.(commentId);
    }
  };

  // Determine if we have valid positions (fallback to stacked layout if not)
  const hasPositions = cardPositions.size > 0;

  // Shared reply section renderer (used by both comment and tracked change cards)
  const renderReplySection = (
    replyKey: number,
    _cardId: string,
    submitFn?: (id: number, text: string) => void
  ) => (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12 }}>
      {replyingTo === replyKey ? (
        <div>
          <input
            ref={(el) => el?.focus({ preventScroll: true })}
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                if (replyText.trim() && submitFn) submitFn(replyKey, replyText.trim());
                setReplyText('');
                setReplyingTo(null);
              }
              if (e.key === 'Escape') {
                setReplyingTo(null);
                setReplyText('');
              }
            }}
            placeholder="Reply or add others with @"
            style={{
              width: '100%',
              border: '1px solid #1a73e8',
              borderRadius: 20,
              outline: 'none',
              fontSize: 14,
              padding: '8px 16px',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              color: '#202124',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setReplyingTo(null);
                setReplyText('');
              }}
              style={{
                padding: '6px 16px',
                fontSize: 14,
                border: 'none',
                background: 'none',
                color: '#1a73e8',
                cursor: 'pointer',
                fontWeight: 500,
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (replyText.trim() && submitFn) submitFn(replyKey, replyText.trim());
                setReplyText('');
                setReplyingTo(null);
              }}
              disabled={!replyText.trim()}
              style={{
                padding: '6px 16px',
                fontSize: 14,
                border: 'none',
                borderRadius: 20,
                background: replyText.trim() ? '#1a73e8' : '#f1f3f4',
                color: replyText.trim() ? '#fff' : '#80868b',
                cursor: replyText.trim() ? 'pointer' : 'default',
                fontWeight: 500,
                fontFamily: 'inherit',
              }}
            >
              Reply
            </button>
          </div>
        </div>
      ) : (
        <input
          readOnly
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setReplyingTo(replyKey);
          }}
          placeholder="Reply or add others with @"
          style={{
            width: '100%',
            border: '1px solid #dadce0',
            borderRadius: 20,
            outline: 'none',
            fontSize: 14,
            padding: '8px 16px',
            fontFamily: 'inherit',
            color: '#80868b',
            cursor: 'text',
            backgroundColor: '#fff',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );

  const renderCommentCard = (comment: Comment, _idx: number) => {
    const replies = getReplies(comment.id);
    const cardId = `comment-${comment.id}`;
    const isExpanded = expandedCard === cardId;
    const authorInitials = getInitials(comment.author || 'U');
    const yPos = cardPositions.get(cardId);

    return (
      <div
        key={comment.id}
        ref={(el) => {
          if (el) cardRefs.current.set(cardId, el);
          else cardRefs.current.delete(cardId);
        }}
        data-comment-id={comment.id}
        className="docx-comment-card"
        onClick={() => handleCardClick(cardId, comment.id)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          ...(hasPositions
            ? yPos !== undefined
              ? { position: 'absolute', top: yPos, left: 0, right: 0 }
              : { position: 'absolute', top: -9999, left: 0, right: 0, opacity: 0 }
            : { marginBottom: 6 }),
          padding: isExpanded ? '10px 12px' : '8px 10px',
          borderRadius: 8,
          backgroundColor: isExpanded ? '#fff' : '#f8fbff',
          cursor: 'pointer',
          opacity: hasPositions && yPos === undefined ? 0 : comment.done ? 0.6 : 1,
          boxShadow: isExpanded
            ? '0 1px 3px rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)'
            : '0 1px 3px rgba(60,64,67,0.2), 0 2px 6px rgba(60,64,67,0.08)',
          transition: initialPositionsDone ? 'box-shadow 0.2s ease, top 0.15s ease' : 'none',
        }}
      >
        {/* Header: avatar + name/date + actions */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              backgroundColor: getAvatarColor(comment.author || 'U'),
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {authorInitials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#202124' }}>
              {comment.author || 'Unknown'}
            </div>
            <div style={{ fontSize: 11, color: '#5f6368' }}>{formatDate(comment.date)}</div>
          </div>
          {isExpanded && (
            <div style={{ display: 'flex', gap: 4, marginTop: 2, position: 'relative' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCommentResolve?.(comment.id);
                }}
                title="Resolve"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: '#5f6368',
                  display: 'flex',
                  borderRadius: '50%',
                }}
              >
                <MaterialSymbol name="check" size={20} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpenFor(menuOpenFor === cardId ? null : cardId);
                }}
                title="More options"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: '#5f6368',
                  display: 'flex',
                  borderRadius: '50%',
                }}
              >
                <MaterialSymbol name="more_vert" size={20} />
              </button>
              {menuOpenFor === cardId && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    top: 32,
                    right: 0,
                    background: '#fff',
                    borderRadius: 8,
                    boxShadow: '0 2px 6px rgba(60,64,67,0.3), 0 1px 2px rgba(60,64,67,0.15)',
                    zIndex: 100,
                    minWidth: 120,
                    padding: '4px 0',
                  }}
                >
                  <button
                    onClick={() => {
                      setMenuOpenFor(null);
                      // TODO: edit comment
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 16px',
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      fontSize: 14,
                      color: '#202124',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseOver={(e) => {
                      (e.target as HTMLElement).style.backgroundColor = '#f1f3f4';
                    }}
                    onMouseOut={(e) => {
                      (e.target as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpenFor(null);
                      onCommentDelete?.(comment.id);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 16px',
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      fontSize: 14,
                      color: '#202124',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseOver={(e) => {
                      (e.target as HTMLElement).style.backgroundColor = '#f1f3f4';
                    }}
                    onMouseOut={(e) => {
                      (e.target as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Comment body */}
        <div
          style={{
            fontSize: 13,
            color: '#202124',
            lineHeight: '20px',
            marginTop: 6,
          }}
        >
          {getCommentText(comment.content)}
        </div>

        {/* Replies — collapsed: show truncated preview; expanded: show full thread */}
        {replies.length > 0 && (
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
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      backgroundColor: getAvatarColor(reply.author || 'U'),
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {getInitials(reply.author || 'U')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#202124' }}>
                      {reply.author || 'Unknown'}
                    </div>
                    <div style={{ fontSize: 11, color: '#5f6368' }}>{formatDate(reply.date)}</div>
                  </div>
                  {isExpanded && (
                    <button
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 4,
                        color: '#5f6368',
                        display: 'flex',
                      }}
                    >
                      <MaterialSymbol name="more_vert" size={20} />
                    </button>
                  )}
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
        )}

        {/* Reply input */}
        {isExpanded && !comment.done && renderReplySection(comment.id, cardId, onCommentReply)}
      </div>
    );
  };

  const getTrackedChangeReplies = (revisionId: number) =>
    comments.filter((c) => c.parentId === revisionId);

  const renderTrackedChangeCard = (change: TrackedChangeEntry, idx: number) => {
    const authorName = change.author || 'Unknown';
    const initials = getInitials(authorName);
    const dateStr = formatDate(change.date);
    const cardId = `tc-${change.revisionId}-${idx}`;
    const isExpanded = expandedCard === cardId;
    const yPos = cardPositions.get(cardId);
    const tcReplies = getTrackedChangeReplies(change.revisionId);

    return (
      <div
        key={cardId}
        ref={(el) => {
          if (el) cardRefs.current.set(cardId, el);
          else cardRefs.current.delete(cardId);
        }}
        className="docx-tracked-change-card"
        onClick={() => handleCardClick(cardId)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          ...(hasPositions
            ? yPos !== undefined
              ? { position: 'absolute', top: yPos, left: 0, right: 0 }
              : { position: 'absolute', top: -9999, left: 0, right: 0, opacity: 0 }
            : { marginBottom: 6 }),
          padding: isExpanded ? '10px 12px' : '8px 10px',
          borderRadius: 8,
          backgroundColor: isExpanded ? '#fff' : '#f8fbff',
          cursor: 'pointer',
          boxShadow: isExpanded
            ? '0 1px 3px rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)'
            : '0 1px 3px rgba(60,64,67,0.2), 0 2px 6px rgba(60,64,67,0.08)',
          transition: initialPositionsDone ? 'box-shadow 0.2s ease, top 0.15s ease' : 'none',
        }}
      >
        {/* Header: avatar + name/date + actions */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              backgroundColor: getAvatarColor(authorName),
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#202124' }}>{authorName}</div>
            {dateStr && <div style={{ fontSize: 11, color: '#5f6368' }}>{dateStr}</div>}
          </div>
          {isExpanded && (
            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAcceptChange?.(change.from, change.to);
                }}
                title="Accept"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: '#5f6368',
                  display: 'flex',
                  borderRadius: '50%',
                }}
              >
                <MaterialSymbol name="check" size={20} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRejectChange?.(change.from, change.to);
                }}
                title="Reject"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: '#5f6368',
                  display: 'flex',
                  borderRadius: '50%',
                }}
              >
                <MaterialSymbol name="close" size={20} />
              </button>
            </div>
          )}
        </div>

        {/* Change description */}
        <div
          style={{
            fontSize: 13,
            lineHeight: '20px',
            color: '#202124',
            marginTop: 6,
          }}
        >
          {change.type === 'insertion' ? 'Added' : 'Deleted'}{' '}
          <span
            style={{ color: change.type === 'insertion' ? '#137333' : '#c5221f', fontWeight: 500 }}
          >
            &quot;{change.text.length > 50 ? change.text.slice(0, 50) + '...' : change.text}&quot;
          </span>
        </div>

        {/* Replies — collapsed: show truncated preview; expanded: show full thread */}
        {tcReplies.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {(isExpanded ? tcReplies : tcReplies.slice(-1)).map((reply) => (
              <div
                key={reply.id}
                style={{
                  marginBottom: isExpanded ? 8 : 0,
                  paddingTop: 8,
                  borderTop: '1px solid #e8eaed',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      backgroundColor: getAvatarColor(reply.author || 'U'),
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {getInitials(reply.author || 'U')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#202124' }}>
                      {reply.author || 'Unknown'}
                    </div>
                    <div style={{ fontSize: 11, color: '#5f6368' }}>{formatDate(reply.date)}</div>
                  </div>
                  {isExpanded && (
                    <button
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 4,
                        color: '#5f6368',
                        display: 'flex',
                      }}
                    >
                      <MaterialSymbol name="more_vert" size={20} />
                    </button>
                  )}
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
            {!isExpanded && tcReplies.length > 1 && (
              <div style={{ fontSize: 12, color: '#5f6368', marginTop: 4 }}>
                {tcReplies.length - 1} more {tcReplies.length - 1 === 1 ? 'reply' : 'replies'}
              </div>
            )}
          </div>
        )}

        {/* Reply input */}
        {isExpanded && renderReplySection(change.revisionId, cardId, onTrackedChangeReply)}
      </div>
    );
  };

  return (
    <aside
      ref={sidebarRef}
      className="docx-comments-sidebar"
      role="complementary"
      aria-label="Comments and changes"
      style={{
        position: 'absolute',
        top: topOffset,
        left: `calc(50% - 120px + ${pageWidth / 2 + 12}px)`,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        zIndex: 40,
        backgroundColor: 'transparent',
        overflowY: hasPositions ? 'visible' : 'auto',
        overflowX: 'visible',
        opacity: hasPositions ? 1 : 0,
        transition: 'opacity 0.15s ease',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Cards container — relative for absolute card positioning */}
      <div style={{ position: 'relative' }}>
        {/* New comment input — positioned like other cards via cardPositions */}
        {isAddingComment &&
          (() => {
            const inputYPos = cardPositions.get('new-comment-input');
            return (
              <div
                ref={(el) => {
                  if (el) cardRefs.current.set('new-comment-input', el);
                  else cardRefs.current.delete('new-comment-input');
                }}
                style={{
                  ...(hasPositions && inputYPos !== undefined
                    ? { position: 'absolute', top: inputYPos, left: 0, right: 0 }
                    : { marginBottom: 8 }),
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: '#fff',
                  boxShadow: '0 1px 3px rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)',
                  zIndex: 50,
                }}
              >
                <textarea
                  ref={(el) => el?.focus({ preventScroll: true })}
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleNewCommentSubmit();
                    }
                    if (e.key === 'Escape') {
                      onCancelAddComment?.();
                      setNewCommentText('');
                    }
                  }}
                  placeholder="Add a comment..."
                  style={{
                    width: '100%',
                    border: '1px solid #1a73e8',
                    borderRadius: 20,
                    outline: 'none',
                    resize: 'none',
                    fontSize: 14,
                    lineHeight: '20px',
                    padding: '8px 16px',
                    fontFamily: 'inherit',
                    minHeight: 40,
                    boxSizing: 'border-box',
                    color: '#202124',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => {
                      onCancelAddComment?.();
                      setNewCommentText('');
                    }}
                    style={{
                      padding: '6px 16px',
                      fontSize: 14,
                      border: 'none',
                      background: 'none',
                      color: '#1a73e8',
                      cursor: 'pointer',
                      fontWeight: 500,
                      fontFamily: 'inherit',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleNewCommentSubmit}
                    disabled={!newCommentText.trim()}
                    style={{
                      padding: '6px 16px',
                      fontSize: 14,
                      border: 'none',
                      borderRadius: 20,
                      background: newCommentText.trim() ? '#1a73e8' : '#f1f3f4',
                      color: newCommentText.trim() ? '#fff' : '#80868b',
                      cursor: newCommentText.trim() ? 'pointer' : 'default',
                      fontWeight: 500,
                      fontFamily: 'inherit',
                    }}
                  >
                    Comment
                  </button>
                </div>
              </div>
            );
          })()}

        {/* Comments */}
        {visibleComments.map((comment, idx) => renderCommentCard(comment, idx))}

        {/* Tracked changes */}
        {trackedChanges.map((change, idx) => renderTrackedChangeCard(change, idx))}

        {/* Empty state */}
        {visibleComments.length === 0 && trackedChanges.length === 0 && !isAddingComment && (
          <div
            style={{ padding: '24px 16px', textAlign: 'center', color: '#80868b', fontSize: 13 }}
          >
            No comments or changes yet.
          </div>
        )}
      </div>
    </aside>
  );
};
