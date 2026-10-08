import { defineComponent, h, ref, watch } from 'vue';
import { type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useEditorCommand, type EditorCommandState } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';

const ALIGNMENT_SLOTS = [
  'alignment.left',
  'alignment.center',
  'alignment.right',
  'alignment.justify',
] as const satisfies readonly ChromeSlotId[];

/** @public */
export interface ToolbarAlignmentComponent {
  docxSlot: 'alignment';
}

/** @public */
export const ToolbarAlignment = defineComponent({
  name: 'ToolbarAlignment',
  props: {
    class: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const left = useEditorCommand('alignment.left');
    const center = useEditorCommand('alignment.center');
    const right = useEditorCommand('alignment.right');
    const justify = useEditorCommand('alignment.justify');
    const label = useToolbarLabel();
    const open = ref(false);
    const rootRef = ref<HTMLDivElement | null>(null);

    const onDocMouseDown = (event: MouseEvent) => {
      const root = rootRef.value;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      open.value = false;
    };

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      document.addEventListener('mousedown', onDocMouseDown);
      onCleanup(() => document.removeEventListener('mousedown', onDocMouseDown));
    });

    return () => {
      if (props.hidden) return null;
      const states: readonly EditorCommandState[] = [left, center, right, justify];
      const options = ALIGNMENT_SLOTS.map((slot, index) => ({
        slot,
        control: chromeControlForSlot(slot),
        state: states[index]!,
      }));
      const current = options.find((option) => option.state.isActive.value) ?? options[0]!;
      const enabled = options.some((option) => option.state.isEnabled.value);
      const currentText = label(current.control?.labelKey ?? current.slot);

      return h(
        'div',
        {
          ref: rootRef,
          class: `docx-toolbar__alignment${props.class ? ` ${props.class}` : ''}`,
          'data-slot': 'alignment',
        },
        [
          h(
            'button',
            {
              type: 'button',
              class: 'docx-toolbar__button docx-toolbar__alignment-trigger',
              disabled: !enabled,
              ...(!enabled ? { 'data-disabled': '' } : {}),
              'aria-haspopup': 'true',
              'aria-expanded': open.value,
              'aria-label': currentText,
              title: enabled ? currentText : (current.state.disabledReason.value ?? currentText),
              onMousedown: guardToolbarMousedown,
              onClick: () => {
                open.value = !open.value;
              },
            },
            [
              chromeIcon(current.control?.paths),
              h('span', { class: 'docx-toolbar__picker-caret', ariaHidden: 'true' }, '▾'),
            ]
          ),
          open.value
            ? h(
                'div',
                { class: 'docx-toolbar__menu docx-toolbar__alignment-popup' },
                options.map((option) => {
                  const text = label(option.control?.labelKey ?? option.slot);
                  return h(
                    'button',
                    {
                      key: option.slot,
                      type: 'button',
                      class: 'docx-toolbar__button docx-toolbar__alignment-option',
                      'data-slot': option.slot,
                      disabled: !option.state.isEnabled.value,
                      ...(option.state.isActive.value ? { 'data-active': '' } : {}),
                      'aria-pressed': option.state.isActive.value,
                      'aria-label': text,
                      title: option.state.disabledReason.value ?? text,
                      onMousedown: guardToolbarMousedown,
                      onClick: () => {
                        option.state.execute();
                        open.value = false;
                      },
                    },
                    [chromeIcon(option.control?.paths)]
                  );
                })
              )
            : null,
        ]
      );
    };
  },
}) as unknown as ToolbarAlignmentComponent;

ToolbarAlignment.docxSlot = 'alignment';
