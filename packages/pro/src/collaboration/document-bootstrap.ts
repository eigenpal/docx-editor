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
  WML_NAMESPACE_URI,
  isStoryPart,
  withPart,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { seedPackage, type DocumentRegistry } from './document/index.ts';
import type { SharedBlobStore } from './shared-blob-store.ts';
import { CollaborationSchemaError } from './errors.ts';
import { PACKAGE_META_KEY, packageVersionFailure } from './document/schema.ts';
import { limitFailure } from './shared-blob-store.ts';
import type { CreateDocumentCollaborationOptions } from './document-session.ts';

const MAX_BASELINE_BYTES = 20 * 1024 * 1024;

/** Default wait for a synced room before a `join` bootstrap gives up. */
export const DEFAULT_INITIALIZATION_TIMEOUT_MS = 30_000;
/** Default probe wait for an existing initialized room before the seed election. */
const DEFAULT_PROBE_TIMEOUT_MS = 4_000;
/** Default window a seed candidate waits so competing candidates become visible. */
const DEFAULT_ELECTION_WINDOW_MS = 1_500;

/**
 * Shared record of every `create-or-join` seed transaction. More than one entry means two
 * seed transactions merged: the room is polluted. An EMPTY array is a legacy room seeded
 * by a `create` bootstrap or an older client, and is healthy.
 */
export const SEED_RECORDS_KEY = 'docx-collaboration-seeds-v1';

/** Awareness field a `create-or-join` candidate publishes during the seed election. */
const SEED_CANDIDATE_FIELD = 'docxEditorSeedCandidate';

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
  // Lazy story stores normalize paragraph identity when first opened. Seed the same
  // identity into shared authority so a concurrent-edit snapshot cannot strip it and
  // make a cold join disagree with peers whose header/footer store is already open.
  let baseline = loaded.package;
  for (const part of baseline.parts.values()) {
    if (
      part.root.namespaceUri !== WML_NAMESPACE_URI ||
      !['document', 'hdr', 'ftr'].includes(part.root.localName) ||
      !isStoryPart(part)
    ) {
      continue;
    }
    const normalized = normalizeParagraphIdentity(part);
    if (normalized !== part) baseline = withPart(baseline, normalized);
  }
  const store = new TreePackageStore(
    baseline,
    normalizeParagraphIdentity(baseline.parts.get(main.name)!)
  );
  return store.currentPackage();
}

function sharedBinariesReady(registry: DocumentRegistry, blobs: SharedBlobStore): boolean {
  for (const descriptor of registry.binaries()) {
    if (!blobs.has(descriptor.digest)) return false;
  }
  return true;
}

function waitForSharedInitialization(
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

/**
 * Record one seed. Every seeding path writes one, so two seeds that merged — two `create`
 * calls on one room, or a `create` racing an election — are detected, not silently doubled.
 */
export function recordSeed(ydoc: Y.Doc): void {
  seedRecordsOf(ydoc).push([seedNonce()]);
}

/** The shared metadata field that holds the size of the room's state right after its seed. */
export const FRESH_BYTES_FIELD = 'freshBytes';

/**
 * Record the size of the room's state right after its seed. A server compares the room's size
 * with it to tell when compacting the room is worth a new generation (`room-generation.ts`).
 */
export function recordFreshSize(ydoc: Y.Doc): void {
  const size = Y.encodeStateAsUpdate(ydoc).byteLength;
  ydoc.getMap(PACKAGE_META_KEY).set(FRESH_BYTES_FIELD, size);
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
async function runCreateOrJoinBootstrap(
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
    recordFreshSize(ydoc);
    return 'seeded';
  } finally {
    awareness.setLocalStateField(SEED_CANDIDATE_FIELD, null);
  }
}

/**
 * Admit shared state another replica wrote, as joining and exporting read it: refuse an
 * incompatible version, build the derived indexes, then refuse a room seeded twice or over a
 * limit. The parent index is built from child-array events, and shared state can arrive
 * before the registry exists, so without the rebuild a reader knows no parents.
 */
export function admitSharedState(
  registry: DocumentRegistry,
  blobs: SharedBlobStore,
  ydoc: Y.Doc
): void {
  const versionFailure = packageVersionFailure(registry.schema.meta);
  if (versionFailure)
    throw new CollaborationSchemaError(versionFailure.code, versionFailure.detail);
  registry.rebuildDerivedIndexes();
  refuseUnusableRoom(registry, blobs, ydoc);
}

/** Refuse a room seeded twice, which duplicates the whole document, or one over a limit. */
function refuseUnusableRoom(registry: DocumentRegistry, blobs: SharedBlobStore, ydoc: Y.Doc): void {
  if (seedRecordCount(ydoc) > 1) throw new CollaborationSchemaError('concurrent-seed');
  const exceeded = limitFailure(registry, blobs);
  if (exceeded) throw new CollaborationSchemaError(exceeded.code, exceeded.detail);
}

/**
 * Create, or join and wait for, the room's shared state, and refuse a room no replica can
 * use: one seeded twice, of another document, of an incompatible version, or over a limit.
 */
export async function initializeSharedState(
  options: Pick<CreateDocumentCollaborationOptions, 'ydoc' | 'awareness' | 'bootstrap'>,
  registry: DocumentRegistry,
  blobs: SharedBlobStore,
  documentId: string
): Promise<void> {
  if (options.bootstrap.kind === 'create') {
    if (registry.schema.meta.get('initialized') === true) {
      throw new CollaborationSchemaError('already-initialized');
    }
    const seeded = await seedPackage(
      registry,
      openBaselinePackage(options.bootstrap.document),
      blobs
    );
    if (!seeded.ok) throw new CollaborationSchemaError(seeded.code);
    options.ydoc.transact(() => {
      registry.schema.meta.set('documentId', documentId);
      recordSeed(options.ydoc);
    });
    recordFreshSize(options.ydoc);
    refuseUnusableRoom(registry, blobs, options.ydoc);
  } else if (options.bootstrap.kind === 'create-or-join') {
    const outcome = await runCreateOrJoinBootstrap({
      ydoc: options.ydoc,
      awareness: options.awareness,
      registry,
      blobs,
      documentId,
      document: options.bootstrap.document,
      probeTimeoutMs: options.bootstrap.probeTimeoutMs,
      electionWindowMs: options.bootstrap.electionWindowMs,
      timeoutMs: options.bootstrap.timeoutMs,
      signal: options.bootstrap.signal,
    });
    if (outcome === 'joined') {
      if (registry.schema.meta.get('documentId') !== documentId) {
        throw new CollaborationSchemaError('document-id-mismatch');
      }
      admitSharedState(registry, blobs, options.ydoc);
    } else {
      refuseUnusableRoom(registry, blobs, options.ydoc);
    }
  } else {
    await waitForSharedInitialization(
      registry,
      blobs,
      options.bootstrap.timeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS,
      options.bootstrap.signal
    );
    if (registry.schema.meta.get('documentId') !== documentId) {
      throw new CollaborationSchemaError('document-id-mismatch');
    }
    admitSharedState(registry, blobs, options.ydoc);
  }
}
