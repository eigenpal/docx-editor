/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Room-size observability.
 *
 * A room only grows: deletion is a tombstone, and deleted blob bytes stay in the shared blob
 * map. The resource caps that bound hostile amplification run on every received edit and
 * count that growth, so a long-lived room walks toward a terminal `too-many-nodes` or
 * `blob-store-full` failure. Until compaction exists (the generation reset of issue #554),
 * the honest interim is visibility: a host that can SEE the walk can archive and re-room
 * before the caps end the session for it.
 */

import type * as Y from 'yjs';
import { DocumentRegistry } from './document/index.ts';
import { NODE_DELETED_FIELD } from './document/schema.ts';
import { MAX_SHARED_BLOB_BYTES, SHARED_BLOBS_KEY, SharedBlobStore } from './shared-blob-store.ts';

/**
 * One reading of a room's replicated size against this replica's hard limits.
 *
 * Every `max*` value is the cap whose crossing turns the session status terminal.
 * `tombstonedNodes` is included in `nodes`: a tombstone is never map-deleted, so it keeps
 * counting against `maxNodes` for the life of the room. A reading is a snapshot — take a new
 * one to observe growth.
 *
 * @public
 */
export interface CollaborationResourceUsage {
  /** Replicated node records, tombstones included. */
  readonly nodes: number;
  /** The subset of `nodes` that is tombstoned: permanent, and only compaction reclaims it. */
  readonly tombstonedNodes: number;
  readonly maxNodes: number;
  readonly relationships: number;
  readonly maxRelationships: number;
  readonly parts: number;
  readonly maxParts: number;
  /** Bytes in the shared blob map, unreferenced bytes included. */
  readonly blobBytes: number;
  readonly maxBlobBytes: number;
}

/** Count tombstoned node records. One walk over the node map, so this is a probe, not a poll. */
function tombstoneCount(registry: DocumentRegistry): number {
  let count = 0;
  registry.schema.nodes.forEach((record) => {
    if (record.get(NODE_DELETED_FIELD) === true) count += 1;
  });
  return count;
}

/** Read one usage snapshot from a live registry and blob store. */
export function resourceUsageOf(
  registry: DocumentRegistry,
  blobs: SharedBlobStore
): CollaborationResourceUsage {
  return Object.freeze({
    nodes: registry.nodeCount(),
    tombstonedNodes: tombstoneCount(registry),
    maxNodes: registry.limits.maxNodes,
    relationships: registry.relationshipCount(),
    maxRelationships: registry.limits.maxRelationships,
    parts: registry.partCount(),
    maxParts: registry.limits.maxParts,
    blobBytes: blobs.totalByteLength(),
    maxBlobBytes: MAX_SHARED_BLOB_BYTES,
  });
}

/**
 * Read a room's resource usage from a synchronized `Y.Doc`, joining nothing.
 *
 * The server-side sibling of `readCollaborationDocument`: call it from the same jobs — an
 * autosave hook, a metrics scraper — to watch a room's growth against the caps that would
 * end it. It creates no session and writes nothing, and it walks the node map once per call.
 *
 * @public
 */
export function readCollaborationResourceUsage(ydoc: Y.Doc): CollaborationResourceUsage {
  const registry = new DocumentRegistry(ydoc);
  try {
    const blobs = new SharedBlobStore(ydoc.getMap<Uint8Array>(SHARED_BLOBS_KEY));
    return resourceUsageOf(registry, blobs);
  } finally {
    // Owned here, so released here: a metrics scraper calls this for the life of the room.
    registry.destroy();
  }
}
