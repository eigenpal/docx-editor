/**
 * Comments & Track Changes Sidebar
 *
 * Right-side panel displaying comments and tracked changes.
 * Connected to document via leader lines.
 */

import React, { useEffect, useState } from 'react';
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
  topOffset?: number;
  showResolved?: boolean;
  isAddingComment?: boolean;
}

export const SIDEBAR_WIDTH = 320;

export const CommentsSidebar: React.FC<CommentsSidebarProps> = ({
  comments,
  trackedChanges,
  activeCommentId,
  onClose,
  onCommentClick,
  onCommentReply,
  onCommentResolve,
  onCommentReopen,
  onCommentDelete,
  onAddComment,
  onCancelAddComment,
  onAcceptChange,
  onRejectChange,
  topOffset = 0,
  showResolved: showResolvedProp = false,
  isAddingComment = false,
}) => {
  const [open, setOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(showResolvedProp);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [newCommentText, setNewCommentText] = useState('');

  useEffect(() => {
    requestAnimationFrame(() => setOpen(true));
  }, []);

  const visibleComments = comments.filter((c) => {
    if (c.parentId) return false; // replies shown nested
    if (c.done && !showResolved) return false;
    return true;
  });

  const getReplies = (commentId: number) => comments.filter((c) => c.parentId === commentId);

  const handleReplySubmit = (commentId: number) => {
    if (replyText.trim()) {
      onCommentReply?.(commentId, replyText.trim());
      setReplyText('');
      setReplyingTo(null);
    }
  };

  const handleNewCommentSubmit = () => {
    if (newCommentText.trim()) {
      onAddComment?.(newCommentText.trim());
      setNewCommentText('');
    }
  };

  return (
    <aside
      className="docx-comments-sidebar"
      role="complementary"
      aria-label="Comments and changes"
      style={{
        position: 'absolute',
        top: topOffset,
        right: 0,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        zIndex: 40,
        backgroundColor: '#fff',
        borderLeft: '1px solid #dadce0',
        transform: open ? 'translateX(0)' : `translateX(${SIDEBAR_WIDTH + 10}px)`,
        transition: 'transform 0.2s ease',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #e8eaed',
        }}
      >
        <span style={{ fontWeight: 500, fontSize: 14, color: '#1f1f1f' }}>Comments</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setShowResolved(!showResolved)}
            title={showResolved ? 'Hide resolved' : 'Show resolved'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              color: showResolved ? '#1a73e8' : '#5f6368',
            }}
          >
            <MaterialSymbol name="check_circle" size={18} />
          </button>
          <button
            onClick={onClose}
            title="Close sidebar"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              color: '#5f6368',
            }}
          >
            <MaterialSymbol name="close" size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
        {/* New comment input */}
        {isAddingComment && (
          <div
            style={{
              margin: '4px 12px 8px',
              padding: 12,
              borderRadius: 8,
              border: '1px solid #1a73e8',
              backgroundColor: '#fff',
            }}
          >
            <textarea
              autoFocus
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              onKeyDown={(e) => {
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
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontSize: 13,
                lineHeight: '18px',
                fontFamily: 'inherit',
                minHeight: 40,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => {
                  onCancelAddComment?.();
                  setNewCommentText('');
                }}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  border: 'none',
                  background: 'none',
                  color: '#5f6368',
                  cursor: 'pointer',
                  borderRadius: 4,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleNewCommentSubmit}
                disabled={!newCommentText.trim()}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  border: 'none',
                  background: newCommentText.trim() ? '#1a73e8' : '#e8eaed',
                  color: newCommentText.trim() ? '#fff' : '#80868b',
                  cursor: newCommentText.trim() ? 'pointer' : 'default',
                  borderRadius: 4,
                }}
              >
                Comment
              </button>
            </div>
          </div>
        )}

        {/* Comments list */}
        {visibleComments.map((comment) => {
          const replies = getReplies(comment.id);
          const isActive = activeCommentId === comment.id;
          return (
            <div
              key={comment.id}
              data-comment-id={comment.id}
              className="docx-comment-card"
              onClick={() => onCommentClick?.(comment.id)}
              style={{
                margin: '4px 12px',
                padding: 12,
                borderRadius: 8,
                border: isActive ? '1px solid #1a73e8' : '1px solid #dadce0',
                backgroundColor: comment.done ? '#f8f9fa' : '#fff',
                cursor: 'pointer',
                opacity: comment.done ? 0.7 : 1,
              }}
            >
              {/* Comment header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    backgroundColor: '#1a73e8',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 500,
                    flexShrink: 0,
                  }}
                >
                  {(comment.initials || comment.author.charAt(0) || 'U').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#1f1f1f' }}>
                    {comment.author || 'Unknown'}
                  </div>
                  {comment.date && (
                    <div style={{ fontSize: 11, color: '#80868b' }}>
                      {new Date(comment.date).toLocaleDateString()}
                    </div>
                  )}
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', gap: 2 }}>
                  {!comment.done ? (
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
                        padding: 2,
                        color: '#5f6368',
                        display: 'flex',
                      }}
                    >
                      <MaterialSymbol name="check" size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCommentReopen?.(comment.id);
                      }}
                      title="Reopen"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 2,
                        color: '#5f6368',
                        display: 'flex',
                      }}
                    >
                      <MaterialSymbol name="undo" size={16} />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCommentDelete?.(comment.id);
                    }}
                    title="Delete"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 2,
                      color: '#5f6368',
                      display: 'flex',
                    }}
                  >
                    <MaterialSymbol name="delete" size={16} />
                  </button>
                </div>
              </div>

              {/* Comment text */}
              <div style={{ fontSize: 13, color: '#3c4043', lineHeight: '18px', marginTop: 4 }}>
                {getCommentText(comment.content)}
              </div>

              {/* Replies */}
              {replies.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e8eaed' }}>
                  {replies.map((reply) => (
                    <div key={reply.id} style={{ marginBottom: 8 }}>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}
                      >
                        <div
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            backgroundColor: '#34a853',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 500,
                            flexShrink: 0,
                          }}
                        >
                          {(reply.initials || reply.author.charAt(0) || 'U').toUpperCase()}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#1f1f1f' }}>
                          {reply.author || 'Unknown'}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#3c4043',
                          lineHeight: '16px',
                          paddingLeft: 26,
                        }}
                      >
                        {getCommentText(reply.content)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input */}
              {replyingTo === comment.id ? (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    autoFocus
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleReplySubmit(comment.id);
                      }
                      if (e.key === 'Escape') {
                        setReplyingTo(null);
                        setReplyText('');
                      }
                    }}
                    placeholder="Reply..."
                    style={{
                      width: '100%',
                      border: '1px solid #dadce0',
                      borderRadius: 4,
                      outline: 'none',
                      resize: 'none',
                      fontSize: 12,
                      padding: 8,
                      fontFamily: 'inherit',
                      minHeight: 32,
                    }}
                  />
                  <div
                    style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}
                  >
                    <button
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyText('');
                      }}
                      style={{
                        padding: '2px 8px',
                        fontSize: 11,
                        border: 'none',
                        background: 'none',
                        color: '#5f6368',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleReplySubmit(comment.id)}
                      disabled={!replyText.trim()}
                      style={{
                        padding: '2px 8px',
                        fontSize: 11,
                        border: 'none',
                        background: replyText.trim() ? '#1a73e8' : '#e8eaed',
                        color: replyText.trim() ? '#fff' : '#80868b',
                        cursor: replyText.trim() ? 'pointer' : 'default',
                        borderRadius: 4,
                      }}
                    >
                      Reply
                    </button>
                  </div>
                </div>
              ) : (
                !comment.done && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setReplyingTo(comment.id);
                    }}
                    style={{
                      marginTop: 6,
                      padding: '4px 0',
                      fontSize: 12,
                      background: 'none',
                      border: 'none',
                      color: '#1a73e8',
                      cursor: 'pointer',
                    }}
                  >
                    Reply
                  </button>
                )
              )}
            </div>
          );
        })}

        {/* Tracked changes */}
        {trackedChanges.map((change, idx) => (
          <div
            key={`tc-${change.revisionId}-${idx}`}
            className="docx-tracked-change-card"
            style={{
              margin: '4px 12px',
              padding: 12,
              borderRadius: 8,
              border: '1px solid #dadce0',
              backgroundColor: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <MaterialSymbol
                name={change.type === 'insertion' ? 'add' : 'remove'}
                size={16}
                style={{ color: change.type === 'insertion' ? '#2e7d32' : '#c62828' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#1f1f1f' }}>
                  {change.author || 'Unknown'}
                </div>
                {change.date && (
                  <div style={{ fontSize: 11, color: '#80868b' }}>
                    {new Date(change.date).toLocaleDateString()}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                <button
                  onClick={() => onAcceptChange?.(change.from, change.to)}
                  title="Accept"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    color: '#2e7d32',
                    display: 'flex',
                  }}
                >
                  <MaterialSymbol name="check" size={16} />
                </button>
                <button
                  onClick={() => onRejectChange?.(change.from, change.to)}
                  title="Reject"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    color: '#c62828',
                    display: 'flex',
                  }}
                >
                  <MaterialSymbol name="close" size={16} />
                </button>
              </div>
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: '18px',
                color: change.type === 'insertion' ? '#2e7d32' : '#c62828',
                textDecoration: change.type === 'deletion' ? 'line-through' : 'underline',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 60,
                overflow: 'hidden',
              }}
            >
              {change.text}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {visibleComments.length === 0 && trackedChanges.length === 0 && !isAddingComment && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: '#80868b',
              fontSize: 13,
            }}
          >
            No comments or changes yet.
          </div>
        )}
      </div>
    </aside>
  );
};
