// One client worker process: several simulated participants in one room.
//
// Each participant is a real collaboration replica. It joins through the public
// `createHocuspocusCollaboration` factory, attaches a canonical document store as the editor
// does, and writes keystrokes as store transactions. Remote edits materialize into that store
// before the latency clock stops, so a latency sample covers the whole path from one
// keystroke to the edit in another participant's document.
//
// The runner starts this file with `bun` and an IPC channel. See `protocol.ts`.

import './counting-websocket.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  paragraphTextOf,
  paraIdOf,
  type OoxmlNode,
  type StoryScope,
  type TreeDocOp,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import { COLLABORATION_FORMAT_VERSION } from '@docx-editor.dev/pro/collaboration';
import {
  createHocuspocusCollaboration,
  type HocuspocusCollaborationRoom,
} from '@docx-editor.dev/pro/collaboration/hocuspocus';
import * as Y from 'yjs';
import { traffic, trafficByType } from './counting-websocket.ts';
import { documentTextDigest, storeFrom } from './document-text.ts';
import { planEdits, type PlannedEdit } from './edit-model.ts';
import {
  closeObserver,
  deleteSetDigest,
  joinObserver,
  observerDigest,
  observerReport,
  type Observer,
} from './observer.ts';
import {
  now,
  type ClientDigest,
  type ClientReport,
  type RunnerMessage,
  type StatusEvent,
  type Traffic,
  type WorkerConfig,
  type WorkerMessage,
  type WorkerReport,
} from './protocol.ts';

const BODY: StoryScope = { kind: 'body' };
const config = JSON.parse(process.env.BENCH_WORKER ?? '{}') as WorkerConfig;

function send(message: WorkerMessage): void {
  process.send?.(message);
}

interface Participant {
  readonly index: number;
  readonly room: HocuspocusCollaborationRoom;
  readonly store: TreePackageStore;
  readonly detach: () => void;
  readonly stopStatus: () => void;
  readonly joinMs: number;
  readonly sent: [number, number][];
  readonly received: [number, number, number][];
  readonly refused: Record<string, number>;
  readonly schedulerLagMs: number[];
  readonly remoteApplyMs: number[];
  readonly statusEvents: StatusEvent[];
  readonly plan: PlannedEdit[];
  /** The stable `w14:paraId` of the paragraph this participant writes in. */
  ownParaId: string;
  /** The stable `w14:paraId` of the paragraph every participant edits. */
  readonly sharedParaId: string;
  pendingStart: number | null;
  applied: number;
}

function bodyElement(store: TreePackageStore): OoxmlNode {
  const visit = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === 'body') return node;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const body = visit(store.bodyStore().part.root);
  if (!body) throw new Error('the document has no body');
  return body;
}

function bodyBlocks(store: TreePackageStore): readonly OoxmlNode[] {
  const body = bodyElement(store);
  return body.kind === 'textValue' ? [] : body.children;
}

/**
 * Top-level body paragraphs that hold text, by stable `w14:paraId`.
 *
 * Node ids are local to one replica revision: a split paragraph gets a provisional id that
 * changes when the edit replicates. A caret follows the paraId, which is what remote carets
 * use too.
 */
function textParagraphs(store: TreePackageStore): string[] {
  const part = store.bodyStore().part;
  return bodyBlocks(store)
    .filter((block) => block.kind === 'paragraph')
    .filter((block) => (paragraphTextOf(part, block.id) ?? '').trim().length > 0)
    .map((block) => paraIdOf(block))
    .filter((paraId): paraId is string => paraId !== null);
}

/** The current node id of the paragraph with this paraId, or null if it is gone. */
function nodeIdOf(store: TreePackageStore, paraId: string): string | null {
  for (const block of bodyBlocks(store)) {
    if (block.kind === 'paragraph' && paraIdOf(block) === paraId) return block.id;
  }
  return null;
}

function paraIdAfter(store: TreePackageStore, paraId: string): string | null {
  const blocks = bodyBlocks(store);
  const at = blocks.findIndex((block) => block.kind === 'paragraph' && paraIdOf(block) === paraId);
  const next = blocks[at + 1];
  return at >= 0 && next?.kind === 'paragraph' ? paraIdOf(next) : null;
}

function count(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function join(index: number, seedBytes: Uint8Array | null): Promise<Participant> {
  const started = now();
  const room = await createHocuspocusCollaboration({
    url: config.url,
    roomId: config.roomId,
    token: JSON.stringify({
      token: config.token,
      collaborationVersion: COLLABORATION_FORMAT_VERSION,
    }),
    identity: { actorId: `bench-${index}`, name: `Participant ${index + 1}` },
    bootstrap: seedBytes ? { kind: 'create', document: seedBytes } : { kind: 'join' },
    syncedTimeoutMs: 60_000,
  });
  if (seedBytes) {
    // Other participants may join only after the server holds the seeded room.
    await waitUntil(
      () => room.provider.isSynced && !room.provider.hasUnsyncedChanges,
      60_000,
      'the server to acknowledge the seeded room'
    );
  }
  const store = storeFrom(room.document);
  const port = createCollaborationDocumentPort(store, { documentId: config.roomId });
  const detach = room.session.attach(port);
  const paragraphs = textParagraphs(store);
  if (paragraphs.length < 2) throw new Error('the seed document needs two text paragraphs');
  const statusEvents: StatusEvent[] = [];
  const stopStatus = room.session.subscribeStatus((status, reason, detail) => {
    statusEvents.push({
      t: now(),
      status,
      ...(reason ? { reason } : {}),
      ...(detail ? { detail } : {}),
    });
  });
  const participant: Participant = {
    index,
    room,
    store,
    detach,
    stopStatus,
    joinMs: now() - started,
    sent: [],
    received: [],
    refused: {},
    schedulerLagMs: [],
    remoteApplyMs: [],
    statusEvents,
    plan: planEdits(config.seed * 1000 + index, config.durationMs, config.profile),
    // Paragraph 0 is shared. Everyone else spreads over the rest of the document.
    sharedParaId: paragraphs[0]!,
    ownParaId: paragraphs[1 + (index % (paragraphs.length - 1))]!,
    pendingStart: null,
    applied: 0,
  };
  // A remote transaction starts here and ends in the listener below. The time between is the
  // client's own cost: Yjs integration plus materialization into the document store.
  let remoteStartedAt = 0;
  room.ydoc.on('beforeTransaction', (transaction: Y.Transaction) => {
    if (!transaction.local) remoteStartedAt = now();
  });
  // Registered after the session's own listener, so a remote transaction has already
  // materialized into the store when this runs.
  room.ydoc.on('afterTransaction', (transaction: Y.Transaction) => {
    const t = now();
    const self = room.ydoc.clientID;
    if (transaction.local) {
      if (participant.pendingStart === null) return;
      const before = transaction.beforeState.get(self) ?? 0;
      const after = transaction.afterState.get(self) ?? 0;
      if (after > before) participant.sent.push([after, participant.pendingStart]);
      return;
    }
    participant.remoteApplyMs.push(t - remoteStartedAt);
    for (const [client, clock] of transaction.afterState) {
      if (client === self) continue;
      if (clock > (transaction.beforeState.get(client) ?? 0)) {
        participant.received.push([client, clock, t]);
      }
    }
  });
  return participant;
}

function apply(participant: Participant, ops: readonly TreeDocOp[]): boolean {
  const refusal = participant.room.session.gateOperations(ops, BODY);
  if (refusal) {
    count(participant.refused, refusal);
    return false;
  }
  const result = participant.store.transact(BODY, (context) => {
    for (const op of ops) context.apply(op);
  });
  if (!result.ok) {
    count(participant.refused, `${result.reason} (${ops[0]!.op})`);
    return false;
  }
  participant.room.session.flushPendingJournals();
  return true;
}

function lengthOf(participant: Participant, paragraphId: string): number {
  return paragraphTextOf(participant.store.bodyStore().part, paragraphId)?.length ?? 0;
}

function editOps(participant: Participant, edit: PlannedEdit): TreeDocOp[] | null {
  const paraId = edit.shared ? participant.sharedParaId : participant.ownParaId;
  const paragraphId = nodeIdOf(participant.store, paraId);
  if (!paragraphId) {
    count(participant.refused, 'paragraph-missing');
    return null;
  }
  const length = lengthOf(participant, paragraphId);
  // In the shared paragraph each keystroke lands at its own position. In the own paragraph,
  // the participant types at the end, as a person writing a new sentence does.
  const offset = edit.shared ? Math.floor(edit.position * (length + 1)) : length;
  switch (edit.action) {
    case 'type':
      return [{ op: 'insertText', paragraphId, offset, text: edit.character }];
    case 'backspace':
      return offset > 0
        ? [{ op: 'deleteText', paragraphId, start: offset - 1, end: offset }]
        : null;
    case 'enter':
      // Nobody splits the shared paragraph, or the shared target would drift away.
      if (edit.shared) return [{ op: 'insertText', paragraphId, offset, text: ' ' }];
      return [{ op: 'splitParagraph', paragraphId, offset }];
    case 'bold': {
      const start = Math.max(0, offset - 5);
      return offset > start
        ? [
            {
              op: 'setRunProperties',
              paragraphId,
              start,
              end: offset,
              properties: [{ localName: 'b' }],
            },
          ]
        : null;
    }
  }
}

function runEdit(participant: Participant, edit: PlannedEdit): void {
  const ops = editOps(participant, edit);
  if (!ops) return;
  participant.pendingStart = now();
  try {
    if (!apply(participant, ops)) return;
  } finally {
    participant.pendingStart = null;
  }
  participant.applied += 1;
  if (ops[0]!.op === 'splitParagraph') {
    participant.ownParaId =
      paraIdAfter(participant.store, participant.ownParaId) ?? participant.ownParaId;
  }
  // A real editor publishes the caret after every keystroke. Peers receive it as awareness.
  const paragraphId = nodeIdOf(
    participant.store,
    edit.shared ? participant.sharedParaId : participant.ownParaId
  );
  if (!paragraphId) return;
  const offset = lengthOf(participant, paragraphId);
  participant.room.session.setLocalSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function runPlan(participant: Participant, startAt: number): Promise<void> {
  return new Promise((resolve) => {
    let next = 0;
    const step = (): void => {
      const edit = participant.plan[next];
      if (!edit) {
        resolve();
        return;
      }
      const due = startAt + edit.at;
      const wait = due - now();
      if (wait > 1) {
        setTimeout(step, wait);
        return;
      }
      participant.schedulerLagMs.push(Math.max(0, -wait));
      next += 1;
      try {
        runEdit(participant, edit);
      } catch (error) {
        count(participant.refused, `exception: ${(error as Error).message}`);
      }
      setTimeout(step, 0);
    };
    step();
  });
}

function digestOf(participant: Participant): ClientDigest {
  return {
    index: participant.index,
    status: participant.room.session.status(),
    stateVector: Buffer.from(Y.encodeStateVector(participant.room.ydoc)).toString('base64'),
    deleteSet: deleteSetDigest(participant.room.ydoc),
    text: documentTextDigest(participant.store),
  };
}

function reportOf(participant: Participant): ClientReport {
  return {
    index: participant.index,
    clientId: participant.room.ydoc.clientID,
    joinMs: participant.joinMs,
    sent: participant.sent,
    received: participant.received,
    planned: participant.plan.length,
    applied: participant.applied,
    refused: participant.refused,
    schedulerLagMs: participant.schedulerLagMs,
    remoteApplyMs: participant.remoteApplyMs,
    statusEvents: participant.statusEvents,
  };
}

async function main(): Promise<void> {
  const participants: Participant[] = [];
  const observers: Observer[] = [];
  const joinFailures: string[] = [];
  let peakRssMb = 0;
  const rssTimer = setInterval(() => {
    peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / 1048576);
  }, 500);

  const [first, ...rest] = config.clients;
  const seedBytes = config.seedDocumentPath
    ? new Uint8Array(readFileSync(config.seedDocumentPath))
    : null;
  const joinOne = async (index: number, bytes: Uint8Array | null): Promise<void> => {
    try {
      if (config.observers) {
        observers.push(await joinObserver(index, config.url, config.roomId, config.token));
      } else {
        participants.push(await join(index, bytes));
      }
    } catch (error) {
      joinFailures.push(`participant ${index + 1}: ${(error as Error).message}`);
    }
  };
  if (first !== undefined) await joinOne(first, seedBytes);
  // Everyone else in this worker joins at once, which is a small join storm.
  await Promise.all(rest.map((index) => joinOne(index, null)));
  send({ type: 'joined', failures: joinFailures });

  let loadCpu = process.cpuUsage();
  let loadStarted = now();
  let loadWallMs = 0;
  let loadTraffic = { ...traffic };
  let loadTrafficByType: Record<string, Traffic> = {};

  process.on('message', async (message: RunnerMessage) => {
    try {
      if (message.type === 'start-load') {
        const wait = Math.max(0, message.startAt - now());
        await new Promise((resolve) => setTimeout(resolve, wait));
        loadCpu = process.cpuUsage();
        loadStarted = now();
        const trafficAtStart = { ...traffic };
        const byTypeAtStart = structuredClone(trafficByType);
        await Promise.all(participants.map((p) => runPlan(p, message.startAt)));
        // Readers have no plan. They still receive for the whole typing window, so the
        // load phase never ends before it, or reader traffic and CPU would be lost.
        const windowEnd = message.startAt + config.durationMs;
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, windowEnd - now())));
        loadCpu = process.cpuUsage(loadCpu);
        loadWallMs = now() - loadStarted;
        loadTraffic = {
          bytesSent: traffic.bytesSent - trafficAtStart.bytesSent,
          bytesReceived: traffic.bytesReceived - trafficAtStart.bytesReceived,
          messagesSent: traffic.messagesSent - trafficAtStart.messagesSent,
          messagesReceived: traffic.messagesReceived - trafficAtStart.messagesReceived,
        };
        loadTrafficByType = Object.fromEntries(
          Object.entries(trafficByType).map(([type, value]) => {
            const before = byTypeAtStart[type];
            return [
              type,
              {
                bytesSent: value.bytesSent - (before?.bytesSent ?? 0),
                bytesReceived: value.bytesReceived - (before?.bytesReceived ?? 0),
                messagesSent: value.messagesSent - (before?.messagesSent ?? 0),
                messagesReceived: value.messagesReceived - (before?.messagesReceived ?? 0),
              },
            ];
          })
        );
        send({ type: 'load-finished' });
      } else if (message.type === 'digest') {
        send({
          type: 'digest',
          digests: [...participants.map(digestOf), ...observers.map(observerDigest)],
        });
      } else if (message.type === 'shutdown') {
        clearInterval(rssTimer);
        const report: WorkerReport = {
          workerId: config.workerId,
          clients: [...participants.map(reportOf), ...observers.map(observerReport)],
          joinFailures,
          cpuUserMs: loadCpu.user / 1000,
          cpuSystemMs: loadCpu.system / 1000,
          loadWallMs,
          peakRssMb,
          traffic,
          loadTraffic,
          loadTrafficByType,
        };
        writeFileSync(config.reportPath, JSON.stringify(report));
        for (const participant of participants) {
          participant.stopStatus();
          participant.detach();
          participant.room.destroy();
        }
        for (const observer of observers) closeObserver(observer);
        send({ type: 'reported' });
        setTimeout(() => process.exit(0), 50);
      }
    } catch (error) {
      send({ type: 'fatal', error: (error as Error).stack ?? String(error) });
    }
  });
}

process.on('uncaughtException', (error) => {
  send({ type: 'fatal', error: error.stack ?? String(error) });
});
process.on('unhandledRejection', (error) => {
  send({ type: 'fatal', error: (error as Error)?.stack ?? String(error) });
});

await main();
