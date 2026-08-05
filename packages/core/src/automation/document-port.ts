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
import type { StoryScope } from '../store/store/tree-package-store.ts';

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
   * Commit ops as ONE transaction against ONE story.
   *
   * Ordered and atomic is the port's contract, not the caller's convention: on any rejection
   * the owner must leave revision, tree and subscribers exactly as they were.
   *
   * The scope is the caller's, because the caller is the only one who knows which story the
   * batch addressed. A port that assumed the body would silently refuse every header and note
   * op — the ids are not in the body's index — and a port that guessed from the ops would be a
   * second story resolver disagreeing with the reads.
   */
  apply(ops: readonly TreeDocOp[], scope: StoryScope): AutomationPortApplyResult;
  /** DOCX bytes through the normalizing serializer, or null when there is no document. */
  save(): Uint8Array | null;
  /**
   * Put a reader's selection or caret on a stretch of the body.
   *
   * OPTIONAL, and the one thing about a host that is genuinely not portable: a headless host
   * has no caret to move, so it omits this and reports `selection: false` rather than
   * pretending. Called AFTER the batch's transaction, never during it. Positions are canonical
   * paragraph ids and model offsets — the same vocabulary the ops take, so there is no second
   * coordinate space to keep in step.
   */
  select?(
    range: {
      readonly start: { readonly paragraphId: string; readonly offset: number };
      readonly end: { readonly paragraphId: string; readonly offset: number };
    },
    mode: 'select' | 'start' | 'end'
  ): void;
  /** Fires once per committed change. */
  subscribe(listener: () => void): () => void;
  /** Release what the port holds. Idempotent. */
  dispose(): void;
}
