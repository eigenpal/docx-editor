/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { CollaborationFailure } from '@docx-editor.dev/core/collaboration';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration/replication';
import { asLogicalId } from './identity.ts';
import type { PackageMaterializer } from './materialize.ts';
import { droppedContentDetail } from './schema.ts';

/** Refresh directory-member coordinates after earlier local journals, before projecting another. */
export function prepareMemberRootJournal(
  materializer: Pick<PackageMaterializer, 'shownPartChildren' | 'current'>,
  journal: CanonicalPrimitiveJournal
): CollaborationFailure | null {
  const touchesMemberRoot = journal.effects.some((effect) => {
    const parentId =
      effect.kind === 'spliceChildren'
        ? effect.parentLogicalId
        : effect.kind === 'moveNode'
          ? effect.destinationParentLogicalId
          : null;
    return parentId !== null && materializer.shownPartChildren(asLogicalId(parentId)) !== null;
  });
  if (!touchesMemberRoot) return null;

  // Local commits do not normally materialize. A later member splice must not restore the
  // cached root order from before those commits and then apply its newer insertion indexes.
  // Ordinary paragraph edits take no materialization pass here.
  const view = materializer.current();
  if (!view.ok) return { code: view.code };
  const dropped = droppedContentDetail(view.issues);
  return dropped ? { code: 'materialize-dropped-content', detail: dropped } : null;
}
