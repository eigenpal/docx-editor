// The facade's `documentChange` events, from one mounted session's commits.

import type { DocumentChange } from '@docx-editor.dev/core/contracts/editor';
import type { PaginatedSurface } from './paginated-surface.ts';

export interface DocumentChangeHooks {
  /** A commit can move a page-fit zoom's numerator. */
  refitIfPageResized(): void;
  /** Move the snapshot version. */
  bump(): void;
  emit(change: DocumentChange): void;
}

/** Report every commit of `surface`'s session as a `documentChange`. Returns the unsubscribe. */
export function subscribeDocumentChanges(
  surface: PaginatedSurface,
  hooks: DocumentChangeHooks
): () => void {
  return surface.session.subscribe((change) => {
    const documentChange: DocumentChange = {
      // The PACKAGE revision, never `change.toRevision`: a header/footer or notes change
      // carries THAT part's counter, which starts at zero, so reporting it sent this
      // number backwards and then repeated values it had already emitted.
      revision: surface.session.packageRevision(),
      created: change.created,
      deleted: change.deleted,
      dirty: change.dirty,
    };
    // A commit can move a fit's numerator: `setPageSetup` directly, and undo by both of its
    // routes (the keymap's `surface.undo()` and `exec`), neither of which passes a command
    // hook. Guarded on the authored page width. Reading that width enumerates the sections,
    // and a text-local change edits only run content, never a `w:sectPr`, so a keystroke
    // skips it.
    if (change.impact !== 'text-local') hooks.refitIfPageResized();
    // Bump BEFORE dispatch, so a handler reading `snapshot()` sees the new state.
    hooks.bump();
    hooks.emit(documentChange);
  });
}
