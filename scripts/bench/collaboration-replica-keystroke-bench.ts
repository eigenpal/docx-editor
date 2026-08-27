/* eslint-disable no-console */
// Isolated keystroke-path timing with and without an attached full-document replica.
//
// Comparable to openspec/changes/full-document-yjs-collaboration/local-edit-baseline.json
// (task 1.7) and collaboration-budgets.json (2x local transact, empty queue after transact).
//
// `transactMs` includes the Yjs write: a journal carries absolute positions against the tree
// it was diffed against, so it is published on the commit rather than held for a later task.
// `flushMs` is therefore near zero, and `pending` must read 0.
//
// Run in isolation: bun scripts/bench/collaboration-replica-keystroke-bench.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { pendingCanonicalJournalCount } from '../../packages/core/src/store/package/canonical-primitive-publish.ts';
import { createCollaborationDocumentPort } from '../../packages/core/src/collaboration/index.ts';
import {
  normalizeParagraphIdentity,
  paragraphTextOf,
  readOoxmlPackage,
  TreePackageStore,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
  type TreeDocOp,
} from '../../packages/core/src/store/index.ts';
import { PACKAGE_NODES_KEY } from '../../packages/pro/src/collaboration/document/index.ts';
import { createDocumentCollaboration } from '../../packages/pro/src/collaboration/document-session.ts';

const WARMUP = 2;
const RUNS = 40;
const LEAK_EDITS = 400;
const FIXTURE = resolve('e2e/fixtures/synthetic-long-edit.docx');
const TRANSACTION_MEDIAN_MAX_MS = 18.612418000000616;
const TRANSACTION_P95_MAX_MS = 21.630750000000262;
const BODY = { kind: 'body' as const };

function summarize(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return {
    medianMs: at(0.5),
    p95Ms: at(0.95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

function visit(node: OoxmlNode, fn: (node: OoxmlNode) => void): void {
  fn(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) visit(child, fn);
}

function paragraphsOf(root: OoxmlNode): OoxmlNode[] {
  const paragraphs: OoxmlNode[] = [];
  visit(root, (node) => {
    if (node.kind === 'paragraph') paragraphs.push(node);
  });
  return paragraphs;
}

function middleParagraph(part: OoxmlPart): OoxmlNode {
  const paragraphs = paragraphsOf(part.root);
  const node = paragraphs[Math.floor((paragraphs.length - 1) * 0.5)];
  if (!node) throw new Error('no middle paragraph');
  return node;
}

function cellParagraphId(root: OoxmlNode): string | null {
  let cell: string | null = null;
  const walk = (node: OoxmlNode, inCell: boolean): void => {
    if (node.kind === 'textValue') return;
    const next = inCell || node.localName === 'tc';
    if (next && node.kind === 'paragraph' && !cell) cell = node.id;
    for (const child of node.children) walk(child, next);
  };
  walk(root, false);
  return cell;
}

const bytes = new Uint8Array(readFileSync(FIXTURE));
const loaded = readOoxmlPackage(bytes);
if (!loaded.ok) throw new Error(loaded.reason);
const originalMain = loaded.package.parts.get(loaded.package.mainDocumentPart);
if (!originalMain) throw new Error('no main');
const normalizedMain = normalizeParagraphIdentity(originalMain);
const template = new TreePackageStore(loaded.package, normalizedMain);
const pkg: OoxmlPackage = template.currentPackage();
const part: OoxmlPart = template.bodyStore().part;

function openStore(): TreePackageStore {
  return new TreePackageStore(pkg, part);
}

interface Timed {
  readonly transactMs: number;
  readonly flushMs: number;
  readonly yUpdates: number;
  readonly pending: number;
}

function applyOps(
  store: TreePackageStore,
  ops: readonly TreeDocOp[],
  ydoc?: Y.Doc,
  flush?: () => void
): Timed {
  let yUpdates = 0;
  const onUpdate = (): void => {
    yUpdates += 1;
  };
  ydoc?.on('update', onUpdate);
  const transactStarted = performance.now();
  const result = store.transact(BODY, (context) => {
    for (const op of ops) context.apply(op);
  });
  const transactMs = performance.now() - transactStarted;
  ydoc?.off('update', onUpdate);
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  const pending = pendingCanonicalJournalCount(store);
  const flushStarted = performance.now();
  flush?.();
  const flushMs = performance.now() - flushStarted;
  return { transactMs, flushMs, yUpdates, pending };
}

function series(
  label: string,
  store: TreePackageStore,
  each: (round: number) => readonly TreeDocOp[],
  ydoc?: Y.Doc,
  flush?: () => void
) {
  const transact: number[] = [];
  const flushTimes: number[] = [];
  let yUpdates = 0;
  let peakPending = 0;
  for (let round = 0; round < WARMUP + RUNS; round += 1) {
    const sample = applyOps(store, each(round), ydoc, flush);
    yUpdates += sample.yUpdates;
    peakPending = Math.max(peakPending, sample.pending);
    if (round >= WARMUP) {
      transact.push(sample.transactMs);
      flushTimes.push(sample.flushMs);
    }
  }
  const transactSummary = summarize(transact);
  const flushSummary = summarize(flushTimes);
  console.log(
    JSON.stringify({
      label,
      transact: transactSummary,
      flush: flushSummary,
      yUpdatesDuringTransact: yUpdates,
      peakPending,
    })
  );
  return { transact: transactSummary, flush: flushSummary, yUpdates, peakPending };
}

const unobserved = openStore();
const soloTarget = middleParagraph(unobserved.bodyStore().part);
const solo = series('solo-insert', unobserved, (round) => [
  { op: 'insertText', paragraphId: soloTarget.id, offset: round, text: 'X' },
]);

const ydoc = new Y.Doc();
const awareness = new Awareness(ydoc);
const room = await createDocumentCollaboration({
  ydoc,
  awareness,
  documentId: 'bench-replica',
  identity: { actorId: 'alice', name: 'alice' },
  bootstrap: { kind: 'create', document: bytes },
});
const replicaStore = new TreePackageStore(pkg, part);
const replicaPort = createCollaborationDocumentPort(replicaStore, { documentId: 'bench-replica' });
const detach = room.session.attach(replicaPort);
const liveTarget = middleParagraph(replicaStore.bodyStore().part);
const liveText = () => paragraphTextOf(replicaStore.bodyStore().part, liveTarget.id) ?? '';

const attachedInsert = series(
  'attached-insert',
  replicaStore,
  () => [{ op: 'insertText', paragraphId: liveTarget.id, offset: 0, text: 'X' }],
  ydoc,
  () => replicaPort.flushPendingJournals()
);

const attachedBackspace = series(
  'attached-backspace',
  replicaStore,
  () => {
    const length = liveText().length;
    return [{ op: 'deleteText', paragraphId: liveTarget.id, start: Math.max(0, length - 1), end: length }];
  },
  ydoc,
  () => replicaPort.flushPendingJournals()
);

const attachedTypeover = series(
  'attached-typeover',
  replicaStore,
  () => {
    const length = liveText().length;
    return [
      { op: 'deleteText', paragraphId: liveTarget.id, start: 0, end: length },
      { op: 'insertText', paragraphId: liveTarget.id, offset: 0, text: 'X' },
    ];
  },
  ydoc,
  () => replicaPort.flushPendingJournals()
);

const attachedBold = series(
  'attached-bold',
  replicaStore,
  () => [
    {
      op: 'setRunProperties',
      paragraphId: liveTarget.id,
      start: 0,
      end: Math.min(80, liveText().length),
      properties: [{ localName: 'b' }],
    },
  ],
  ydoc,
  () => replicaPort.flushPendingJournals()
);

const tableId = cellParagraphId(replicaStore.bodyStore().part.root);
if (tableId) {
  series(
    'attached-table-cell',
    replicaStore,
    () => [{ op: 'insertText', paragraphId: tableId, offset: 0, text: 'X' }],
    ydoc,
    () => replicaPort.flushPendingJournals()
  );
} else {
  console.log(JSON.stringify({ label: 'attached-table-cell', skipped: 'fixture has no table cell' }));
}

const bobDoc = new Y.Doc();
const bobAwareness = new Awareness(bobDoc);
Y.applyUpdate(bobDoc, Y.encodeStateAsUpdate(ydoc), 'join');
const bobRoom = await createDocumentCollaboration({
  ydoc: bobDoc,
  awareness: bobAwareness,
  documentId: 'bench-replica',
  identity: { actorId: 'bob', name: 'bob' },
  bootstrap: { kind: 'join', timeoutMs: 30_000 },
});
const bobStore = new TreePackageStore(pkg, part);
const bobPort = createCollaborationDocumentPort(bobStore, { documentId: 'bench-replica' });
const bobDetach = bobRoom.session.attach(bobPort);
bobDoc.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin === 'relay') return;
  Y.applyUpdate(ydoc, update, 'relay');
});
ydoc.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin === 'relay') return;
  Y.applyUpdate(bobDoc, update, 'relay');
});
const bobTarget = middleParagraph(bobStore.bodyStore().part);
const peerLoaded = series(
  'attached-insert-peer-editing',
  replicaStore,
  () => [{ op: 'insertText', paragraphId: liveTarget.id, offset: 0, text: 'X' }],
  ydoc,
  () => {
    replicaPort.flushPendingJournals();
    bobStore.transact(BODY, (context) => {
      context.apply({ op: 'insertText', paragraphId: bobTarget.id, offset: 0, text: 'B' });
    });
    bobPort.flushPendingJournals();
  }
);

const startNodes = ydoc.getMap(PACKAGE_NODES_KEY).size;
const startAwareness = awareness.getStates().size;
const pendingPeak: number[] = [];
for (let round = 0; round < LEAK_EDITS; round += 1) {
  const sample = applyOps(
    replicaStore,
    [{ op: 'insertText', paragraphId: liveTarget.id, offset: 0, text: 'x' }],
    ydoc,
    () => replicaPort.flushPendingJournals()
  );
  pendingPeak.push(sample.pending);
  room.session.setLocalSelection({
    anchor: { paragraphId: '4A7E6EC2', offset: 0 },
    head: { paragraphId: '4A7E6EC2', offset: 0 },
  });
}
replicaPort.flushPendingJournals();
const leak = {
  edits: LEAK_EDITS,
  pendingAfterIdle: pendingCanonicalJournalCount(replicaStore),
  peakPending: Math.max(...pendingPeak),
  nodeDelta: ydoc.getMap(PACKAGE_NODES_KEY).size - startNodes,
  awarenessStart: startAwareness,
  awarenessEnd: awareness.getStates().size,
};
console.log(JSON.stringify({ label: 'leak', ...leak }));

const insertPass =
  attachedInsert.yUpdates > 0 &&
  attachedInsert.peakPending === 0 &&
  attachedInsert.transact.medianMs <= TRANSACTION_MEDIAN_MAX_MS &&
  attachedInsert.transact.p95Ms <= TRANSACTION_P95_MAX_MS &&
  attachedInsert.transact.medianMs <= solo.transact.medianMs * 2 + 2 &&
  attachedInsert.transact.p95Ms <= solo.transact.p95Ms * 2 + 2;

console.log(
  JSON.stringify({
    label: 'verdict',
    insertPass,
    soloInsert: solo.transact,
    attachedInsert: attachedInsert.transact,
    attachedFlush: attachedInsert.flush,
    peerLoadedTransact: peerLoaded.transact,
    budgets: {
      transactionMedianMaxMs: TRANSACTION_MEDIAN_MAX_MS,
      transactionP95MaxMs: TRANSACTION_P95_MAX_MS,
      ratio: 2,
      pendingJournalsAfterLocalTransactMustBe: 0,
    },
    leak,
  })
);

bobDetach();
bobRoom.destroy();
bobAwareness.destroy();
bobDoc.destroy();
detach();
room.destroy();
awareness.destroy();
ydoc.destroy();

void attachedBackspace;
void attachedTypeover;
void attachedBold;
