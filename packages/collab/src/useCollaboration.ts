/**
 * useCollaboration — React hook for collaborative editing.
 *
 * Manages the lifecycle of the Yjs provider: connects on mount,
 * cleans up on unmount, exposes connection status and user list.
 *
 * Usage:
 *   const { plugins, status, connectedUsers } = useCollaboration({
 *     documentName: draftId,
 *     serverUrl: 'ws://localhost:8080',
 *     user: { name: 'Yash' },
 *     token: supabaseSession.access_token,
 *   });
 *
 *   // Pass plugins to the editor
 *   <DocxEditor collabPlugins={plugins} />
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import {
  createCollabProvider,
  type CollabProviderOptions,
  type CollabProviderResult,
  type CollabUser,
} from './provider';
import type { Plugin } from 'prosemirror-state';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'idle';

export interface UseCollaborationOptions {
  /** Unique document identifier */
  documentName: string;
  /** Hocuspocus WebSocket URL */
  serverUrl: string;
  /** Current user info */
  user: CollabUser;
  /** Supabase JWT token */
  token?: string;
  /** Set to false to disable collaboration (default: true) */
  enabled?: boolean;
}

export interface UseCollaborationResult {
  /** ProseMirror plugins for collaborative editing (empty if disabled) */
  plugins: Plugin[];
  /** Connection status */
  status: CollabStatus;
  /** List of users currently editing this document */
  connectedUsers: CollabUser[];
  /** Whether the initial sync from server is complete */
  synced: boolean;
}

export function useCollaboration(options: UseCollaborationOptions): UseCollaborationResult {
  const { documentName, serverUrl, user, token, enabled = true } = options;

  const [status, setStatus] = useState<CollabStatus>('idle');
  const [synced, setSynced] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState<CollabUser[]>([]);
  const providerRef = useRef<CollabProviderResult | null>(null);

  // Stable user reference to avoid re-creating provider on every render
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!enabled || !documentName || !serverUrl) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    setSynced(false);

    const collab = createCollabProvider({
      documentName,
      serverUrl,
      user: userRef.current,
      token,
      onStatusChange: setStatus,
      onSynced: () => setSynced(true),
      onAwarenessChange: setConnectedUsers,
    });

    providerRef.current = collab;

    return () => {
      collab.destroy();
      providerRef.current = null;
      setStatus('idle');
      setSynced(false);
      setConnectedUsers([]);
    };
  }, [documentName, serverUrl, token, enabled]);

  const plugins = useMemo(() => {
    if (!enabled || !providerRef.current) return [];
    return providerRef.current.plugins;
  }, [enabled, status]);

  return {
    plugins,
    status,
    connectedUsers,
    synced,
  };
}
