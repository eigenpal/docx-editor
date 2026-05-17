/**
 * Single shared avatar style factory + Vue-only re-exports of the data
 * helpers that live in core. The pure helpers (getCommentText etc.)
 * are bytewise-identical to the React adapter, so we re-export them
 * from the core utility surface instead of forking.
 */
import type { CSSProperties } from 'vue';

export {
  getCommentText,
  formatDate,
  getInitials,
  getAvatarColor,
  truncateText,
  type TrackedChangeEntry,
} from '@eigenpal/docx-editor-core/utils/comments';

import { getAvatarColor } from '@eigenpal/docx-editor-core/utils/comments';

/** Inline style for an avatar bubble — mirrors React's avatarStyle(). */
export function avatarStyle(name: string, size: 32 | 28 = 32): CSSProperties {
  return {
    width: size + 'px',
    height: size + 'px',
    borderRadius: '50%',
    backgroundColor: getAvatarColor(name),
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size === 32 ? '13px' : '11px',
    fontWeight: 500,
    flexShrink: 0,
  };
}
