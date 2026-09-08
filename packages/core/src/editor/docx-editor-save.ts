import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { editorError } from './docx-editor-support.ts';
import { commitTextFormInput } from './surface-text-form-fields.ts';
import { pendingSurfaceCommit } from './surface-commit-state.ts';

/** Save pending form values without changing focus or opening validation dialogs. */
export async function saveEditorDocument(
  surface: PaginatedSurface | null,
  container: HTMLElement | null,
  currentSurface: () => PaginatedSurface | null
): Promise<ArrayBuffer> {
  if (!surface) throw editorError('notFound', 'no document is loaded');
  const pending = container ? pendingSurfaceCommit(container) : undefined;
  if (pending) {
    await pending;
    if (currentSurface() !== surface)
      throw editorError(
        'invalidState',
        'The document changed before the pending save could finish.'
      );
  }
  surface.flushPendingInput();
  const refusal = container ? commitTextFormInput(container) : null;
  if (refusal) {
    throw editorError(
      refusal,
      'Cannot save pending text form input. Enter a valid value in each field.'
    );
  }
  surface.refreshRefFieldResults();
  return surface.session.save().slice().buffer as ArrayBuffer;
}
