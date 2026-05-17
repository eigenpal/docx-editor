import type { CSSProperties } from 'react';
import { getAvatarColor } from '@eigenpal/docx-editor-core/utils/comments';

// Re-export the framework-agnostic helpers so existing React imports keep
// working; the canonical implementations live in core.
export {
  getCommentText,
  formatDate,
  getInitials,
  getAvatarColor,
  truncateText,
  type TrackedChangeEntry,
} from '@eigenpal/docx-editor-core/utils/comments';

// ─── React-only style helpers below (CSSProperties live next to JSX) ──────

export const ICON_BUTTON_STYLE: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  color: '#5f6368',
  display: 'flex',
  borderRadius: '50%',
};

export const CANCEL_BUTTON_STYLE: CSSProperties = {
  padding: '6px 16px',
  fontSize: 14,
  border: 'none',
  background: 'none',
  color: '#1a73e8',
  cursor: 'pointer',
  fontWeight: 500,
  fontFamily: 'inherit',
};

export function avatarStyle(name: string, size: 32 | 28 = 32): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    backgroundColor: getAvatarColor(name),
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size === 32 ? 13 : 11,
    fontWeight: 500,
    flexShrink: 0,
  };
}

export function submitButtonStyle(enabled: boolean): CSSProperties {
  return {
    padding: '6px 16px',
    fontSize: 14,
    border: 'none',
    borderRadius: 20,
    background: enabled ? '#1a73e8' : '#f1f3f4',
    color: enabled ? '#fff' : '#80868b',
    cursor: enabled ? 'pointer' : 'default',
    fontWeight: 500,
    fontFamily: 'inherit',
  };
}

// truncateText + TrackedChangeEntry are re-exported above from core.
