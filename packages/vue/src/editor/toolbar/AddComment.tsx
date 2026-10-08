// Add Comment: starts a comment draft on the selection.
//
// `review.comments` is the "Comments & Changes" pane toggle, not an authoring command, so a
// host that wanted a button that ADDS a comment had none. This part asks the composed
// review rail for a draft, the same request the context menu's Add Comment row makes. It
// needs the review module and a mounted review rail, and it is disabled in viewing mode and
// without a selection on the page, where the rail would refuse the draft.

import { defineComponent, h, type PropType, type VNode } from 'vue';
import { useDocxEditor, useEditorStateTick, useReviewRailRegistry } from '../context';
import { mergeHostClass } from '../../lib/mergeHostClass';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { ADD_COMMENT_PATHS } from './toolbar-icons';

/**
 * Add Comment (`DocxEditorToolbar.AddComment`): opens a comment draft on the selection in
 * the review rail. Not part of the default arrangement; place it with `Toolbar.Group`.
 *
 * @example
 * ```ts
 * h(DocxEditorToolbar, null, () => [
 *   h(DocxEditorToolbar.Group, { id: 'review' }, () => [h(DocxEditorToolbar.AddComment)]),
 * ]);
 * ```
 *
 * @public
 */
export const ToolbarAddComment = defineComponent({
  name: 'ToolbarAddComment',
  props: {
    class: { type: String, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
    icon: { type: Object as PropType<VNode>, default: undefined },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const stateTick = useEditorStateTick();
    const rail = useReviewRailRegistry();
    const label = useToolbarLabel();
    return () => {
      if (props.hidden) return null;
      // Re-renders on every editor state change, so a moved selection updates the state.
      void stateTick.value;
      const editor = editorRef.value;
      const gate = editor?.can({ type: 'toggleReviewPane' });
      const readOnly = editor?.snapshot().editingMode === 'viewing';
      const placed = editor ? editor.getSelectionPlacement() !== null : false;
      const enabled = gate?.ok === true && !readOnly && rail.value.mounted > 0 && placed;
      const text = label('formattingBar.addComment');
      const reason =
        gate && !gate.ok ? gate.reason : readOnly ? label('editingMode.viewingHint') : undefined;
      const shared = {
        class: mergeHostClass('docx-toolbar__button', props.class, props.className),
        // Not a chrome slot, so it carries a part marker instead of `data-slot`.
        'data-part': 'add-comment',
        disabled: !enabled,
        ...(!enabled ? { 'data-disabled': '' } : {}),
        'aria-label': text,
        title: (!enabled ? reason : undefined) ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          rail.value.requestCommentDraft();
        },
      };
      if (props.asChild) return h(Slot, shared, slots.default);
      const content = props.icon ?? slots.default?.() ?? chromeIcon(ADD_COMMENT_PATHS);
      return h('button', { type: 'button', ...shared }, content ?? undefined);
    };
  },
});
