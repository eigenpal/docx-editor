import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createHocuspocusCollaboration } from '@docx-editor.dev/pro/collaboration/hocuspocus';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { AGENT_TOKEN, COLLAB_URL, requireRoomId } from './config.ts';

/** Acknowledged by Hocuspocus, not a promise that its persistence hook has completed. */
export async function waitForOutboundSync(provider: HocuspocusProvider, timeout = 10_000) {
  if (provider.isSynced && !provider.hasUnsyncedChanges) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      provider.off('unsyncedChanges', check);
      provider.off('synced', check);
    };
    const check = () => {
      if (provider.isSynced && !provider.hasUnsyncedChanges) {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for document acknowledgement'));
    }, timeout);
    provider.on('unsyncedChanges', check);
    provider.on('synced', check);
    check();
  });
}

export async function openAgentRoom(roomId: string, seed?: Uint8Array) {
  const room = await createHocuspocusCollaboration({
    url: COLLAB_URL,
    roomId: requireRoomId(roomId),
    token: AGENT_TOKEN,
    identity: {
      actorId: crypto.randomUUID(),
      name: 'Review agent',
      role: 'agent',
      color: '#49775f',
    },
    bootstrap: seed ? { kind: 'create', document: seed } : { kind: 'join' },
    syncedTimeoutMs: 10_000,
    offlineEditing: false,
  });
  try {
    const runtime = await DocxEditor.createCollaborative(room.document, room.session, {
      author: 'Review agent',
      revisionTextView: 'original',
    });
    return {
      room,
      runtime,
      dispose() {
        runtime.dispose();
        room.destroy();
      },
    };
  } catch (error) {
    room.destroy();
    throw error;
  }
}
export type AgentRoom = Awaited<ReturnType<typeof openAgentRoom>>;
