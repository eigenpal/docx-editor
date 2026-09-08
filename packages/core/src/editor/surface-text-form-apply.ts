import type { TreeApplyResult } from '@docx-editor.dev/core/binding';
import type { TreeDocOp } from '@docx-editor.dev/core/store';

/** Field dialogs share the surface's normal commit, validation, and repaint path. */
export function applyTextFormOperation(
  op: TreeDocOp,
  commit: (run: () => TreeApplyResult) => void,
  apply: (ops: readonly TreeDocOp[]) => TreeApplyResult
): boolean {
  let applied = false;
  commit(() => {
    const result = apply([op]);
    applied = !result.rejected;
    return result;
  });
  return applied;
}
