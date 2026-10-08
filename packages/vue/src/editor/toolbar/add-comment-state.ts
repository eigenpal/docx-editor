// The one rule for an Add comment control's state, shared by the toolbar part and the
// context-menu row: enabled state comes from `toolbarCommandState`, and the reason shown when
// it is disabled is translated. Viewing mode explains itself with the editing-mode hint, as
// the mode pill does; every other reason is the slot's localized engine reason.

import { computed, type ComputedRef } from 'vue';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useEditorCommand } from '../useEditorCommand';
import { useEditorState } from '../useEditorState';

export const ADD_COMMENT_SLOT: ChromeSlotId = 'review.addComment';

/** Whether Add comment is enabled, and the translated reason when it is not. */
export function useAddCommentState(label: (key: string) => string): {
  readonly isEnabled: ComputedRef<boolean>;
  readonly reason: ComputedRef<string | null>;
} {
  const { isEnabled, disabledReason } = useEditorCommand(ADD_COMMENT_SLOT);
  const viewing = useEditorState((snapshot: EditorSnapshot) => snapshot.editingMode === 'viewing');
  const reason = computed(() => {
    if (isEnabled.value) return null;
    return viewing.value ? label('editingMode.viewingHint') : disabledReason.value;
  });
  return { isEnabled, reason };
}
