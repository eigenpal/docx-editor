import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import type { Plugin } from 'prosemirror-state';
import type { Comment } from '@eigenpal/docx-core/types/content';

export interface CollaborativeUser {
  clientId: number;
  name: string;
  color: string;
  isLocal: boolean;
}

export interface CollaborationState {
  plugins: Plugin[];
  users: CollaborativeUser[];
  roomName: string;
  status: 'connecting' | 'connected' | 'disconnected';
  /** Comments mirrored from a Y.Array on the same Y.Doc — pass to DocxEditor's `comments` prop. */
  comments: Comment[];
  /** Pass to DocxEditor's `onCommentsChange`. Replaces the Y.Array contents in a single transact. */
  setComments: (next: Comment[]) => void;
}

const SIGNALING_SERVERS = ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com'];

export function useCollaboration(
  roomName: string,
  localUser: { name: string; color: string }
): CollaborationState {
  // Y.Doc, provider, prosemirror plugins, and the comments Y.Array are created
  // once per room. localUser changes (e.g. renaming) update awareness without
  // rebuilding the doc.
  const { ydoc, provider, plugins, yComments } = useMemo(() => {
    const ydoc = new Y.Doc();
    const provider = new WebrtcProvider(roomName, ydoc, { signaling: SIGNALING_SERVERS });
    const fragment = ydoc.getXmlFragment('prosemirror');
    const plugins = [ySyncPlugin(fragment), yCursorPlugin(provider.awareness), yUndoPlugin()];
    const yComments = ydoc.getArray<Comment>('comments');
    return { ydoc, provider, plugins, yComments };
  }, [roomName]);

  const [users, setUsers] = useState<CollaborativeUser[]>([]);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [comments, setCommentsState] = useState<Comment[]>(() => yComments.toArray());

  // Publish local user identity into awareness so peers can render avatars + cursors.
  useEffect(() => {
    provider.awareness.setLocalStateField('user', localUser);
  }, [provider, localUser.name, localUser.color]);

  // Subscribe to awareness + connection changes.
  useEffect(() => {
    const refreshUsers = () => {
      const localId = provider.awareness.clientID;
      const all: CollaborativeUser[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (!state.user) return;
        all.push({
          clientId,
          name: state.user.name,
          color: state.user.color,
          isLocal: clientId === localId,
        });
      });
      setUsers(all);
    };
    const handleStatus = (event: { connected: boolean }) => {
      setStatus(event.connected ? 'connected' : 'disconnected');
    };

    refreshUsers();
    provider.awareness.on('change', refreshUsers);
    provider.on('status', handleStatus);

    return () => {
      provider.awareness.off('change', refreshUsers);
      provider.off('status', handleStatus);
    };
  }, [provider]);

  // Mirror the Y.Array<Comment> into React state. Replace-all on remote change
  // is fine for a demo; for production you'd use a Y.Map keyed by comment id
  // for finer-grained merge semantics.
  useEffect(() => {
    const sync = () => setCommentsState(yComments.toArray());
    sync();
    yComments.observeDeep(sync);
    return () => yComments.unobserveDeep(sync);
  }, [yComments]);

  // Push the editor's new comments array back into Yjs. Naive replace-all:
  // delete everything, push the new array. Adequate for a demo on a small
  // collection where the controlled API hands us the full array each time.
  const setComments = useCallback(
    (next: Comment[]) => {
      ydoc.transact(() => {
        if (yComments.length > 0) yComments.delete(0, yComments.length);
        if (next.length > 0) yComments.push(next);
      });
    },
    [ydoc, yComments]
  );

  // Tear down on unmount / room change.
  useEffect(() => {
    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc]);

  return { plugins, users, roomName, status, comments, setComments };
}
