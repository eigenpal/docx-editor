/**
 * Collaboration Provider — client-side Yjs + Hocuspocus connection.
 *
 * Creates a Yjs document, connects to the Hocuspocus WebSocket server,
 * and returns the ProseMirror plugins needed for collaborative editing
 * (sync, undo, cursor awareness).
 *
 * Usage:
 *   import { createCollabProvider } from '@eigenpal/docx-collab/provider';
 *
 *   const collab = createCollabProvider({
 *     documentName: 'doc-123',
 *     serverUrl: 'ws://localhost:8080',
 *     user: { name: 'Yash', color: '#e8912d' },
 *   });
 *
 *   // Add collab.plugins to your ProseMirror EditorState
 *   // Call collab.destroy() on unmount
 */

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin, yUndoPluginKey } from 'y-prosemirror';
import type { Plugin } from 'prosemirror-state';

export interface CollabUser {
  name: string;
  color?: string;
  /** URL or data URI for avatar */
  avatar?: string;
}

export interface CollabProviderOptions {
  /** Unique document identifier (e.g. draft ID, template ID) */
  documentName: string;
  /** Hocuspocus WebSocket URL (e.g. ws://localhost:8080) */
  serverUrl: string;
  /** Current user info (shown as cursor label) */
  user: CollabUser;
  /** Auth token (Supabase JWT) sent to Hocuspocus onAuthenticate */
  token?: string;
  /** Called when connection status changes */
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
  /** Called when sync is complete (document loaded from server) */
  onSynced?: () => void;
  /** Called when other users' awareness changes (cursor positions) */
  onAwarenessChange?: (users: CollabUser[]) => void;
}

/** Random color for cursor when none is provided */
function randomCursorColor(): string {
  const colors = [
    '#e8912d',
    '#1a73e8',
    '#d93025',
    '#0b8043',
    '#8430ce',
    '#c5221f',
    '#137333',
    '#185abc',
    '#e37400',
    '#9334e6',
    '#e52592',
    '#12b5cb',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export interface CollabProviderResult {
  /** ProseMirror plugins to add to your EditorState */
  plugins: Plugin[];
  /** The shared Yjs document */
  ydoc: Y.Doc;
  /** The Yjs XML fragment bound to ProseMirror */
  yXmlFragment: Y.XmlFragment;
  /** The Hocuspocus provider (for status, awareness) */
  provider: HocuspocusProvider;
  /** Clean up — call on component unmount */
  destroy: () => void;
  /** Get list of currently connected users */
  getConnectedUsers: () => CollabUser[];
}

export function createCollabProvider(options: CollabProviderOptions): CollabProviderResult {
  const { documentName, serverUrl, user, token, onStatusChange, onSynced, onAwarenessChange } =
    options;

  // Create shared Yjs document
  const ydoc = new Y.Doc();

  // The XML fragment that y-prosemirror binds to
  const yXmlFragment = ydoc.getXmlFragment('prosemirror');

  // Connect to Hocuspocus server
  const provider = new HocuspocusProvider({
    url: serverUrl,
    name: documentName,
    document: ydoc,
    token: token ?? '',
    onStatus: (data: any) => {
      onStatusChange?.(data.status as 'connecting' | 'connected' | 'disconnected');
    },
    onSynced: () => {
      onSynced?.();
    },
    onAwarenessChange: (data: any) => {
      if (!onAwarenessChange) return;
      const users: CollabUser[] = [];
      (data.states as Map<number, any>).forEach((state: any) => {
        if (state.user) {
          users.push(state.user);
        }
      });
      onAwarenessChange(users);
    },
  });

  const awareness = provider.awareness!;

  // Set local user awareness (cursor label + color)
  const cursorColor = user.color ?? randomCursorColor();
  awareness.setLocalStateField('user', {
    name: user.name,
    color: cursorColor,
    colorLight: `${cursorColor}33`,
    avatar: user.avatar,
  });
  const plugins: Plugin[] = [ySyncPlugin(yXmlFragment), yCursorPlugin(awareness), yUndoPlugin()];

  const getConnectedUsers = (): CollabUser[] => {
    const users: CollabUser[] = [];
    awareness.getStates().forEach((state: any) => {
      if (state.user) {
        users.push(state.user);
      }
    });
    return users;
  };

  const destroy = () => {
    provider.destroy();
    ydoc.destroy();
  };

  return {
    plugins,
    ydoc,
    yXmlFragment,
    provider,
    destroy,
    getConnectedUsers,
  };
}

export { yUndoPluginKey };
