/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Room-size observability.
 *
 * A room only grows: deletion is a tombstone, and deleted blob bytes stay in the shared blob
 * map. The resource caps that bound hostile amplification run on every received edit, so a
 * long-lived room walks toward a terminal `too-many-nodes` or `blob-store-full` failure.
 * Tombstones count against their own, larger record ceiling rather than the live node cap,
 * which makes that walk longer but not endless. Until compaction exists (the generation reset
 * of issue #554), the honest interim is visibility: a host that can SEE the walk can archive
 * and re-room before the caps end the session for it. This is the probe; the push signal is
 * `subscribeResourcePressure`, in `resource-pressure.ts`.
 */

import * as Y from 'yjs';
import { DocumentRegistry } from './document/index.ts';
import { isNodeMap } from './document/schema.ts';
import { INLINE_FIELD } from './document/paragraph-text.ts';
import { MAX_SHARED_BLOB_BYTES, SHARED_BLOBS_KEY, SharedBlobStore } from './shared-blob-store.ts';
import { rawRelationshipCount } from './resource-pressure.ts';

/**
 * One reading of a room's replicated size against this replica's hard limits.
 *
 * Every `max*` value is the cap whose crossing turns the session status terminal.
 * `tombstonedNodes` is included in `nodes`: a tombstone is never map-deleted, so it keeps
 * counting against `maxNodeRecords` for the life of the room. Live nodes, `nodes` minus
 * `tombstonedNodes`, count against `maxNodes`. A reading is a snapshot — take a new one to
 * observe growth, or subscribe with `subscribeResourcePressure`.
 *
 * @public
 */
export interface CollaborationResourceUsage {
  /** Replicated node records, tombstones included. */
  readonly nodes: number;
  /** The subset of `nodes` that is tombstoned: permanent, and only compaction reclaims it. */
  readonly tombstonedNodes: number;
  /** Live node limit: `nodes - tombstonedNodes` over it is a terminal `too-many-nodes`. */
  readonly maxNodes: number;
  /** Node record limit, tombstones included: `nodes` over it is a terminal `too-many-nodes`. */
  readonly maxNodeRecords: number;
  /** Replicated relationship records. */
  readonly relationships: number;
  /** Relationship limit. Shared state over it is a terminal `too-many-relationships`. */
  readonly maxRelationships: number;
  /** Replicated package parts. */
  readonly parts: number;
  /** Part limit. Shared state over it is a terminal `too-many-parts`. */
  readonly maxParts: number;
  /** Bytes in the shared blob map, unreferenced bytes included. */
  readonly blobBytes: number;
  /** Blob byte limit. Shared state over it is a terminal `blob-store-full`. */
  readonly maxBlobBytes: number;
  /**
   * Formatting markers in paragraph text. Each formatting change leaves some, and deleting the
   * text does not remove them, because a participant who edited offline may still depend on
   * them. They have no cap, but every reader walks them, so a room whose count keeps growing
   * far past its text is one to move to a new room.
   */
  readonly formattingMarkers: number;
}

/** Live formatting markers in every paragraph's shared text. */
function formattingMarkerCount(registry: DocumentRegistry): number {
  let count = 0;
  registry.schema.nodes.forEach((record) => {
    const text = isNodeMap(record) ? record.get(INLINE_FIELD) : null;
    if (!(text instanceof Y.Text)) return;
    for (let item = text._start; item; item = item.right) {
      if (!item.deleted && item.content instanceof Y.ContentFormat) count += 1;
    }
  });
  return count;
}

/**
 * Read one usage snapshot from a live registry and blob store.
 *
 * Every count mirrors the ENFORCING read in `limitFailure`, not the decoded projection: the
 * probe exists to show distance to the caps that end the room, and a hostile peer can pad
 * shared state with malformed entries the decoded readers skip. A probe that under-reports
 * against the enforcement would show a healthy room right up to the terminal failure.
 */
export function resourceUsageOf(
  registry: DocumentRegistry,
  blobs: SharedBlobStore
): CollaborationResourceUsage {
  return Object.freeze({
    nodes: registry.nodeCount(),
    tombstonedNodes: registry.counts.tombstones(),
    maxNodes: registry.limits.maxNodes,
    maxNodeRecords: registry.limits.maxNodeRecords,
    relationships: rawRelationshipCount(registry),
    maxRelationships: registry.limits.maxRelationships,
    parts: registry.schema.parts.size,
    maxParts: registry.limits.maxParts,
    blobBytes: blobs.totalByteLength(),
    maxBlobBytes: MAX_SHARED_BLOB_BYTES,
    formattingMarkers: formattingMarkerCount(registry),
  });
}

/**
 * Read a room's resource usage from a synchronized `Y.Doc`, joining nothing.
 *
 * The server-side sibling of `readCollaborationDocument`: call it from the same jobs — an
 * autosave hook, a metrics scraper — to watch a room's growth against the caps that would
 * end it. It creates no session and writes nothing, and it walks the node map once per call
 * to count tombstones and formatting markers.
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
