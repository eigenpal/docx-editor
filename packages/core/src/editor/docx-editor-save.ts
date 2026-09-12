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
  return surface.save().slice().buffer as ArrayBuffer;
}

/** Synchronous saves refuse reentrant edits before reading incomplete form state. */
export function saveSurfaceDocument(
  surface: PaginatedSurface,
  container: HTMLElement,
  isDestroyed: () => boolean
): Uint8Array {
  const assertLive = () => {
    if (isDestroyed()) throw editorError('destroyed', 'Cannot save a destroyed surface.');
  };
  assertLive();
  if (pendingSurfaceCommit(container)) {
    throw editorError(
      'invalidState',
      'Cannot save during an active edit. Retry after the edit finishes.'
    );
  }
  surface.flushPendingInput();
  assertLive();
  const refusal = commitTextFormInput(container);
  if (refusal) {
    throw editorError(
      refusal,
      'Cannot save pending text form input. Enter a valid value in each field.'
    );
  }
  assertLive();
  surface.refreshRefFieldResults();
  assertLive();
  return surface.session.save();
}
