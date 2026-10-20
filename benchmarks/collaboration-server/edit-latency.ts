// Edit latency for two collaborating replicas, per edit kind.
//
// For each edit it measures three numbers in milliseconds:
//
//   solo     the same edit on a store with no collaboration attached
//   local    the edit on a collaborating replica, through publish of its Yjs update
//   remote   the other replica applying that update, through install in its store
//
// `local - solo` is what collaboration adds to the author's keystroke, and `local + remote`
// is the lag a participant sees, less the network. The update size is the bytes sent.
//
//   bun edit-latency.ts [--document path] [--rounds 40] [--warmup 5] [--only 'Enter,type a']
//                       [--sources 200]
//
// `--sources N` first deletes the last character of N other paragraphs and types after it,
// as a long session leaves paragraphs: text typed after deleted text can follow a move, so
// each such paragraph is one more the replicas track.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import {
  paragraphTextOf,
  type OoxmlNode,
  type StoryScope,
  type TreeDocOp,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import { storeFrom } from './document-text.ts';
import { NETWORK, openReplica, type Replica } from './scenario-replica.ts';
import { fingerprint } from './scenario-oracles.ts';

const BODY: StoryScope = { kind: 'body' };

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

const documentPath = path.resolve(
  option('document', path.join(import.meta.dirname, '../../examples/vite/public/sample.docx'))
);
const rounds = Number(option('rounds', '40'));
const warmup = Number(option('warmup', '5'));
const only = option('only', '');
const sources = Number(option('sources', '0'));

function bodyParagraphs(store: TreePackageStore): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      ids.push(node.id);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  return ids;
}

function lengthOf(store: TreePackageStore, id: string): number {
  return paragraphTextOf(store.bodyStore().part, id)?.length ?? 0;
}

/** The longest body paragraph near the middle: every edit kind has room in it. */
function target(store: TreePackageStore): string {
  const ids = bodyParagraphs(store);
  const middle = Math.floor(ids.length / 2);
  let best = ids[middle]!;
  for (let at = Math.max(0, middle - 20); at < Math.min(ids.length, middle + 20); at += 1) {
    if (lengthOf(store, ids[at]!) > lengthOf(store, best)) best = ids[at]!;
  }
  return best;
}

/** The paragraph after `id` in the body, after a split. */
function following(store: TreePackageStore, id: string): string {
  const ids = bodyParagraphs(store);
  const next = ids[ids.indexOf(id) + 1];
  if (!next) throw new Error('no paragraph after the split');
  return next;
}

/** One edit: the ops for a store, given the target paragraph and its length. */
interface EditKind {
  readonly name: string;
  readonly ops: (store: TreePackageStore, id: string, length: number) => readonly object[];
  /** Ops that take the edit back, untimed, so every sample starts from the same paragraph. */
  readonly restore?: (id: string, lengthBefore: number) => readonly object[];
}

const alignments = new WeakMap<TreePackageStore, number>();
const bolds = new WeakMap<TreePackageStore, number>();

/** True on every other call for one store, starting with the first. */
function alternate(counts: WeakMap<TreePackageStore, number>, store: TreePackageStore): boolean {
  const count = (counts.get(store) ?? 0) + 1;
  counts.set(store, count);
  return count % 2 === 1;
}

const PASTE = 'The quick brown fox jumps over the lazy dog. '.repeat(6);

const EDITS: readonly EditKind[] = [
  {
    name: 'type a character',
    ops: (_store, id, length) => [{ op: 'insertText', paragraphId: id, offset: length, text: 'X' }],
  },
  {
    name: 'type mid-paragraph',
    ops: (_store, id, length) => [
      { op: 'insertText', paragraphId: id, offset: Math.floor(length / 2), text: 'Y' },
    ],
  },
  {
    name: 'delete a word',
    ops: (_store, id, length) => [
      { op: 'deleteText', paragraphId: id, start: length - 4, end: length - 1 },
    ],
  },
  {
    name: 'bold a word',
    // Alternate bold and plain, or every round after the first changes nothing.
    ops: (store, id, length) => [
      {
        op: 'setRunProperties',
        paragraphId: id,
        start: Math.floor(length / 3),
        end: Math.floor(length / 3) + 5,
        properties: alternate(bolds, store) ? [{ localName: 'b' }] : [],
      },
    ],
  },
  {
    name: 'Enter',
    ops: (_store, id, length) => [
      { op: 'splitParagraph', paragraphId: id, offset: Math.floor(length / 2) },
    ],
  },
  {
    name: 'Backspace join',
    ops: (store, id) => [{ op: 'joinParagraphs', firstId: id, secondId: following(store, id) }],
  },
  {
    name: 'paste 270 characters',
    ops: (_store, id, length) => [
      { op: 'insertText', paragraphId: id, offset: Math.floor(length / 2), text: PASTE },
    ],
    restore: (id, length) => [
      {
        op: 'deleteText',
        paragraphId: id,
        start: Math.floor(length / 2),
        end: Math.floor(length / 2) + PASTE.length,
      },
    ],
  },
  {
    name: 'align a paragraph',
    ops: (store, id) => {
      // Alternate the value, or every round after the first changes nothing.
      const centered = !alternate(alignments, store);
      return [
        {
          op: 'setParagraphProperties',
          paragraphId: id,
          properties: [{ localName: 'jc', attributes: { val: centered ? 'center' : 'right' } }],
        },
      ];
    },
  },
];

function apply(store: TreePackageStore, ops: readonly object[]): void {
  const result = store.transact(BODY, (context) => {
    for (const op of ops) context.apply(op as TreeDocOp);
  });
  if (!result.ok) throw new Error(`${result.reason} ${result.detail ?? ''}`);
}

interface Samples {
  solo: number[];
  local: number[];
  remote: number[];
  bytes: number[];
}

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

async function main(): Promise<void> {
  const bytes = new Uint8Array(readFileSync(documentPath));
  const solo = storeFrom(bytes);
  const author: Replica = await openReplica(0, 'latency', { kind: 'create', document: bytes });
  const reader: Replica = await openReplica(1, 'latency', { kind: 'join', from: author.ydoc });
  const outgoing: Uint8Array[] = [];
  author.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== NETWORK) outgoing.push(update);
  });

  const soloId = target(solo);
  const authorId = target(author.store);
  let made = 0;
  for (const id of bodyParagraphs(author.store)) {
    if (made >= sources) break;
    const length = lengthOf(author.store, id);
    if (id === authorId || length < 2) continue;
    apply(author.store, [{ op: 'deleteText', paragraphId: id, start: length - 1, end: length }]);
    apply(author.store, [{ op: 'insertText', paragraphId: id, offset: length - 1, text: 'z' }]);
    made += 1;
  }
  if (made < sources) console.log(`only ${made} paragraphs could become sources`);
  for (const update of outgoing.splice(0)) Y.applyUpdate(reader.ydoc, update, NETWORK);
  const samples = new Map<string, Samples>(
    EDITS.map((edit) => [edit.name, { solo: [], local: [], remote: [], bytes: [] }])
  );
  const wanted = only === '' ? [] : only.split(',');
  const kinds = EDITS.filter(
    (edit) => wanted.length === 0 || wanted.some((prefix) => edit.name.startsWith(prefix))
  );
  const deliver = (): number => {
    const updates = outgoing.splice(0);
    for (const update of updates) Y.applyUpdate(reader.ydoc, update, NETWORK);
    return updates.reduce((sum, update) => sum + update.byteLength, 0);
  };
  const timeSolo = (edit: EditKind): number => {
    const ops = edit.ops(solo, soloId, lengthOf(solo, soloId));
    const started = performance.now();
    apply(solo, ops);
    return performance.now() - started;
  };
  // The editor gates each edit before it applies, so the gate is part of the local time.
  const timeLocal = (edit: EditKind): number => {
    const ops = edit.ops(author.store, authorId, lengthOf(author.store, authorId));
    const started = performance.now();
    const refusal = author.handle.session.gateOperations(ops as TreeDocOp[], BODY);
    if (refusal) throw new Error(`${edit.name}: refused ${refusal}`);
    apply(author.store, ops);
    return performance.now() - started;
  };
  // Warm-up rounds first: the first edits of each kind find cold caches on every side.
  for (let round = -warmup; round < rounds; round += 1) {
    // Collect garbage between rounds, so a sample pays for its own allocations only.
    Bun.gc(true);
    for (const edit of kinds) {
      const record = samples.get(edit.name)!;
      const soloBefore = lengthOf(solo, soloId);
      const authorBefore = lengthOf(author.store, authorId);
      // Alternate the order, so neither store always runs on the warmer cache.
      let soloMs: number;
      let localMs: number;
      if (round % 2 === 0) {
        soloMs = timeSolo(edit);
        localMs = timeLocal(edit);
      } else {
        localMs = timeLocal(edit);
        soloMs = timeSolo(edit);
      }
      const updates = outgoing.splice(0);
      const started = performance.now();
      for (const update of updates) Y.applyUpdate(reader.ydoc, update, NETWORK);
      const remoteMs = performance.now() - started;
      if (edit.restore) {
        apply(solo, edit.restore(soloId, soloBefore));
        apply(author.store, edit.restore(authorId, authorBefore));
        deliver();
      }
      if (round < 0) continue;
      record.solo.push(soloMs);
      record.local.push(localMs);
      record.remote.push(remoteMs);
      record.bytes.push(updates.reduce((sum, update) => sum + update.byteLength, 0));
    }
  }
  const failures = [...author.failures, ...reader.failures];
  if (failures.length > 0) throw new Error(failures.join('\n'));
  if (fingerprint(author.store.currentPackage()) !== fingerprint(reader.store.currentPackage())) {
    throw new Error('the replicas did not converge');
  }

  const format = (value: number): string => value.toFixed(2).padStart(7);
  console.log(
    `${path.basename(documentPath)}: ${bodyParagraphs(solo).length} paragraphs, ${rounds} rounds`
  );
  console.log(
    'edit                    solo p50  local p50  local p95  remote p50  remote p95  lag p50  bytes'
  );
  for (const edit of kinds) {
    const record = samples.get(edit.name)!;
    const lag = record.local.map((local, at) => local + record.remote[at]!);
    console.log(
      `${edit.name.padEnd(22)} ${format(percentile(record.solo, 0.5))}  ` +
        `${format(percentile(record.local, 0.5))}    ${format(percentile(record.local, 0.95))}` +
        `     ${format(percentile(record.remote, 0.5))}     ${format(percentile(record.remote, 0.95))}` +
        `  ${format(percentile(lag, 0.5))}  ${String(Math.round(percentile(record.bytes, 0.5))).padStart(5)}`
    );
  }
  for (const replica of [author, reader]) {
    replica.detach();
    replica.handle.destroy();
    replica.awareness.destroy();
    replica.ydoc.destroy();
  }
}

await main();
