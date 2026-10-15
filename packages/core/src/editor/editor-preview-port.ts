// The automation port a preview fork writes through.
//
// The headless store port over the fork's scratch store, with every decision the planner or the
// commit asks of a port taken from the LIVE editor, so a batch means the same thing in the fork
// and when the commit replays it:
//
// - Suggesting mode. The live surface attributes an untracked document write to the editor's
//   author and lands a replacement after the struck words; the fork does the same with the same
//   pure functions, against its own tree. A runtime's own `TrackMineOnly` ops already carry
//   their revision and pass through unchanged, as they do in the live surface.
// - Collaboration. Writes run under the live session's actor, so a comment or revision id the
//   fork mints is the id the commit mints, and the planner hears the same `collaborative` flag.
// - The review module. Writes the live editor refuses for want of it are refused here too.

import type { AutomationDocumentPort, AutomationStagedOps } from '../automation/document-port.ts';
import { packageStorePort } from '../automation/server-host.ts';
import { DEFAULT_REVISION_MARKUP } from '../contracts/revision-markup.ts';
import { layoutProjectionOf } from '../layout/revision-projection.ts';
import { runWithTransactionActor } from '../store/package/actor-scoped-ids.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { TreePackageStore } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { PaginatedSurfaceRuntimeOptions } from './surface-runtime-options.ts';
import {
  attributeTrackedOps,
  isTrackedEdit,
  trackedReplacementLanding,
} from './surface-tracked-ops.ts';

const REVIEW_REQUIRED = 'review-module-required';
const UNSUPPORTED = 'preview-operation-unsupported';

/** One timestamp per edit, the format the live surface writes: seconds, UTC. */
const trackedDate = (): string => `${new Date().toISOString().slice(0, 19)}Z`;

/**
 * The fork's port. `display` is read per write, so a markup setting the reader changes while
 * the callback runs applies, as it would to the live editor.
 *
 * @internal
 */
export function previewForkPort(
  store: TreePackageStore,
  surface: PaginatedSurface,
  display: () => PaginatedSurfaceRuntimeOptions
): AutomationDocumentPort {
  const base = packageStorePort(store);
  const collaboration = surface.collaborationSession();
  const actor = collaboration?.identity.actorId;
  const review = () => display().reviewModel !== undefined;
  /** The author suggesting mode attributes to, or undefined when writes land untracked. */
  const suggestingAuthor = (): string | undefined => {
    const writer = surface.author()?.trim();
    return surface.editingMode() === 'suggest' && writer ? writer : undefined;
  };
  const formattingTracked = (): boolean =>
    (display().revisionMarkup ?? DEFAULT_REVISION_MARKUP).trackFormatting &&
    !surface.session.trackingSettings().doNotTrackFormatting;
  const attributed = (ops: readonly TreeDocOp[]): readonly TreeDocOp[] => {
    const author = suggestingAuthor();
    if (author === undefined) return ops;
    return attributeTrackedOps(ops, { author, date: trackedDate() }, formattingTracked());
  };
  return {
    ...base,
    collaborative: () => !!collaboration,
    trackedRangeReplacement: () => !collaboration,
    suggesting: () => surface.editingMode() === 'suggest',
    revisionDisplayMode: () => layoutProjectionOf(surface.revisionDisplayMode()),
    replacementLanding(paragraphId, start, end) {
      const author = suggestingAuthor();
      if (author === undefined) return null;
      if (end <= start) return start;
      const paragraph = findNode(
        store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!,
        paragraphId
      );
      if (!paragraph || paragraph.kind !== 'paragraph') return start;
      return trackedReplacementLanding(paragraph, start, end, author, trackedDate());
    },
    apply(staged: AutomationStagedOps, scope, packageEdits = [], requiresReview = false) {
      if (requiresReview && !review()) return { ok: false, reason: REVIEW_REQUIRED };
      let tracked = false;
      const result = runWithTransactionActor(actor, () =>
        base.apply(
          (relate) => {
            const ops = staged(relate);
            if (ops === null) return null;
            const written = attributed(ops);
            if (written.some(isTrackedEdit) && !review()) {
              tracked = true;
              return null;
            }
            return written;
          },
          scope,
          packageEdits
        )
      );
      return tracked ? { ok: false, reason: REVIEW_REQUIRED } : result;
    },
    applyCommentWrites(writes, scope) {
      if (!review()) return { ok: false, reason: REVIEW_REQUIRED };
      return runWithTransactionActor(actor, () => base.applyCommentWrites(writes, scope));
    },
    applyCustomNodeWrite: () => ({ ok: false, reason: UNSUPPORTED }),
    applyLifecycle: () => ({ ok: false, reason: UNSUPPORTED }),
  };
}
