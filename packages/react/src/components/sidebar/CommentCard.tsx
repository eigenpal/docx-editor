import { useState } from 'react';
import type { Comment } from '@eigenpal/docx-core/types/content';
import { MaterialSymbol } from '../ui/Icons';
import type { SidebarItemRenderProps } from '../../plugin-api/types';
import {
  getCommentText,
  formatDate,
  getInitials,
  avatarStyle,
  submitButtonStyle,
  ICON_BUTTON_STYLE,
  CANCEL_BUTTON_STYLE,
} from './cardUtils';

export interface CommentCardProps extends SidebarItemRenderProps {
  comment: Comment;
  replies: Comment[];
  onReply?: (commentId: number, text: string) => void;
  onResolve?: (commentId: number) => void;
  onDelete?: (commentId: number) => void;
  onClick?: (commentId: number) => void;
}

export function CommentCard({
  comment,
  replies,
  isExpanded,
  onToggleExpand,
  measureRef,
  onReply,
  onResolve,
  onDelete,
  onClick,
}: CommentCardProps) {
  const [replyingTo, setReplyingTo] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const handleClick = () => {
    onToggleExpand();
    onClick?.(comment.id);
  };

  return (
    <div
      ref={measureRef}
      data-comment-id={comment.id}
      className="docx-comment-card"
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        padding: isExpanded ? '10px 12px' : '8px 10px',
        borderRadius: 8,
        backgroundColor: isExpanded ? '#fff' : '#f8fbff',
        cursor: 'pointer',
        boxShadow: isExpanded
          ? '0 1px 3px rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)'
          : '0 1px 3px rgba(60,64,67,0.2), 0 2px 6px rgba(60,64,67,0.08)',
        opacity: comment.done ? 0.6 : 1,
      }}
    >
      {/* Header: avatar + name/date + actions */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={avatarStyle(comment.author || 'U')}>{getInitials(comment.author || 'U')}</div>
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
                onResolve?.(comment.id);
              }}
              title="Resolve"
              style={ICON_BUTTON_STYLE}
            >
              <MaterialSymbol name="check" size={20} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              title="More options"
              style={ICON_BUTTON_STYLE}
            >
              <MaterialSymbol name="more_vert" size={20} />
            </button>
            {menuOpen && (
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
                    setMenuOpen(false);
                    onDelete?.(comment.id);
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
      <div style={{ fontSize: 13, color: '#202124', lineHeight: '20px', marginTop: 6 }}>
        {getCommentText(comment.content)}
      </div>

      {/* Replies */}
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
      )}

      {/* Reply input */}
      {isExpanded && !comment.done && (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12 }}>
          {replyingTo ? (
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
                    if (replyText.trim()) onReply?.(comment.id, replyText.trim());
                    setReplyText('');
                    setReplyingTo(false);
                  }
                  if (e.key === 'Escape') {
                    setReplyingTo(false);
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
                    setReplyingTo(false);
                    setReplyText('');
                  }}
                  style={CANCEL_BUTTON_STYLE}
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (replyText.trim()) onReply?.(comment.id, replyText.trim());
                    setReplyText('');
                    setReplyingTo(false);
                  }}
                  disabled={!replyText.trim()}
                  style={submitButtonStyle(!!replyText.trim())}
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
                setReplyingTo(true);
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
      )}
    </div>
  );
}
