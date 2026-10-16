// Merge Cells and Split Cells in the contextual table chrome. The Vue twin of the React parts:
// Merge is an ordinary slot button, and Split opens the Split cells dialog, enabled by the
// slot's probe.

import { defineComponent, h, type PropType, type VNode } from 'vue';
import { mergeHostClass } from '../../lib/mergeHostClass';
import { useEditorCommand } from '../useEditorCommand';
import { useDialogHost } from '../dialog-host';
import { useToolbarLabel } from './toolbar-context';
import {
  ToolbarButton,
  chromeControlForSlot,
  chromeIcon,
  guardToolbarMousedown,
} from './ToolbarButton';
import type { ToolbarPartComponent } from './parts';

const partProps = {
  class: { type: String, default: undefined },
  className: { type: String, default: undefined },
  hidden: { type: Boolean, default: undefined },
  icon: { type: Object as PropType<VNode>, default: undefined },
} as const;

/** Merge the selected cells. @public */
export const ToolbarTableMergeCells = Object.assign(
  defineComponent({
    name: 'ToolbarTableMergeCells',
    props: partProps,
    setup(props, { slots }) {
      return () => h(ToolbarButton, { slotId: 'table.mergeCells', ...props }, slots);
    },
  }),
  { docxSlot: 'table.mergeCells' } as const satisfies ToolbarPartComponent
);

/** Open the Split cells dialog for the cell at the selection. @public */
export const ToolbarTableSplitCell = Object.assign(
  defineComponent({
    name: 'ToolbarTableSplitCell',
    props: partProps,
    setup(props, { slots }) {
      const command = useEditorCommand('table.splitCell');
      const dialogs = useDialogHost();
      const label = useToolbarLabel();
      return () => {
        // Without a dialog host there is nothing to open, and an enabled button would do
        // nothing.
        if (props.hidden || !dialogs) return null;
        const control = chromeControlForSlot('table.splitCell');
        const text = label(control?.labelKey ?? 'table.splitCell');
        const enabled = command.isEnabled.value;
        return h(
          'button',
          {
            type: 'button',
            'data-slot': 'table.splitCell',
            class: mergeHostClass('docx-toolbar__button', props.class, props.className),
            disabled: !enabled,
            ...(!enabled ? { 'data-disabled': '' } : {}),
            'aria-label': text,
            'aria-haspopup': 'dialog',
            title: command.disabledReason.value ?? text,
            onMousedown: guardToolbarMousedown,
            onClick: (event: MouseEvent) =>
              dialogs.open('splitCell', event.currentTarget as HTMLElement),
          },
          props.icon ?? slots.default?.() ?? chromeIcon(control?.paths) ?? undefined
        );
      };
    },
  }),
  { docxSlot: 'table.splitCell' } as const satisfies ToolbarPartComponent
);
