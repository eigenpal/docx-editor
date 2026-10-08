// Add Comment: starts a comment draft on the selection.
//
// `review.comments` is the "Comments & Changes" pane toggle, not an authoring command, so a
// host that wanted a button that ADDS a comment had none. This part asks the composed
// review rail for a draft, the same request the context menu's Add Comment row makes. It
// needs the review module and a mounted review rail, and it is disabled in viewing mode and
// without a selection on the page, where the rail would refuse the draft.

import { useContext } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { ReviewRailContext, useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { ADD_COMMENT_PATHS } from './toolbar-icons';
import { useToolbarOverflowClose } from './ToolbarOverflow';
import type { ToolbarPartProps } from './parts';

const selectReadOnly = (snapshot: EditorSnapshot): boolean => snapshot.editingMode === 'viewing';
// Read so the part re-renders when the selection moves; the placement is asked below.
const selectSelection = (snapshot: EditorSnapshot) => snapshot.selection;

/**
 * Add Comment (`DocxEditorToolbar.AddComment`): opens a comment draft on the selection in
 * the review rail. Not part of the default arrangement; place it with `Toolbar.Group`.
 *
 * @example
 * ```tsx
 * <DocxEditor.Toolbar>
 *   <DocxEditor.Toolbar.Group id="review">
 *     <DocxEditor.Toolbar.AddComment />
 *   </DocxEditor.Toolbar.Group>
 * </DocxEditor.Toolbar>
 * ```
 *
 * @public
 */
export function ToolbarAddComment({
  className,
  hidden,
  icon,
  asChild,
  children,
}: ToolbarPartProps) {
  const editor = useDocxEditor();
  const rail = useContext(ReviewRailContext);
  const label = useToolbarLabel();
  const readOnly = useEditorState(selectReadOnly);
  // Inside the "⋯" panel, the press also closes the panel. Outside it this does nothing.
  const closePanel = useToolbarOverflowClose();
  useEditorState(selectSelection);
  if (hidden) return null;
  const gate = editor?.can({ type: 'toggleReviewPane' });
  const placed = editor ? editor.getSelectionPlacement() !== null : false;
  const enabled = gate?.ok === true && !readOnly && (rail?.mounted ?? 0) > 0 && placed;
  const text = label('comments.addComment');
  const reason =
    gate && !gate.ok ? gate.reason : readOnly ? label('editingMode.viewingHint') : undefined;
  const shared = {
    type: 'button' as const,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    // Not a chrome slot, so it carries a part marker instead of `data-slot`.
    'data-part': 'add-comment',
    disabled: !enabled,
    ...(!enabled ? { 'data-disabled': '' } : {}),
    'aria-label': text,
    title: (!enabled ? reason : undefined) ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => {
      if (rail?.requestCommentDraft()) closePanel(false);
    },
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{icon ?? children ?? chromeIcon(ADD_COMMENT_PATHS)}</button>;
}
