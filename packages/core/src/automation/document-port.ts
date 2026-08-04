// The seam between a host and whatever owns the document.
//
// INTERNAL. Not part of the public automation surface: a consumer gets a host, never a port.
// It exists so the headless host and the browser host differ in exactly one place — who owns
// the canonical package — and share every read, every validation and every batch rule.
//
// The port is deliberately the smallest thing that can carry a document: the canonical
// package to read, one ordered-ops transaction to write, bytes to save, and a change signal.
// Note what is NOT here — no per-paragraph read, no text accessor, no offset arithmetic.
// Those live above the port so both hosts cannot answer the same question two ways, which is
// the failure mode a second host implementation always ends in.

import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';

export type AutomationPortApplyResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

export interface AutomationDocumentPort {
  /**
   * Monotonic document revision. One committed batch moves it exactly once.
   *
   * Package-wide rather than per-story: a host answers for a document, and a consumer's
   * `expectedRevision` has to be invalidated by any edit to it.
   */
  revision(): number;
  /**
   * The canonical package, or null when the owner currently has none (a browser host between
   * mounts). Every read the protocol answers is derived from this and nothing else — never
   * from a projection, a layout, or painted DOM.
   */
  currentPackage(): OoxmlPackage | null;
  /**
   * Commit ops as ONE transaction against the body story.
   *
   * Ordered and atomic is the port's contract, not the caller's convention: on any rejection
   * the owner must leave revision, tree and subscribers exactly as they were.
   */
  apply(ops: readonly TreeDocOp[]): AutomationPortApplyResult;
  /** DOCX bytes through the normalizing serializer, or null when there is no document. */
  save(): Uint8Array | null;
  /** Fires once per committed change. */
  subscribe(listener: () => void): () => void;
  /** Release what the port holds. Idempotent. */
  dispose(): void;
}
