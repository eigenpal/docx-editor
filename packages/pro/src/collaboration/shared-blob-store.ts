/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The trust boundary on the receive side of a room.
 *
 * A peer is not a trust boundary. Everything here treats shared state exactly the way the
 * engine treats bytes out of a `.docx`: the sender chose all of it, so a claim is checked
 * rather than believed. Two claims matter enough to live together — that a blob's key
 * describes its bytes, and that the registry as a whole still fits this replica's limits.
 */

import * as Y from 'yjs';
import type {
  CollaborationFailure,
  CollaborationFailureCode,
} from '@docx-editor.dev/core/collaboration';
// Named for its first caller, not for fonts. Hashing wire bytes is the same primitive, and
// the media digests this verifies are produced by this exact function in the store lane.
import { sha256FontBytes as sha256Bytes } from '@docx-editor.dev/core/layout';
import type { BlobBytesStore, DocumentRegistry } from './document/index.ts';
import { CollaborationSchemaError } from './schema.ts';

/** Ceiling on the bytes one room carries beside its shared tree. */
export const MAX_SHARED_BLOB_BYTES = 64 * 1024 * 1024;

/** Top-level `Y.Map` key of the content-addressed blob bytes a room carries. */
export const SHARED_BLOBS_KEY = 'docx-package-blobs-v1';

function sharedBlobBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

/** Stored size without the copy `sharedBlobBytes` makes. Used only to total the store. */
function sharedBlobByteLength(value: unknown): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  return ArrayBuffer.isView(value) ? value.byteLength : 0;
}

function failure(code: CollaborationFailureCode, detail?: string): CollaborationFailure {
  return Object.freeze(detail === undefined ? { code } : { code, detail });
}

/**
 * Content-addressed bytes carried beside shared state.
 *
 * Digests are immutable, so two replicas writing the same key write the same bytes and no
 * conflict is possible. Bytes stay out of the node registry, which keeps a one-character edit
 * from re-encoding an image.
 *
 * The key is a claim, not a proof. Any peer can write any bytes under any key, so a digest is
 * trusted only after these bytes hash to it here.
 */
export class SharedBlobStore implements BlobBytesStore {
  /**
   * Byte arrays already hashed and matched.
   *
   * Keyed on the stored array itself, not on its digest. A digest cache would be sound only
   * if entries were immutable, and they are not: a peer can overwrite the entry AFTER it
   * verifies, which is exactly the substitution this guards. Replacing the value replaces the
   * object, so the new bytes are unknown here and get hashed.
   */
  private readonly verified = new WeakSet<object>();
  /** Digests seen carrying bytes that did not hash to them. A poisoned key stays refused. */
  private readonly poisoned = new Set<string>();

  constructor(private readonly shared: Y.Map<Uint8Array>) {}

  get(digest: string): Uint8Array | null {
    const stored = this.shared.get(digest);
    const bytes = sharedBlobBytes(stored);
    if (!bytes || typeof stored !== 'object' || stored === null) return null;
    return this.verify(digest, stored, bytes) ? bytes : null;
  }

  has(digest: string): boolean {
    // Presence alone once these exact bytes are known good: this runs for every descriptor on
    // every transaction while a joiner waits, and `get` copies.
    const stored = this.shared.get(digest);
    if (stored === undefined) return false;
    if (this.verified.has(stored)) return true;
    return this.get(digest) !== null;
  }

  /** A digest whose bytes did not match it, or `null` when every read so far was sound. */
  poisonedDigest(): string | null {
    for (const digest of this.poisoned) return digest;
    return null;
  }

  /**
   * Call `listener` after every change to the blob map, with the keys that changed.
   *
   * Verification alone is not enough to catch a substitution, because it only runs when
   * something reads a blob. Overwriting an entry changes no node, so an incremental
   * materialize touches nothing and answers from cache — the poisoned bytes would sit there
   * until an unrelated edit happened to force a full rebuild.
   */
  observeChanges(listener: (digests: readonly string[]) => void): () => void {
    const handler = (event: Y.YMapEvent<Uint8Array>): void => {
      listener([...event.keysChanged]);
    };
    this.shared.observe(handler);
    return () => this.shared.unobserve(handler);
  }

  /** Hash `digests` now. Returns the first whose bytes do not match it, or `null`. */
  verifyNow(digests: Iterable<string>): string | null {
    for (const digest of digests) {
      if (this.shared.has(digest) && this.get(digest) === null) return digest;
    }
    return null;
  }

  totalByteLength(): number {
    let total = 0;
    this.shared.forEach((value) => {
      total += sharedBlobByteLength(value);
    });
    return total;
  }

  put(digest: string, bytes: Uint8Array): void {
    if (this.shared.has(digest)) return;
    if (this.totalByteLength() + bytes.byteLength > MAX_SHARED_BLOB_BYTES) {
      throw new CollaborationSchemaError('blob-store-full');
    }
    this.shared.set(digest, new Uint8Array(bytes));
  }

  /**
   * Re-hash wire bytes before anything downstream consumes them.
   *
   * Without this, media is trusted by its key: a peer overwrites the entry for an innocent
   * image's digest with bytes of its choosing, and every replica materializes a document whose
   * picture the sender picked. The bytes then travel into saved output under a digest that no
   * longer describes them, so the substitution survives a save and reopen.
   *
   * One hash per distinct byte array per session, and only for blobs something actually reads.
   */
  private verify(digest: string, stored: object, bytes: Uint8Array): boolean {
    if (this.verified.has(stored)) return true;
    if (this.poisoned.has(digest)) return false;
    if (sha256Bytes(bytes) !== digest) {
      this.poisoned.add(digest);
      return false;
    }
    this.verified.add(stored);
    return true;
  }
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
 */
export function limitFailure(
  registry: DocumentRegistry,
  blobs: SharedBlobStore
): CollaborationFailure | null {
  const { limits } = registry;
  // The maintained count, not `nodes.size`: that getter walks every key and allocates an
  // array to measure it, and this runs on every received edit.
  const nodes = registry.nodeCount();
  if (nodes > limits.maxNodes) return failure('too-many-nodes', `${nodes}`);
  const parts = registry.schema.parts.size;
  if (parts > limits.maxParts) return failure('too-many-parts', `${parts}`);
  let relationships = 0;
  registry.schema.relationships.forEach((owner) => {
    relationships += owner instanceof Y.Map ? owner.size : 0;
  });
  if (relationships > limits.maxRelationships) {
    return failure('too-many-relationships', `${relationships}`);
  }
  const blobBytes = blobs.totalByteLength();
  if (blobBytes > MAX_SHARED_BLOB_BYTES) return failure('blob-store-full', `${blobBytes}`);
  return null;
}
