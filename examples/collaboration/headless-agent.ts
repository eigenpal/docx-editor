import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createYjsCollaboration } from '@docx-editor.dev/collaboration-yjs';
import { demoDocumentBytes } from './src/demo-document';

const roomId = 'headless-collaboration-proof';
const inProcessProvider = Object.freeze({ kind: 'in-process-provider' });
const browserDoc = new Y.Doc();
const browserAwareness = new Awareness(browserDoc);
const browserRoom = await createYjsCollaboration({
  ydoc: browserDoc,
  awareness: browserAwareness,
  documentId: roomId,
  identity: { actorId: 'browser-demo', name: 'Browser demo' },
  bootstrap: { kind: 'create', document: demoDocumentBytes() },
});

const agentDoc = new Y.Doc();
Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(browserDoc), inProcessProvider);
const agentAwareness = new Awareness(agentDoc);
const agentRoom = await createYjsCollaboration({
  ydoc: agentDoc,
  awareness: agentAwareness,
  documentId: roomId,
  identity: { actorId: 'agent-contract-review', name: 'Contract review agent', role: 'agent' },
  bootstrap: { kind: 'join' },
});

const forwardToAgent = (update: Uint8Array, origin: unknown): void => {
  if (origin === inProcessProvider) return;
  Y.applyUpdate(agentDoc, update, inProcessProvider);
};
const forwardToBrowser = (update: Uint8Array, origin: unknown): void => {
  if (origin === inProcessProvider) return;
  Y.applyUpdate(browserDoc, update, inProcessProvider);
};
browserDoc.on('update', forwardToAgent);
agentDoc.on('update', forwardToBrowser);

const browserRuntime = await DocxEditor.createCollaborative(
  browserRoom.document,
  browserRoom.session,
  { author: 'Browser demo' }
);
const agentRuntime = await DocxEditor.createCollaborative(agentRoom.document, agentRoom.session, {
  author: 'Contract review agent',
});

try {
  await agentRuntime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();
    paragraphs.items[0]?.insertText('[AI reviewed] ', 'Start');
    await context.sync();
  });

  const browserText = await browserRuntime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    return body.text;
  });
  const saved = await browserRuntime.save();
  console.log(`Headless edit synchronized. Saved ${saved.byteLength} bytes.`);
  console.log(browserText.replaceAll('\r', '\n'));
} finally {
  browserRuntime.dispose();
  agentRuntime.dispose();
  browserDoc.off('update', forwardToAgent);
  agentDoc.off('update', forwardToBrowser);
  browserRoom.destroy();
  agentRoom.destroy();
  browserAwareness.destroy();
  agentAwareness.destroy();
  browserDoc.destroy();
  agentDoc.destroy();
}
