/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * How close a room is to the caps that end it, and a push signal when it gets close.
 *
 * A room only grows: deletion is a tombstone, and deleted blob bytes stay in the shared blob
 * map. Every record, tombstones included, counts against `maxNodes`, so a long-lived room walks
 * toward a terminal `too-many-nodes`. Until compaction exists (issue #554), a host that is told
 * before the cap can export the room and seed a new one.
 *
 * The enforcement and the push signal read the same levels, so a notification never claims
 * more headroom than `limitFailure` allows.
 */

import * as Y from 'yjs';
import type {
  CollaborationFailure,
  CollaborationFailureCode,
} from '@docx-editor.dev/core/collaboration';
import type { DocumentRegistry } from './document/index.ts';
import { MAX_SHARED_BLOB_BYTES, type SharedBlobStore } from './shared-blob-store.ts';

/**
 * A cap whose crossing ends a room.
 *
 * - `nodes`: document node records, deleted nodes included.
 * - `parts`: package parts.
 * - `relationships`: relationship records.
 * - `blobBytes`: bytes in the shared blob map, including bytes no part references any more.
 *
 * @public
 */
export type CollaborationResourceLimit = 'nodes' | 'parts' | 'relationships' | 'blobBytes';

/**
 * The cap a room is closest to, delivered when the room crosses a threshold.
 *
 * @public
 */
export interface CollaborationResourcePressure {
  /** The cap with the highest fraction used. */
  readonly limit: CollaborationResourceLimit;
  /** `used / max` for that cap. A value over 1 means the cap is crossed and the room has ended. */
  readonly fraction: number;
  /** The highest threshold `fraction` reaches, or 0 when it is below every threshold. */
  readonly threshold: number;
  /** The replicated count for that cap. */
  readonly used: number;
  /** The cap. */
  readonly max: number;
}

/**
 * Options for {@link DocumentCollaborationSession.subscribeResourcePressure}.
 *
 * @public
 */
export interface CollaborationResourcePressureOptions {
  /**
   * Fractions of a cap that notify, each greater than 0 and at most 1. Order and duplicates do
   * not matter. At most 16 values. Default: `[0.75, 0.9]`.
   */
  readonly thresholds?: readonly number[];
}

/** One cap's reading. `code` is the failure crossing it reports. */
export interface ResourceLevel {
  readonly limit: CollaborationResourceLimit;
  readonly code: CollaborationFailureCode;
  readonly used: number;
  readonly max: number;
}

/** The arguments of {@link DocumentCollaborationSession.subscribeResourcePressure}. */
export type PressureArgs = [
  listener: (pressure: CollaborationResourcePressure) => void,
  options?: CollaborationResourcePressureOptions,
];

const DEFAULT_THRESHOLDS: readonly number[] = Object.freeze([0.75, 0.9]);
const MAX_THRESHOLDS = 16;

/** Raw relationship records, counted the way the enforcement counts them. */
export function rawRelationshipCount(registry: DocumentRegistry): number {
  let count = 0;
  registry.schema.relationships.forEach((owner) => {
    count += owner instanceof Y.Map ? owner.size : 0;
  });
  return count;
}

/** The node level. `nodeCount` is maintained, so this costs no walk. */
function nodeLevel(registry: DocumentRegistry): ResourceLevel {
  const used = registry.nodeCount();
  return { limit: 'nodes', code: 'too-many-nodes', used, max: registry.limits.maxNodes };
}

/** The levels a walk measures: parts, relationship owners, and stored blobs. */
function walkedLevels(registry: DocumentRegistry, blobs: SharedBlobStore): ResourceLevel[] {
  const { limits, schema } = registry;
  return [
    { limit: 'parts', code: 'too-many-parts', used: schema.parts.size, max: limits.maxParts },
    {
      limit: 'relationships',
      code: 'too-many-relationships',
      used: rawRelationshipCount(registry),
      max: limits.maxRelationships,
    },
    {
      limit: 'blobBytes',
      code: 'blob-store-full',
      used: blobs.totalByteLength(),
      max: MAX_SHARED_BLOB_BYTES,
    },
  ];
}

/**
 * Every cap's reading, in the order the enforcement checks them.
 *
 * Counts are the ENFORCING reads, not the decoded projection: a hostile peer can pad shared
 * state with malformed entries the decoded readers skip, and a reading that under-reports
 * would show a healthy room right up to the terminal failure.
 */
export function resourceLevelsOf(
  registry: DocumentRegistry,
  blobs: SharedBlobStore
): readonly ResourceLevel[] {
  return [nodeLevel(registry), ...walkedLevels(registry, blobs)];
}

/**
 * Refuse shared state that exceeds this replica's resource limits.
 *
 * Every limit is checked as a journal applies, which covers every LOCAL write. A remote update
 * reaches shared state without passing through that path, so until now one crafted message
 * could grow the registry without bound on every peer in the room.
 *
 * What this bounds is the amplification rather than the message. By the time a session sees
 * shared state, Yjs has already integrated the update; the multiplication comes next, when
 * materializing builds a canonical node per record and the store takes a whole package from
 * it. Rejecting the bytes before integration needs the transport, which is a separate seam.
 *
 * Aggregate counts only, because this runs on every received edit. A per-node walk here would
 * cost exactly what the incremental materializer exists to avoid, and the per-node ceilings
 * still hold on every local write.
 *
 * The detail names the limit and its count, `nodes=200001`, so a host can tell which limit
 * ended the room.
 */
export function limitFailure(
  registry: DocumentRegistry,
  blobs: SharedBlobStore
): CollaborationFailure | null {
  for (const level of resourceLevelsOf(registry, blobs)) {
    if (level.used > level.max) {
      return Object.freeze({ code: level.code, detail: `${level.limit}=${level.used}` });
    }
  }
  return null;
}

function normalizedThresholds(options?: CollaborationResourcePressureOptions): readonly number[] {
  const given = options?.thresholds;
  if (given === undefined) return DEFAULT_THRESHOLDS;
  if (!Array.isArray(given) || given.length === 0 || given.length > MAX_THRESHOLDS) {
    throw new RangeError(`thresholds must hold 1 to ${MAX_THRESHOLDS} values`);
  }
  for (const value of given) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
      throw new RangeError('each threshold must be greater than 0 and at most 1');
    }
  }
  return [...new Set(given)].sort((a, b) => a - b);
}

/** The cap closest to its limit, with the highest threshold it reaches. */
export function resourcePressureOf(
  levels: readonly ResourceLevel[],
  thresholds: readonly number[]
): CollaborationResourcePressure {
  let top = levels[0]!;
  let topFraction = -1;
  for (const level of levels) {
    const fraction = level.max > 0 ? level.used / level.max : Number.POSITIVE_INFINITY;
    if (fraction > topFraction) {
      top = level;
      topFraction = fraction;
    }
  }
  let threshold = 0;
  for (const value of thresholds) if (topFraction >= value) threshold = value;
  return Object.freeze({
    limit: top.limit,
    fraction: topFraction,
    threshold,
    used: top.used,
    max: top.max,
  });
}

/**
 * A session's pressure subscriptions, so that destroying the session removes every one of them
 * from the host's `Y.Doc`.
 */
export class PressureWatches {
  private readonly stops = new Set<() => void>();
  private stopped = false;

  /**
   * Call `listener` whenever the highest threshold the room reaches changes, up or down.
   *
   * Checked after each transaction on `ydoc`, local or remote. The node count is maintained;
   * the part, relationship and blob totals are measured once and again only after their own
   * maps change, so a keystroke reads no part, relationship owner or blob. The listener runs
   * once at subscription when the room already reaches a threshold. A listener that throws is
   * reported and never breaks the transaction or another subscription.
   */
  watch(
    ydoc: Y.Doc,
    registry: DocumentRegistry,
    blobs: SharedBlobStore,
    ...[listener, options]: PressureArgs
  ): () => void {
    const thresholds = normalizedThresholds(options);
    if (this.stopped) return () => {};
    const { parts, relationships } = registry.schema;
    let walked: ResourceLevel[] | null = null;
    const changed = (): void => {
      walked = null;
    };
    const read = (): CollaborationResourcePressure => {
      walked ??= walkedLevels(registry, blobs);
      return resourcePressureOf([nodeLevel(registry), ...walked], thresholds);
    };
    const notify = (pressure: CollaborationResourcePressure): void => {
      try {
        listener(pressure);
      } catch (error) {
        console.error('A subscribeResourcePressure listener threw.', error);
      }
    };
    parts.observe(changed);
    relationships.observeDeep(changed);
    const stopBlobs = blobs.observeChanges(changed);
    let reported = read().threshold;
    const check = (): void => {
      const pressure = read();
      if (pressure.threshold === reported) return;
      reported = pressure.threshold;
      notify(pressure);
    };
    const stop = (): void => {
      if (!this.stops.delete(stop)) return;
      ydoc.off('afterTransaction', check);
      parts.unobserve(changed);
      relationships.unobserveDeep(changed);
      stopBlobs();
    };
    ydoc.on('afterTransaction', check);
    this.stops.add(stop);
    if (reported > 0) notify(read());
    return stop;
  }

  /** End every subscription, and refuse new ones. */
  stopAll(): void {
    this.stopped = true;
    for (const stop of [...this.stops]) stop();
  }
}
