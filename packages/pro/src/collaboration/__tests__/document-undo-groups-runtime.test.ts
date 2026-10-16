/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A server agent's tasks through the collaborative server runtime: one undo group per task
// makes one `session.undo()` revert exactly the last task, while a person edits the same room.
import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { DocxEditor, type DocxEditorServerRuntime } from '@docx-editor.dev/editor-api';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  TreePackageStore,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { BODY, nodeText, walk } from './document-peer-support.ts';
import { collaborationDocx } from './support.ts';

const ROOM = 'undo-groups-runtime-room';
const cleanup: (() => void)[] = [];
let now = 1_800_000_000_000;

function elapse(milliseconds: number): void {
  now += milliseconds;
  setSystemTime(new Date(now));
}

afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  setSystemTime();
});

async function room() {
  setSystemTime(new Date(now));
  const humanDoc = new Y.Doc();
  const humanAwareness = new Awareness(humanDoc);
  const human = await createDocumentCollaboration({
    ydoc: humanDoc,
    awareness: humanAwareness,
    documentId: ROOM,
    identity: { actorId: 'person', name: 'Person' },
    bootstrap: { kind: 'create', document: collaborationDocx() },
  });
  const loaded = readOoxmlPackage(human.document);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const port = createCollaborationDocumentPort(store, { documentId: ROOM });
  const detach = human.session.attach(port);

  const agentDoc = new Y.Doc();
  Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(humanDoc), 'join');
  const agentAwareness = new Awareness(agentDoc);
  const agent = await createDocumentCollaboration({
    ydoc: agentDoc,
    awareness: agentAwareness,
    documentId: ROOM,
    identity: { actorId: 'agent', name: 'Agent', role: 'agent' },
    bootstrap: { kind: 'join' },
  });
  const forward = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(target, update, 'relay');
  };
  const toAgent = forward(agentDoc);
  const toHuman = forward(humanDoc);
  humanDoc.on('update', toAgent);
  agentDoc.on('update', toHuman);
  const runtime = await DocxEditor.createCollaborative(agent.document, agent.session);
  cleanup.push(() => {
    runtime.dispose();
    humanDoc.off('update', toAgent);
    agentDoc.off('update', toHuman);
    detach();
    agent.destroy();
    human.destroy();
    agentAwareness.destroy();
    humanAwareness.destroy();
    agentDoc.destroy();
    humanDoc.destroy();
  });
  const humanTexts = (): string[] => {
    const found: string[] = [];
    walk(store.bodyStore().part.root, (node) => {
      if (node.kind === 'paragraph') found.push(nodeText(node));
    });
    return found;
  };
  const humanType = (index: number, text: string): void => {
    const paragraphId = port.paragraphs()[index]!.nodeId;
    const ops = [{ op: 'insertText' as const, paragraphId, offset: 0, text }];
    expect(human.session.gateOperations(ops, BODY)).toBeNull();
    const result = store.transact(BODY, (context) => {
      for (const op of ops) context.apply(op);
    });
    if (!result.ok) throw new Error(result.reason);
    port.flushPendingJournals();
  };
  return { agent, runtime, humanTexts, humanType };
}

async function appendParagraph(runtime: DocxEditorServerRuntime, text: string): Promise<void> {
  await runtime.run(async (context) => {
    context.document.body.insertParagraph(text, 'End');
    await context.sync();
  });
}

async function bodyTexts(runtime: DocxEditorServerRuntime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

describe('undo groups on a collaborative server runtime', () => {
  test('without groups, two tasks 100 ms apart share one undo step', async () => {
    const { agent, runtime, humanTexts } = await room();
    await appendParagraph(runtime, 'Task A');
    elapse(100);
    await appendParagraph(runtime, 'Task B');
    expect(agent.session.undo()).toBe(true);
    expect(humanTexts()).not.toContain('Task A');
  });

  test('one group per task: one undo reverts exactly the last task', async () => {
    const { agent, runtime, humanTexts, humanType } = await room();
    const taskA = agent.session.beginUndoGroup();
    try {
      await appendParagraph(runtime, 'Task A');
    } finally {
      taskA.end();
    }
    elapse(100);
    const taskB = agent.session.beginUndoGroup();
    try {
      await appendParagraph(runtime, 'Task B part 1');
      humanType(0, 'person ');
      elapse(2_000);
      await appendParagraph(runtime, 'Task B part 2');
    } finally {
      taskB.end();
    }
    expect(agent.session.undo()).toBe(true);
    expect(humanTexts()).toEqual([
      'person Alpha paragraph',
      'Bravo paragraph',
      'Charlie paragraph',
      'Task A',
    ]);
    expect(await bodyTexts(runtime)).toEqual(humanTexts());
    // Save and reopen keeps the result.
    const reopened = await DocxEditor.createServer(await runtime.save());
    cleanup.push(() => reopened.dispose());
    expect(await bodyTexts(reopened)).toEqual(humanTexts());
    expect(agent.session.undo()).toBe(true);
    expect(humanTexts()).toEqual([
      'person Alpha paragraph',
      'Bravo paragraph',
      'Charlie paragraph',
    ]);
  });

  test('a refused run inside a group leaves the group to collect the next run', async () => {
    const { agent, runtime, humanTexts } = await room();
    const task = agent.session.beginUndoGroup();
    await appendParagraph(runtime, 'Step 1');
    const refused = runtime.run(async (context) => {
      context.document.body.insertParagraph('x'.repeat(2_000_000), 'End');
      await context.sync();
    });
    await expect(refused).rejects.toBeDefined();
    elapse(5_000);
    await appendParagraph(runtime, 'Step 2');
    task.end();
    expect(humanTexts().slice(-2)).toEqual(['Step 1', 'Step 2']);
    expect(agent.session.undo()).toBe(true);
    expect(humanTexts()).toEqual(['Alpha paragraph', 'Bravo paragraph', 'Charlie paragraph']);
  });
});
