/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Bootstrap seams for one full-document replica: the shared-initialization wait, the
 * creator baseline open, and the `create-or-join` arbitration.
 *
 * `create-or-join` removes the out-of-band decision about which peer creates a room. The
 * replica probes for an initialized room first and joins one when it appears. On an empty
 * room it runs a short awareness election: every candidate publishes a random nonce, and
 * only the lowest visible nonce seeds. Two seeders that never saw each other merge two
 * baselines, which duplicates content no client can separate again — so every seed appends
 * its nonce to a shared record array, and every replica that observes more than one record
 * reports the terminal failure code `concurrent-seed` instead of silently converging on a
 * polluted document.
 */

import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { seedPackage, type DocumentRegistry } from './document/index.ts';
import type { SharedBlobStore } from './shared-blob-store.ts';
import { CollaborationSchemaError } from './schema.ts';

const MAX_BASELINE_BYTES = 20 * 1024 * 1024;

/** Default wait for a synced room before a `join` bootstrap gives up. */
export const DEFAULT_INITIALIZATION_TIMEOUT_MS = 30_000;
/** Default probe wait for an existing initialized room before the seed election. */
export const DEFAULT_PROBE_TIMEOUT_MS = 4_000;
/** Default window a seed candidate waits so competing candidates become visible. */
export const DEFAULT_ELECTION_WINDOW_MS = 1_500;

/**
 * Shared record of every `create-or-join` seed transaction. More than one entry means two
 * seed transactions merged: the room is polluted. An EMPTY array is a legacy room seeded
 * by a `create` bootstrap or an older client, and is healthy.
 */
export const SEED_RECORDS_KEY = 'docx-collaboration-seeds-v1';

/** Awareness field a `create-or-join` candidate publishes during the seed election. */
export const SEED_CANDIDATE_FIELD = 'docxEditorSeedCandidate';

const SEED_NONCE_PATTERN = /^[0-9a-f]{16}$/;
const MAX_ELECTION_STATES = 256;

/** Normalized canonical package for the creator's baseline bytes. */
export function openBaselinePackage(bytes: Uint8Array): OoxmlPackage {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new CollaborationSchemaError('invalid-baseline');
  }
  if (bytes.byteLength > MAX_BASELINE_BYTES) {
    throw new CollaborationSchemaError('baseline-too-large');
  }
  const loaded = readOoxmlPackage(bytes, {
    zip: { maxEntries: 10_000, maxTotalBytes: MAX_BASELINE_BYTES, maxRatio: 200 },
  });
  if (!loaded.ok) throw new CollaborationSchemaError('invalid-baseline');
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new CollaborationSchemaError('no-main-document-part');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  return store.currentPackage();
}

function sharedBinariesReady(registry: DocumentRegistry, blobs: SharedBlobStore): boolean {
  for (const descriptor of registry.binaries()) {
    if (!blobs.has(descriptor.digest)) return false;
  }
  return true;
}

export function waitForSharedInitialization(
  registry: DocumentRegistry,
  blobs: SharedBlobStore,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const meta = registry.schema.meta;
  const ready = (): boolean =>
    meta.get('initialized') === true && sharedBinariesReady(registry, blobs);
  // A blob that does not hash to its key reads as absent here, so without this the wait ends in
  // `initialization-timeout` — a joiner told to retry a room that will never satisfy it.
  const poison = (): CollaborationSchemaError | null => {
    const digest = blobs.poisonedDigest();
    return digest ? new CollaborationSchemaError('blob-digest-mismatch', digest) : null;
  };
  if (ready()) return Promise.resolve();
  const poisonedNow = poison();
  if (poisonedNow) return Promise.reject(poisonedNow);
  if (signal?.aborted) {
    return Promise.reject(new CollaborationSchemaError('initialization-aborted'));
  }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      meta.unobserve(onChange);
      registry.doc.off('afterTransaction', onChange);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onChange = (): void => {
      const poisoned = poison();
      if (poisoned) {
        finish(poisoned);
        return;
      }
      if (ready()) finish();
    };
    const onAbort = (): void => finish(new CollaborationSchemaError('initialization-aborted'));
    const timer = setTimeout(
      () => finish(new CollaborationSchemaError('initialization-timeout')),
      timeoutMs
    );
    meta.observe(onChange);
    registry.doc.on('afterTransaction', onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function seedRecordsOf(ydoc: Y.Doc): Y.Array<unknown> {
  return ydoc.getArray<unknown>(SEED_RECORDS_KEY);
}

/** How many seed transactions this room records. Only the count matters; entries are remote. */
export function seedRecordCount(ydoc: Y.Doc): number {
  return seedRecordsOf(ydoc).length;
}

/**
 * Watch the seed records and report a polluted room.
 *
 * `onConcurrentSeed` fires when more than one seed record is visible — at registration or
 * after any later sync. Exactly one record, or none (a legacy room), never fires.
 */
export function observeSeedRecords(ydoc: Y.Doc, onConcurrentSeed: () => void): () => void {
  const records = seedRecordsOf(ydoc);
  const check = (): void => {
    if (records.length > 1) onConcurrentSeed();
  };
  check();
  records.observe(check);
  return () => records.unobserve(check);
}

function seedNonce(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function lowerCandidateVisible(awareness: Awareness, ownNonce: string): boolean {
  const states = [...awareness.getStates().entries()].slice(0, MAX_ELECTION_STATES);
  for (const [clientId, state] of states) {
    if (clientId === awareness.clientID) continue;
    const candidate = (state as Record<string, unknown>)[SEED_CANDIDATE_FIELD];
    if (typeof candidate !== 'string' || !SEED_NONCE_PATTERN.test(candidate)) continue;
    if (candidate < ownNonce) return true;
  }
  return false;
}

async function sharedInitializationArrived(
  registry: DocumentRegistry,
  blobs: SharedBlobStore,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    await waitForSharedInitialization(registry, blobs, timeoutMs, signal);
    return true;
  } catch (error) {
    if (error instanceof CollaborationSchemaError && error.code === 'initialization-timeout') {
      return false;
    }
    throw error;
  }
}

/**
 * Wait until the room's `documentId` is visible.
 *
 * `initialized` and `documentId` travel in separate transactions (the seed transaction
 * cannot span the async digest work before it), so a joiner racing a fresh seed can see
 * the first without the second for a moment. Waiting here keeps that race out of the
 * `document-id-mismatch` check.
 */
function waitForDocumentId(
  registry: DocumentRegistry,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const meta = registry.schema.meta;
  const has = (): boolean => meta.get('documentId') !== undefined;
  if (has()) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(new CollaborationSchemaError('initialization-aborted'));
  }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      meta.unobserve(onChange);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onChange = (): void => {
      if (has()) finish();
    };
    const onAbort = (): void => finish(new CollaborationSchemaError('initialization-aborted'));
    const timer = setTimeout(
      () => finish(new CollaborationSchemaError('initialization-timeout')),
      timeoutMs
    );
    meta.observe(onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Inputs for {@link runCreateOrJoinBootstrap}. The caller owns every resource. */
export interface CreateOrJoinBootstrapOptions {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly registry: DocumentRegistry;
  readonly blobs: SharedBlobStore;
  readonly documentId: string;
  readonly document: Uint8Array;
  readonly probeTimeoutMs?: number;
  readonly electionWindowMs?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Probe, elect, then seed or join. Resolves only when the room is safe to hand out, so no
 * user edit can ride on a seed that loses the race.
 */
export async function runCreateOrJoinBootstrap(
  options: CreateOrJoinBootstrapOptions
): Promise<'seeded' | 'joined'> {
  const { ydoc, awareness, registry, blobs } = options;
  const probeMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const electionMs = options.electionWindowMs ?? DEFAULT_ELECTION_WINDOW_MS;
  const joinMs = options.timeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS;
  const joined = async (): Promise<'joined'> => {
    await waitForDocumentId(registry, joinMs, options.signal);
    return 'joined';
  };
  if (await sharedInitializationArrived(registry, blobs, probeMs, options.signal)) {
    return joined();
  }
  const nonce = seedNonce();
  awareness.setLocalStateField(SEED_CANDIDATE_FIELD, nonce);
  // The candidate stays published until this replica has seeded or joined. Clearing it any
  // earlier reopens the race: an election winner that retracts before its seed is visible
  // looks like an empty room to the loser, and the loser seeds too.
  try {
    // The election window doubles as a second initialization wait, so a seed that lands
    // mid-election turns this replica into a joiner without waiting the window out.
    let sawInitialized = await sharedInitializationArrived(
      registry,
      blobs,
      electionMs,
      options.signal
    );
    if (!sawInitialized && lowerCandidateVisible(awareness, nonce)) {
      await waitForSharedInitialization(registry, blobs, joinMs, options.signal);
      sawInitialized = true;
    }
    if (sawInitialized) return await joined();
    if (registry.schema.meta.get('initialized') === true) {
      // A remote seed landed after the election closed. Join it.
      await waitForSharedInitialization(registry, blobs, joinMs, options.signal);
      return await joined();
    }
    const seeded = await seedPackage(registry, openBaselinePackage(options.document), blobs);
    if (!seeded.ok) throw new CollaborationSchemaError(seeded.code);
    // `seedPackage` owns its transaction (it awaits blob digests first), so the seed record
    // and `documentId` land in the next synchronous transaction. Pollution is judged only by
    // the merged record count, never by ordering, so the extra transaction boundary cannot
    // hide a double seed: every seeder appends before the factory hands the room out.
    ydoc.transact(() => {
      registry.schema.meta.set('documentId', options.documentId);
      seedRecordsOf(ydoc).push([nonce]);
    });
    return 'seeded';
  } finally {
    awareness.setLocalStateField(SEED_CANDIDATE_FIELD, null);
  }
}
