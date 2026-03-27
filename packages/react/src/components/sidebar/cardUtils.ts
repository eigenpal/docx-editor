import type { CSSProperties } from 'react';
import type { Paragraph } from '@eigenpal/docx-core/types/content';

/** Extract plain text from a Comment's paragraph content. */
export function getCommentText(paragraphs?: Paragraph[]): string {
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

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Kibana-style avatar colors — deterministic per author name
const AVATAR_COLORS = [
  '#6DCCB1',
  '#79AAD9',
  '#EE789D',
  '#A987D1',
  '#E6A85F',
  '#F2CC8F',
  '#68B3A2',
  '#B07AA1',
  '#59A14F',
  '#FF9DA7',
  '#E15759',
  '#76B7B2',
];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

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

/** Truncate text to maxLength characters with ellipsis. */
export function truncateText(text: string, maxLength = 50): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

export interface TrackedChangeEntry {
  type: 'insertion' | 'deletion' | 'replacement';
  text: string;
  /** For replacements: the deleted text that was replaced */
  deletedText?: string;
  author: string;
  date?: string;
  from: number;
  to: number;
  revisionId: number;
}
