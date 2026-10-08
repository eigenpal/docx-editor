// Add Comment (`review.addComment`): starts a comment draft on the selection.
//
// `review.comments` is the "Comments & Changes" pane toggle, not an authoring command, so a
// host that wanted a button that ADDS a comment had none. Enabled state and the disabled
// reason come from `toolbarCommandState`, like every other slot. The press asks the
// composed review rail for a draft, the same request the context menu's row makes. Without
// a mounted review rail there is nothing to open the draft, so the part renders nothing.

import { defineComponent, h, type PropType, type VNode } from 'vue';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useReviewRailRegistry } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { mergeHostClass } from '../../lib/mergeHostClass';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { useToolbarOverflowClose } from './ToolbarOverflow';
import type { ToolbarPartComponent } from './parts';

const SLOT: ChromeSlotId = 'review.addComment';

/**
 * Add Comment (`DocxEditorToolbar.AddComment`, slot `review.addComment`): opens a comment
 * draft on the selection in the review rail. It needs a mounted review rail to open the
 * draft. It is not part of the default arrangement; place it with `Toolbar.Group`.
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
    const rail = useReviewRailRegistry();
    const label = useToolbarLabel();
    const { isEnabled, disabledReason } = useEditorCommand(SLOT);
    // Inside the "⋯" panel, the press also closes the panel. Outside it this does nothing.
    const closePanel = useToolbarOverflowClose();
    return () => {
      if (props.hidden || rail.value.mounted === 0) return null;
      const control = chromeControlForSlot(SLOT);
      const text = label(control?.labelKey ?? SLOT);
      const enabled = isEnabled.value;
      const shared = {
        class: mergeHostClass('docx-toolbar__button', props.class, props.className),
        'data-slot': SLOT,
        disabled: !enabled,
        ...(!enabled ? { 'data-disabled': '' } : {}),
        'aria-label': text,
        title: disabledReason.value ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          if (rail.value.requestCommentDraft()) closePanel(false);
        },
      };
      if (props.asChild) return h(Slot, shared, slots.default);
      const content = props.icon ?? slots.default?.() ?? chromeIcon(control?.paths);
      return h('button', { type: 'button', ...shared }, content ?? undefined);
    };
  },
});
(ToolbarAddComment as unknown as ToolbarPartComponent).docxSlot = SLOT;
