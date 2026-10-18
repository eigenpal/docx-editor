import path from 'node:path';
import { Server } from '@hocuspocus/server';
import {
  checkCollaborationRoomGeneration,
  prepareCollaborationServerDocument,
  readCollaborationDocument,
} from '@docx-editor.dev/pro/collaboration';
import * as Y from 'yjs';
import { AGENT_TOKEN, COLLAB_PORT, DATA_DIR, USER_TOKEN, requireRoomId } from './config.ts';
import { atomicWrite } from './files.ts';
import { loadStoredReviewRoom } from './stored-room.ts';

const server = new Server({
  port: COLLAB_PORT,
  address: '127.0.0.1',
  debounce: 300,
  async onAuthenticate({ token, documentName }) {
    requireRoomId(documentName);
    if (token !== USER_TOKEN && token !== AGENT_TOKEN) throw new Error('Invalid room token');
    return { role: token === AGENT_TOKEN ? 'agent' : 'human' };
  },
  async onLoadDocument({ documentName, document }) {
    // First, before any update reaches it, so the server never writes a change of its own.
    prepareCollaborationServerDocument(document);
    const file = path.join(DATA_DIR, 'rooms', `${requireRoomId(documentName)}.ydoc`);
    await loadStoredReviewRoom(document, file);
    return document;
  },
  // Send the loaded room to nobody before the first participant joins. Otherwise Hocuspocus
  // sends it to that participant on its next turn, after the participant's own sync.
  async afterLoadDocument({ document }) {
    document.flush();
  },
  // A client holding a generation from before a compaction is refused before it merges.
  async beforeHandleMessage(payload) {
    checkCollaborationRoomGeneration(payload);
  },
  async onStoreDocument({ documentName, document }) {
    const base = path.join(DATA_DIR, 'rooms', requireRoomId(documentName));
    await atomicWrite(`${base}.ydoc`, Y.encodeStateAsUpdate(document));
    await atomicWrite(`${base}.docx`, readCollaborationDocument(document));
  },
});
await server.listen();
console.log(`Review collaboration: ws://127.0.0.1:${COLLAB_PORT}`);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    void server.destroy().then(() => process.exit(0));
  });
