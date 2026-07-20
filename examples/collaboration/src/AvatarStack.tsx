import React from 'react';
import type { CollaborativeUser } from './useCollaboration';

interface AvatarStackProps {
  users: CollaborativeUser[];
  max?: number;
}

const avatarSize = 28;
const overlap = 10;

const styles: Record<string, React.CSSProperties> = {
  stack: {
    display: 'flex',
    alignItems: 'center',
    paddingLeft: overlap,
  },
  avatar: {
    width: avatarSize,
    height: avatarSize,
    borderRadius: '50%',
    border: '2px solid #fff',
    marginLeft: -overlap,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
    cursor: 'default',
    userSelect: 'none',
    flexShrink: 0,
  },
  overflow: {
    background: '#cbd5e1',
    color: '#0f172a',
  },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).slice(0, 2);
}

export function AvatarStack({ users, max = 5 }: AvatarStackProps) {
  if (users.length === 0) return null;

  // Local user first, then others — mirrors what Google Docs shows.
  const sorted = [...users].sort((a, b) => Number(b.isLocal) - Number(a.isLocal));
  const visible = sorted.slice(0, max);
  const overflow = sorted.length - visible.length;

  return (
    <div style={styles.stack} aria-label={`${users.length} active collaborator(s)`}>
      {visible.map((user) => (
        <div
          key={user.clientId}
          style={{ ...styles.avatar, background: user.color }}
          title={user.isLocal ? `${user.name} (you)` : user.name}
        >
          {initials(user.name)}
        </div>
      ))}
      {overflow > 0 && (
        <div style={{ ...styles.avatar, ...styles.overflow }} title={`${overflow} more`}>
          +{overflow}
        </div>
      )}
    </div>
  );
}
