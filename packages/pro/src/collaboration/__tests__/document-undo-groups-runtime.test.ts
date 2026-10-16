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
import {
  createCollaborationDocumentPort,
  type CanonicalPrimitiveJournal,
  type CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  TreePackageStore,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { BODY, nodeText, walk } from './document-peer-support.ts';
import { collaborationDocx } from './support.ts';

const ROOM = 'undo-groups-runtime-room';
const RUNTIME_SEEDS = Number(process.env.UNDO_GROUP_RUNTIME_SEEDS ?? 12);
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
  // The runtime attaches its port through this proxy, so a test can publish a journal through
  // the same listener the runtime's commits reach: one shared state refuses after the commit.
  let journals: ((journal: CanonicalPrimitiveJournal) => void) | null = null;
  const tapped = new Proxy(agent.session, {
    get(target, property, receiver) {
      if (property === 'attach') {
        return (port: CollaborationDocumentPort) =>
          target.attach({
            ...port,
            observePrimitiveJournal: (listener) => {
              journals = listener;
              return port.observePrimitiveJournal(listener);
            },
          });
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const runtime = await DocxEditor.createCollaborative(agent.document, tapped);
  /** Publish a committed journal that shared state refuses, as a stale edit would be. */
  const refuseCommitted = async (): Promise<void> => {
    journals?.({
      effects: [
        { kind: 'spliceText', logicalId: 'missing', utf16Start: 0, deleteCount: 0, insert: 'X' },
      ],
    });
    // The realign ends the batch; the session recovers once it is over.
    await Promise.resolve();
  };
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
  return { agent, runtime, humanTexts, humanType, refuseCommitted };
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

  test('a run the operation gate refuses leaves the group to collect the next run', async () => {
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

  test('a write shared state refuses after commit keeps one step for the whole task', async () => {
    const { agent, runtime, humanTexts, refuseCommitted } = await room();
    const statuses: string[] = [];
    agent.session.subscribeStatus((status, reason) => statuses.push(`${status}:${reason ?? ''}`));
    const task = agent.session.beginUndoGroup();
    await appendParagraph(runtime, 'Step 1');
    await refuseCommitted();
    // The session refused the journal and realigned, then recovered.
    expect(statuses).toContain('error:unknown-logical-id');
    expect(agent.session.status()).toBe('ready');
    elapse(5_000);
    await appendParagraph(runtime, 'Step 2');
    task.end();
    expect(humanTexts().slice(-2)).toEqual(['Step 1', 'Step 2']);
    expect(agent.session.undo()).toBe(true);
    expect(humanTexts()).toEqual(['Alpha paragraph', 'Bravo paragraph', 'Charlie paragraph']);
  });

  test("end() after the run resolves keeps the run's last sync inside the group", async () => {
    const { agent, runtime, humanTexts } = await room();
    const task = agent.session.beginUndoGroup();
    try {
      await runtime.run(async (context) => {
        context.document.body.insertParagraph('Part 1', 'End');
        await context.sync();
        elapse(2_000);
        context.document.body.insertParagraph('Part 2', 'End');
        await context.sync();
      });
    } finally {
      task.end();
    }
    elapse(100);
    await appendParagraph(runtime, 'Next task');
    expect(agent.session.undo()).toBe(true);
    expect(humanTexts().slice(-2)).toEqual(['Part 1', 'Part 2']);
    expect(agent.session.undo()).toBe(true);
    expect(humanTexts()).toEqual(['Alpha paragraph', 'Bravo paragraph', 'Charlie paragraph']);
  });

  // Seeded tasks through `runtime.run` and `context.sync()`: grouped tasks of one to three
  // runs, ungrouped runs, gaps under and over 500 ms, a person typing, undo, and redo.
  for (let seed = 1; seed <= RUNTIME_SEEDS; seed += 1) {
    test(`seeded runtime tasks, seed ${seed}`, async () => {
      let state = seed;
      const random = (): number => {
        state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
        return state / 4_294_967_296;
      };
      const { agent, runtime, humanTexts, humanType } = await room();
      const done: string[][] = [];
      const undone: string[][] = [];
      const all = new Set<string>();
      let counter = 0;
      const present = (token: string): boolean => humanTexts().some((text) => text.includes(token));
      const write = async (task: string[]): Promise<void> => {
        const token = `<A${(counter += 1)}>`;
        await runtime.run(async (context) => {
          const paragraphs = context.document.body.paragraphs;
          paragraphs.load('items');
          await context.sync();
          if (random() < 0.5) context.document.body.insertParagraph(token, 'End');
          else
            paragraphs.items[Math.floor(random() * paragraphs.items.length)]!.insertText(
              token,
              'End'
            );
          await context.sync();
        });
        task.push(token);
        all.add(token);
      };
      for (let step = 0; step < 14; step += 1) {
        const roll = random();
        if (roll < 0.45) {
          const task: string[] = [];
          const group = agent.session.beginUndoGroup();
          try {
            const runs = 1 + Math.floor(random() * 3);
            for (let at = 0; at < runs; at += 1) {
              await write(task);
              if (random() < 0.5) humanType(0, `{P${(counter += 1)}}`);
              elapse([40, 499, 501, 2_000][Math.floor(random() * 4)]!);
            }
          } finally {
            group.end();
          }
          done.push(task);
          undone.length = 0;
        } else if (roll < 0.6) {
          // An ungrouped run, a second apart from anything else, is a step of its own.
          elapse(1_000);
          const task: string[] = [];
          await write(task);
          elapse(1_000);
          done.push(task);
          undone.length = 0;
        } else if (roll < 0.85 && done.length > 0) {
          const task = done.pop()!;
          const kept = [...all].filter((token) => !task.includes(token) && present(token));
          expect(agent.session.undo()).toBe(true);
          for (const token of task) expect(present(token)).toBe(false);
          for (const token of kept) expect(present(token)).toBe(true);
          undone.push(task);
        } else if (undone.length > 0) {
          const task = undone.pop()!;
          expect(agent.session.redo()).toBe(true);
          for (const token of task) expect(present(token)).toBe(true);
          done.push(task);
        } else {
          humanType(Math.floor(random() * 3), `{P${(counter += 1)}}`);
        }
        elapse(100);
      }
      expect(await bodyTexts(runtime)).toEqual(humanTexts());
      const reopened = await DocxEditor.createServer(await runtime.save());
      cleanup.push(() => reopened.dispose());
      expect(await bodyTexts(reopened)).toEqual(humanTexts());
    });
  }
});
