/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Local keystroke cost with and without an attached replica.
//
// Timings are hardware-sensitive. The hard gates are: the publish queue is empty the moment
// transact returns, the Yjs write happens on that same commit, and awareness and registry
// growth stay bounded.
//
// A journal carries absolute positions against the tree its transaction was diffed against.
// A queue depth above zero is therefore a correctness gate, not a throughput one: the next
// remote update moves that tree, and the stale position stays in bounds. `transactMs` below
// includes the Yjs write for exactly that reason, and is what the recorded transact budget
// is compared against.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pendingCanonicalJournalCount } from '../../../../core/src/store/package/canonical-primitive-publish.ts';
import {
  normalizeParagraphIdentity,
  paragraphTextOf,
  readOoxmlPackage,
  TreePackageStore,
  type OoxmlNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { PACKAGE_NODES_KEY } from '../document/index.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration';
import {
  BODY,
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const WARMUP = 2;
const RUNS = 40;
const LEAK_EDITS = 400;
const LONG_TEXT = 'abcdefghijklmnopqrstuvwxyz '.repeat(12);
const BUDGET_RATIO = 2;

function summarize(values: readonly number[]): {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
} {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return { medianMs: at(0.5), p95Ms: at(0.95), maxMs: sorted[sorted.length - 1] ?? 0 };
}

function ratioPass(
  solo: { readonly medianMs: number; readonly p95Ms: number },
  attached: { readonly medianMs: number; readonly p95Ms: number }
): boolean {
  const slack = 2;
  return (
    attached.medianMs <= Math.max(solo.medianMs * BUDGET_RATIO, solo.medianMs + slack) &&
    attached.p95Ms <= Math.max(solo.p95Ms * BUDGET_RATIO, solo.p95Ms + slack)
  );
}

const harness = createPeerHarness('keystroke-perf');

afterEach(() => {
  harness.cleanup();
});

function proseBytes(): Uint8Array {
  const body =
    `<w:p><w:r><w:t xml:space="preserve">${LONG_TEXT}</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">${LONG_TEXT}</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">${LONG_TEXT}</w:t></w:r></w:p>` +
    '<w:sectPr/>';
  return zipDocument(body);
}

function tableBytes(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr/><w:p><w:r><w:t>other</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr/>'
  );
}

function paragraphIds(peer: Peer): string[] {
  const ids: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') ids.push(node.id);
  });
  return ids;
}

function paragraphAt(peer: Peer, index: number): { readonly id: string; readonly length: number } {
  const id = paragraphIds(peer)[index];
  if (!id) throw new Error(`no paragraph at ${index}`);
  const text = paragraphTextOf(peer.store.bodyStore().part, id) ?? nodeText(find(peer, id));
  return { id, length: text.length };
}

function firstTextParagraph(peer: Peer): { readonly id: string; readonly length: number } {
  return paragraphAt(peer, 0);
}

function find(peer: Peer, id: string): OoxmlNode {
  let found: OoxmlNode | undefined;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.id === id) found = node;
  });
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function cellParagraph(peer: Peer): string {
  let cell: string | undefined;
  const visit = (node: OoxmlNode, inCell: boolean): void => {
    if (node.kind === 'textValue') return;
    const next = inCell || node.localName === 'tc';
    if (next && node.kind === 'paragraph' && !cell) cell = node.id;
    for (const child of node.children) visit(child, next);
  };
  visit(peer.store.bodyStore().part.root, false);
  if (!cell) throw new Error('no cell paragraph');
  return cell;
}

interface Sample {
  readonly transactMs: number;
  readonly flushMs: number;
  readonly yUpdatesDuringTransact: number;
  readonly pendingAfterTransact: number;
}

function runOps(peer: Peer, ops: readonly TreeDocOp[]): Sample {
  let yUpdatesDuringTransact = 0;
  const onUpdate = (): void => {
    yUpdatesDuringTransact += 1;
  };
  peer.ydoc.on('update', onUpdate);
  const transactStarted = performance.now();
  const refusal = peer.room.session.gateOperations(ops, BODY);
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  const result = peer.store.transact(BODY, (context) => {
    for (const op of ops) context.apply(op);
  });
  const transactMs = performance.now() - transactStarted;
  peer.ydoc.off('update', onUpdate);
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  const pendingAfterTransact = pendingCanonicalJournalCount(peer.store);
  const flushStarted = performance.now();
  peer.port.flushPendingJournals();
  const flushMs = performance.now() - flushStarted;
  return { transactMs, flushMs, yUpdatesDuringTransact, pendingAfterTransact };
}

async function measure(
  bytes: Uint8Array,
  gesture: (peer: Peer, round: number) => readonly TreeDocOp[],
  options?: { readonly peerEdits: boolean }
): Promise<{
  readonly transact: ReturnType<typeof summarize>;
  readonly flush: ReturnType<typeof summarize>;
  readonly yUpdatesDuringTransact: number;
  readonly peakPending: number;
}> {
  harness.cleanup();
  const { alice, bob } = await harness.pair(bytes);
  const transact: number[] = [];
  const flush: number[] = [];
  let yUpdatesDuringTransact = 0;
  let peakPending = 0;
  const bobParagraph = firstTextParagraph(bob);
  for (let round = 0; round < WARMUP + RUNS; round += 1) {
    const sample = runOps(alice, gesture(alice, round));
    yUpdatesDuringTransact += sample.yUpdatesDuringTransact;
    peakPending = Math.max(peakPending, sample.pendingAfterTransact);
    if (options?.peerEdits) {
      runOps(bob, [
        {
          op: 'insertText',
          paragraphId: bobParagraph.id,
          offset: Math.min(round, bobParagraph.length),
          text: 'B',
        },
      ]);
    }
    if (round >= WARMUP) {
      transact.push(sample.transactMs);
      flush.push(sample.flushMs);
    }
  }
  return {
    transact: summarize(transact),
    flush: summarize(flush),
    yUpdatesDuringTransact,
    peakPending,
  };
}

async function soloStore(bytes: Uint8Array) {
  const { alice } = await harness.pair(bytes);
  alice.detach();
  return alice;
}

describe('local keystroke path with a replica attached', () => {
  test('transact replicates on the commit and stays within 2x solo', async () => {
    const bytes = proseBytes();
    harness.cleanup();
    const soloPeer = await soloStore(bytes);
    const insertAt = firstTextParagraph(soloPeer);
    const soloTimes: number[] = [];
    for (let round = 0; round < WARMUP + RUNS; round += 1) {
      const started = performance.now();
      const result = soloPeer.store.transact(BODY, (context) => {
        context.apply({
          op: 'insertText',
          paragraphId: insertAt.id,
          offset: 0,
          text: 'X',
        });
      });
      const ms = performance.now() - started;
      if (!result.ok) throw new Error(result.detail ?? result.reason);
      if (round >= WARMUP) soloTimes.push(ms);
    }
    const solo = summarize(soloTimes);

    const gestures: readonly {
      readonly name: string;
      readonly bytes: Uint8Array;
      readonly peerEdits?: boolean;
      readonly gesture: (peer: Peer, round: number) => readonly TreeDocOp[];
    }[] = [
      {
        name: 'insert-text',
        bytes,
        gesture: (peer) => {
          const target = firstTextParagraph(peer);
          return [{ op: 'insertText', paragraphId: target.id, offset: target.length, text: 'X' }];
        },
      },
      {
        name: 'backspace',
        bytes,
        gesture: (peer) => {
          const target = firstTextParagraph(peer);
          const end = Math.max(1, target.length);
          return [{ op: 'deleteText', paragraphId: target.id, start: end - 1, end }];
        },
      },
      {
        name: 'typeover-selection',
        bytes,
        gesture: (peer) => {
          const target = firstTextParagraph(peer);
          return [
            { op: 'deleteText', paragraphId: target.id, start: 0, end: target.length },
            { op: 'insertText', paragraphId: target.id, offset: 0, text: 'X' },
          ];
        },
      },
      {
        name: 'bold-selection',
        bytes,
        gesture: (peer) => {
          const target = firstTextParagraph(peer);
          return [
            {
              op: 'setRunProperties',
              paragraphId: target.id,
              start: 0,
              end: Math.min(80, target.length),
              properties: [{ localName: 'b' }],
            },
          ];
        },
      },
      {
        name: 'table-cell-insert',
        bytes: tableBytes(),
        gesture: (peer) => {
          const id = cellParagraph(peer);
          const length = paragraphTextOf(peer.store.bodyStore().part, id)?.length ?? 0;
          return [{ op: 'insertText', paragraphId: id, offset: length, text: 'X' }];
        },
      },
      {
        name: 'insert-while-peer-edits',
        bytes,
        peerEdits: true,
        gesture: (peer) => {
          const target = firstTextParagraph(peer);
          return [{ op: 'insertText', paragraphId: target.id, offset: target.length, text: 'X' }];
        },
      },
    ];

    const rows: string[] = [];
    const stranded: string[] = [];
    const silent: string[] = [];
    let insertAttached = solo;
    for (const item of gestures) {
      const measured = await measure(item.bytes, item.gesture, {
        peerEdits: item.peerEdits === true,
      });
      if (item.name === 'insert-text') insertAttached = measured.transact;
      if (measured.peakPending !== 0) stranded.push(item.name);
      if (measured.yUpdatesDuringTransact === 0) silent.push(item.name);
      rows.push(
        [
          item.name,
          measured.transact.medianMs.toFixed(3),
          measured.transact.p95Ms.toFixed(3),
          measured.transact.maxMs.toFixed(3),
          measured.flush.medianMs.toFixed(3),
          measured.flush.p95Ms.toFixed(3),
          String(measured.peakPending),
        ].join('\t')
      );
    }

    // Log before the gates: a gate that fails without its measurement is not diagnosable.
    console.log(
      JSON.stringify({
        soloInsert: solo,
        attachedInsert: insertAttached,
        ratioPass: ratioPass(solo, insertAttached),
        rows,
      })
    );
    // No gesture may leave a journal waiting, and every gesture must reach Yjs on its commit.
    expect(stranded).toEqual([]);
    expect(silent).toEqual([]);
    expect(ratioPass(solo, insertAttached)).toBe(true);
    expect(rows.length).toBe(gestures.length);
  });

  test('pending journals, registry nodes, and awareness stay bounded', async () => {
    const { alice } = await harness.pair(proseBytes());
    const nodes = () => alice.ydoc.getMap(PACKAGE_NODES_KEY).size;
    const startNodes = nodes();
    const startAwareness = alice.awareness.getStates().size;
    const pendingSamples: number[] = [];
    let yUpdates = 0;
    for (let edit = 0; edit < LEAK_EDITS; edit += 1) {
      const live = firstTextParagraph(alice);
      const sample = runOps(alice, [
        { op: 'insertText', paragraphId: live.id, offset: live.length, text: 'x' },
      ]);
      yUpdates += sample.yUpdatesDuringTransact;
      pendingSamples.push(sample.pendingAfterTransact);
      alice.room.session.setLocalSelection({
        anchor: { paragraphId: '00000001', offset: 0 },
        head: { paragraphId: '00000001', offset: 0 },
      });
    }
    await Promise.resolve();
    alice.port.flushPendingJournals();
    const nodeDelta = nodes() - startNodes;
    console.log(
      JSON.stringify({
        leak: {
          edits: LEAK_EDITS,
          pendingAfterIdle: pendingCanonicalJournalCount(alice.store),
          peakPending: Math.max(...pendingSamples),
          yUpdatesDuringTransact: yUpdates,
          nodeDelta,
          awarenessStart: startAwareness,
          awarenessEnd: alice.awareness.getStates().size,
        },
      })
    );
    expect(pendingCanonicalJournalCount(alice.store)).toBe(0);
    expect(alice.awareness.getStates().size).toBe(startAwareness);
    expect(Math.max(...pendingSamples)).toBe(0);
    expect(yUpdates).toBe(LEAK_EDITS);
    expect(nodeDelta).toBeLessThan(LEAK_EDITS * 4);
  });

  test(
    '200-page fixture insert stays within 2x solo',
    async () => {
      const fixture = resolve(
        import.meta.dir,
        '../../../../../e2e/fixtures/synthetic-long-edit.docx'
      );
      const bytes = new Uint8Array(readFileSync(fixture));
      const loaded = readOoxmlPackage(bytes);
      if (!loaded.ok) throw new Error(loaded.reason);
      const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
      if (!main) throw new Error('no main');
      const soloStore = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
      const visit = (node: OoxmlNode, ids: string[]): void => {
        if (node.kind === 'paragraph') ids.push(node.id);
        if (node.kind === 'textValue') return;
        for (const child of node.children) visit(child, ids);
      };
      const soloIds: string[] = [];
      visit(soloStore.bodyStore().part.root, soloIds);
      const soloId = soloIds[Math.floor((soloIds.length - 1) * 0.5)];
      if (!soloId) throw new Error('no middle paragraph');
      const soloTimes: number[] = [];
      for (let round = 0; round < WARMUP + RUNS; round += 1) {
        const started = performance.now();
        const result = soloStore.transact(BODY, (context) => {
          context.apply({ op: 'insertText', paragraphId: soloId, offset: 0, text: 'X' });
        });
        const ms = performance.now() - started;
        if (!result.ok) throw new Error(result.detail ?? result.reason);
        if (round >= WARMUP) soloTimes.push(ms);
      }
      const solo = summarize(soloTimes);

      const ydoc = new Y.Doc();
      const awareness = new Awareness(ydoc);
      const room = await createDocumentCollaboration({
        ydoc,
        awareness,
        documentId: 'keystroke-perf',
        identity: { actorId: 'alice', name: 'alice' },
        bootstrap: { kind: 'create', document: bytes },
      });
      const seeded = readOoxmlPackage(room.document);
      if (!seeded.ok) throw new Error(seeded.reason);
      const seededMain = seeded.package.parts.get(seeded.package.mainDocumentPart);
      if (!seededMain) throw new Error('no main');
      const replicaStore = new TreePackageStore(
        seeded.package,
        normalizeParagraphIdentity(seededMain)
      );
      const replicaPort = createCollaborationDocumentPort(replicaStore, {
        documentId: 'keystroke-perf',
      });
      const detach = room.session.attach(replicaPort);
      const replicaPeer = {
        ydoc,
        awareness,
        room,
        store: replicaStore,
        port: replicaPort,
        detach,
      } as Peer;
      const ids = paragraphIds(replicaPeer);
      const live = paragraphAt(replicaPeer, Math.floor((ids.length - 1) * 0.5));
      const transact: number[] = [];
      const flush: number[] = [];
      let yUpdatesDuringTransact = 0;
      for (let round = 0; round < WARMUP + RUNS; round += 1) {
        const sample = runOps(replicaPeer, [
          { op: 'insertText', paragraphId: live.id, offset: live.length + round, text: 'X' },
        ]);
        yUpdatesDuringTransact += sample.yUpdatesDuringTransact;
        if (round >= WARMUP) {
          transact.push(sample.transactMs);
          flush.push(sample.flushMs);
        }
      }
      const attached = summarize(transact);
      const attachedFlush = summarize(flush);
      // The ratio is the gate, and the absolute pair is only a backstop.
      //
      // These absolute numbers were measured when lowering copied every id in the part into a
      // Set on each primitive, which cost O(document) per keystroke — 34,555 string hashes on
      // this fixture. Attached now runs at about 1.2x solo, so 18.6 ms would let a 10x
      // regression through unnoticed. The ratio rule scales with the machine instead, which
      // matters because this file shares a CI runner with the rest of its shard: an absolute
      // budget silently becomes a different test on slower hardware.
      const TRANSACTION_MEDIAN_MAX_MS = 18.612418000000616;
      const TRANSACTION_P95_MAX_MS = 21.630750000000262;
      console.log(
        JSON.stringify({
          fixture: 'synthetic-long-edit.docx',
          solo,
          attached,
          attachedFlush,
          yUpdatesDuringTransact,
          ratioPass: ratioPass(solo, attached),
          medianBackstopMs: TRANSACTION_MEDIAN_MAX_MS,
          p95BackstopMs: TRANSACTION_P95_MAX_MS,
        })
      );
      expect(yUpdatesDuringTransact).toBeGreaterThan(0);
      expect(ratioPass(solo, attached)).toBe(true);
      expect(attached.medianMs).toBeLessThanOrEqual(TRANSACTION_MEDIAN_MAX_MS);
      expect(attached.p95Ms).toBeLessThanOrEqual(TRANSACTION_P95_MAX_MS);
      detach();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
    { timeout: 120_000 }
  );
});
