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
//
// The two arms must measure the same gesture on the same shape, in the same time window, or
// the ratio reports the difference between the arms rather than the cost of attaching. Four
// rules keep them comparable, and all four are load-bearing:
//   1. The attached arm holds ONE replica. The harness relays a paired peer's updates
//      synchronously, so a second peer's whole inbound apply lands inside the timed
//      transact. That is a harness artifact — a real peer is another process — and it
//      measured 3.6x solo where a lone replica measures 1.28x.
//   2. Both arms insert at the end of the same paragraph. Inserting at offset 0 costs
//      about 1.5x inserting at the end, which alone moves the ratio.
//   3. `gateOperations` sits outside the timed span. A detached store cannot call it at
//      all, so timing it charges the attached arm for work the solo arm can never do.
//   4. The arms are sampled in alternating contiguous blocks, and the gate compares the
//      fastest round of temporally PAIRED blocks — see `measureInterleaved`. A per-arm
//      minimum over back-to-back arms is not enough: each arm's whole sampling window is
//      only ~10-30 ms, so one load spike covering one arm inflates every round of that
//      arm, minimum included. CI run #1167 read 2.71x that way on a 1.28x path.

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
// The gated ratio interleaves the arms in blocks: BLOCKS blocks of BLOCK_ROUNDS rounds per
// arm, solo then attached within each block, BLOCKS * BLOCK_ROUNDS = RUNS rounds per arm.
const BLOCKS = 5;
const BLOCK_ROUNDS = 8;
const LEAK_EDITS = 400;
const LONG_TEXT = 'abcdefghijklmnopqrstuvwxyz '.repeat(12);
const BUDGET_RATIO = 2;

function summarize(values: readonly number[]): {
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
} {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return {
    minMs: sorted[0] ?? 0,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

function ratioPass(blockRatios: readonly number[]): boolean {
  // A pure ratio, with no flat slack, over the best temporally paired block.
  //
  // The ratio has to carry the gate by itself, because this file shares a runner with the rest
  // of its shard: a flat slack added to a sub-millisecond baseline is an ABSOLUTE wall-clock
  // budget wearing a ratio's clothes, and an absolute budget is a different test on every
  // machine. The old +1 ms median slack admitted about 11x a solo transact, far above the
  // regression it was written to catch — the O(document) capture cost, which moved the figure
  // ~5x.
  //
  // Within a block, the minimum is the estimator because contention noise is one-sided: a
  // preempted or GC-interrupted round can only read HIGH, never low, so the fastest round is
  // the closest each arm gets to its own cost. Across blocks, the gate takes the LOWEST block
  // ratio: a spike that lands on one block's attached rounds inflates that block's ratio, and
  // some other block, milliseconds away, pairs two quiet windows. A block ratio can only read
  // spuriously LOW when a spike lands on its solo rounds alone, which loosens the gate near
  // the 2x line but cannot hide the ~5x regression it exists to catch — a real O(document)
  // cost inflates the attached rounds of EVERY block. Tail statistics stay ungated for the
  // same reason as before: the p95 of sub-millisecond samples measures GC and scheduler
  // pauses (21.5x observed at 16-way contention on a 1.2x path). All rounds stay in the
  // logged summaries for diagnosis.
  return Math.min(...blockRatios) <= BUDGET_RATIO;
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
  const refusal = peer.room.session.gateOperations(ops, BODY);
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  peer.ydoc.on('update', onUpdate);
  const transactStarted = performance.now();
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
  // Rule 1 above: keep the second replica only for the gesture that types on it. Everywhere
  // else the relay would apply alice's update into bob inside alice's timed transact.
  if (options?.peerEdits !== true) harness.leave(bob);
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
  const { alice, bob } = await harness.pair(bytes);
  harness.leave(bob);
  alice.detach();
  return alice;
}

function insertAtEnd(peer: Peer): readonly TreeDocOp[] {
  const target = firstTextParagraph(peer);
  return [{ op: 'insertText', paragraphId: target.id, offset: target.length, text: 'X' }];
}

/**
 * Sample the two arms in alternating contiguous blocks and pair each block's fastest rounds.
 *
 * Rule 4: sampling one whole arm after the other looks clean and is the flake. Each arm's 40
 * rounds span only ~10-30 ms, so machine load drifts BETWEEN the arms — this file shares a
 * worker pool with the rest of its shard — and a spike that covers one arm's whole window
 * inflates every round of that arm, minimum included. Over 128 runs at 16-way contention,
 * drift alone produced a 2.25x median reading on a path that costs 1.29x; after the gate
 * moved to per-arm minimums, CI run #1167 still read 2.71x min-vs-min the same way.
 *
 * Alternating the arms round by round is not the fix either: at this scale each arm evicts
 * the other's working set, which cost the attached arm a flat ~0.09 ms and pushed the ratio
 * from 1.19x to 1.91x. Blocks give both properties at once. Within a block the rounds are
 * contiguous, so the cold first round after a switch reads high and the block minimum ignores
 * it — noise is one-sided. Across blocks both arms sample every time window, so `ratioPass`
 * can compare minimums that saw the same load.
 */
function measureInterleaved(
  soloRound: () => number,
  attachedRound: () => number
): {
  readonly solo: ReturnType<typeof summarize>;
  readonly attached: ReturnType<typeof summarize>;
  readonly blockRatios: readonly number[];
} {
  for (let round = 0; round < WARMUP; round += 1) {
    soloRound();
    attachedRound();
  }
  const soloTimes: number[] = [];
  const attachedTimes: number[] = [];
  const blockRatios: number[] = [];
  for (let block = 0; block < BLOCKS; block += 1) {
    const soloBlock: number[] = [];
    const attachedBlock: number[] = [];
    for (let round = 0; round < BLOCK_ROUNDS; round += 1) soloBlock.push(soloRound());
    for (let round = 0; round < BLOCK_ROUNDS; round += 1) attachedBlock.push(attachedRound());
    soloTimes.push(...soloBlock);
    attachedTimes.push(...attachedBlock);
    blockRatios.push(Math.min(...attachedBlock) / Math.min(...soloBlock));
  }
  return {
    solo: summarize(soloTimes),
    attached: summarize(attachedTimes),
    blockRatios,
  };
}

async function measureInsertRatio(bytes: Uint8Array): Promise<{
  readonly solo: ReturnType<typeof summarize>;
  readonly attached: ReturnType<typeof summarize>;
  readonly blockRatios: readonly number[];
}> {
  harness.cleanup();
  // Order matters: the harness relays each JOINING peer to every peer already open, so the
  // attached pair must be built after the solo peer is detached and its partner has left.
  // Neither `alice` is ever a join, so the two arms are never relayed to each other.
  const soloPeer = await soloStore(bytes);
  const attachedPair = await harness.pair(bytes);
  harness.leave(attachedPair.bob);
  const attachedPeer = attachedPair.alice;
  return measureInterleaved(
    () => {
      const soloOps = insertAtEnd(soloPeer);
      const started = performance.now();
      const result = soloPeer.store.transact(BODY, (context) => {
        for (const op of soloOps) context.apply(op);
      });
      const ms = performance.now() - started;
      if (!result.ok) throw new Error(result.detail ?? result.reason);
      return ms;
    },
    () => runOps(attachedPeer, insertAtEnd(attachedPeer)).transactMs
  );
}

describe('local keystroke path with a replica attached', () => {
  test('transact replicates on the commit and stays within 2x solo', async () => {
    const bytes = proseBytes();
    // The gated comparison: one solo arm against one lone attached replica, same gesture.
    // The gesture sweep below re-measures `insert-text` for its row, but only this pair
    // decides the ratio.
    const { solo, attached: insertAttached, blockRatios } = await measureInsertRatio(bytes);

    const gestures: readonly {
      readonly name: string;
      readonly bytes: Uint8Array;
      readonly peerEdits?: boolean;
      readonly gesture: (peer: Peer, round: number) => readonly TreeDocOp[];
    }[] = [
      {
        name: 'insert-text',
        bytes,
        gesture: (peer) => insertAtEnd(peer),
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
        gesture: (peer) => insertAtEnd(peer),
      },
    ];

    const rows: string[] = [];
    const stranded: string[] = [];
    const silent: string[] = [];
    for (const item of gestures) {
      const measured = await measure(item.bytes, item.gesture, {
        peerEdits: item.peerEdits === true,
      });
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
        blockRatios,
        ratioPass: ratioPass(blockRatios),
        rows,
      })
    );
    // No gesture may leave a journal waiting, and every gesture must reach Yjs on its commit.
    expect(stranded).toEqual([]);
    expect(silent).toEqual([]);
    expect(ratioPass(blockRatios)).toBe(true);
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
      // Rule 2 above: end-of-paragraph inserts, the same gesture the attached arm runs.
      const soloLength = paragraphTextOf(soloStore.bodyStore().part, soloId)?.length ?? 0;

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
      const flush: number[] = [];
      let yUpdatesDuringTransact = 0;
      let soloRoundIndex = 0;
      let attachedRoundIndex = 0;
      const { solo, attached, blockRatios } = measureInterleaved(
        () => {
          const offset = soloLength + soloRoundIndex;
          soloRoundIndex += 1;
          const started = performance.now();
          const result = soloStore.transact(BODY, (context) => {
            context.apply({ op: 'insertText', paragraphId: soloId, offset, text: 'X' });
          });
          const ms = performance.now() - started;
          if (!result.ok) throw new Error(result.detail ?? result.reason);
          return ms;
        },
        () => {
          const offset = live.length + attachedRoundIndex;
          attachedRoundIndex += 1;
          const sample = runOps(replicaPeer, [
            { op: 'insertText', paragraphId: live.id, offset, text: 'X' },
          ]);
          yUpdatesDuringTransact += sample.yUpdatesDuringTransact;
          flush.push(sample.flushMs);
          return sample.transactMs;
        }
      );
      const attachedFlush = summarize(flush);
      // The ratio is the gate, and the absolute number is only a backstop.
      //
      // This number was measured when lowering copied every id in the part into a Set on each
      // primitive, which cost O(document) per keystroke — 34,555 string hashes on this
      // fixture. Attached now runs at about 1.2x solo, so 18.6 ms would let a 10x regression
      // through unnoticed. The ratio rule scales with the machine instead, which matters
      // because this file shares a CI runner with the rest of its shard: an absolute budget
      // silently becomes a different test on slower hardware.
      //
      // Only the fastest round gets a backstop, for the same reason the ratio uses it. The p95
      // backstop was an absolute wall-clock wall over a statistic that measures GC pauses.
      const TRANSACTION_MIN_MAX_MS = 18.612418000000616;
      console.log(
        JSON.stringify({
          fixture: 'synthetic-long-edit.docx',
          solo,
          attached,
          attachedFlush,
          yUpdatesDuringTransact,
          blockRatios,
          ratioPass: ratioPass(blockRatios),
          minBackstopMs: TRANSACTION_MIN_MAX_MS,
        })
      );
      expect(yUpdatesDuringTransact).toBeGreaterThan(0);
      expect(ratioPass(blockRatios)).toBe(true);
      expect(attached.minMs).toBeLessThanOrEqual(TRANSACTION_MIN_MAX_MS);
      detach();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
    { timeout: 120_000 }
  );
});
