import { useLayoutEffect } from 'react';

import type { PaintedPagesGuard } from '@docx-editor.dev/core/internal/paintedPagesGuard';

/**
 * Keeps the adapter-private painted-pages guard live for child passive effects.
 *
 * React Strict Effects disconnects and reconnects layout effects before it
 * replays child passive setup. Pairing dispose/revive in this parent layout
 * effect guarantees the child OffscreenEditorHost never observes a disposed
 * guard during its replayed setup.
 */
export function usePaintedPagesGuardLifecycle(guard: PaintedPagesGuard): void {
  useLayoutEffect(() => {
    if (guard.isDisposed()) guard.revive();
    return () => guard.dispose();
  }, [guard]);
}
