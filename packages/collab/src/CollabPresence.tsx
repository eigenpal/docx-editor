/**
 * CollabPresence — shows connected users' avatars in the toolbar.
 *
 * Renders a row of colored circles with initials, like Google Docs'
 * "who's here" indicator. Shows tooltip with full name on hover.
 *
 * Usage:
 *   <CollabPresence users={connectedUsers} status={status} />
 */

import type { CollabUser } from './provider';
import type { CollabStatus } from './useCollaboration';

interface CollabPresenceProps {
  users: CollabUser[];
  status: CollabStatus;
  /** Max avatars to show before "+N" overflow */
  maxVisible?: number;
}

const STATUS_COLORS: Record<CollabStatus, string> = {
  idle: '#9ca3af',
  connecting: '#f59e0b',
  connected: '#10b981',
  disconnected: '#ef4444',
};

const STATUS_LABELS: Record<CollabStatus, string> = {
  idle: 'Offline',
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

export function CollabPresence({ users, status, maxVisible = 5 }: CollabPresenceProps) {
  const visible = users.slice(0, maxVisible);
  const overflow = users.length - maxVisible;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 8,
        marginRight: 8,
      }}
    >
      {/* Connection status dot */}
      <div
        title={STATUS_LABELS[status]}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: STATUS_COLORS[status],
          flexShrink: 0,
        }}
      />

      {/* User avatars */}
      <div style={{ display: 'flex', marginLeft: 4 }}>
        {visible.map((user, i) => (
          <div
            key={`${user.name}-${i}`}
            title={user.name}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              backgroundColor: user.color ?? '#1a73e8',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'system-ui, sans-serif',
              border: '2px solid #fff',
              marginLeft: i > 0 ? -8 : 0,
              cursor: 'default',
              position: 'relative',
              zIndex: maxVisible - i,
            }}
          >
            {user.name
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
        ))}
        {overflow > 0 && (
          <div
            title={`${overflow} more`}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              backgroundColor: '#e5e7eb',
              color: '#6b7280',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: 'system-ui, sans-serif',
              border: '2px solid #fff',
              marginLeft: -8,
            }}
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
