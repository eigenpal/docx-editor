import {
  computed,
  defineComponent,
  h,
  inject,
  provide,
  ref,
  watch,
  type InjectionKey,
  type PropType,
  type VNode,
} from 'vue';
import { commandForSlot, type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { useStableDocxId } from '../../lib/stable-id';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { MORE_ATTRIBUTE } from './useToolbarOverflow';

const MORE_PATHS: readonly string[] = [
  'M240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400Z',
];

/** @public */
export interface ToolbarOverflowSection {
  readonly id: string;
  readonly labelKey: string;
  readonly children: VNode[];
}

interface OverflowPanelContextValue {
  readonly close: (focusTrigger: boolean) => void;
}

const OverflowPanelContext: InjectionKey<OverflowPanelContextValue> =
  Symbol('OverflowPanelContext');

function focusFirstInteractive(panel: HTMLElement): void {
  const selector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  panel.querySelector<HTMLElement>(selector)?.focus();
}

/** @public */
export const ToolbarOverflowControl = defineComponent({
  name: 'ToolbarOverflowControl',
  props: {
    label: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'docx-toolbar__more-control' }, [
        h('span', { class: 'docx-toolbar__more-control-label' }, props.label),
        h('span', { class: 'docx-toolbar__more-control-body' }, slots.default?.()),
      ]);
  },
});

/** @public */
export const ToolbarOverflowItem = defineComponent({
  name: 'ToolbarOverflowItem',
  props: {
    slot: { type: String as PropType<ChromeSlotId>, required: true },
  },
  setup(props) {
    const label = useToolbarLabel();
    const panel = inject(OverflowPanelContext, { close: () => {} });
    const command = useEditorCommand(computed(() => props.slot) as unknown as ChromeSlotId);
    return () => {
      const control = chromeControlForSlot(props.slot);
      const slotCommand = commandForSlot(props.slot);
      const isToggle = slotCommand?.type === 'toggleMark' || slotCommand?.type === 'setAlignment';
      const text = label(control?.labelKey ?? props.slot);
      return h(
        'button',
        {
          type: 'button',
          class: 'docx-toolbar__more-command',
          'data-slot': props.slot,
          disabled: !command.isEnabled.value,
          ...(command.disabledReason.value ? { title: command.disabledReason.value } : {}),
          ...(isToggle ? { 'aria-pressed': command.isActive.value } : {}),
          ...(command.isActive.value ? { 'data-active': '' } : {}),
          onMousedown: guardToolbarMousedown,
          onClick: (event: MouseEvent) => {
            command.execute();
            panel.close(event.detail === 0);
          },
        },
        [
          h('span', { class: 'docx-toolbar__more-command-icon', ariaHidden: 'true' }, [
            chromeIcon(control?.paths),
          ]),
          h('span', { class: 'docx-toolbar__more-command-label' }, text),
        ]
      );
    };
  },
});

/** @public */
export const ToolbarOverflow = defineComponent({
  name: 'ToolbarOverflow',
  props: {
    sections: {
      type: Array as PropType<readonly ToolbarOverflowSection[]>,
      required: true,
    },
    class: { type: String, default: undefined },
  },
  setup(props) {
    const label = useToolbarLabel();
    const open = ref(false);
    const rootRef = ref<HTMLDivElement | null>(null);
    const triggerRef = ref<HTMLButtonElement | null>(null);
    const panelRef = ref<HTMLDivElement | null>(null);
    const focusOnOpen = ref(false);
    const panelId = useStableDocxId('toolbar-overflow');
    const text = label('formattingBar.more');

    const close = (focusTrigger: boolean) => {
      open.value = false;
      if (focusTrigger) triggerRef.value?.focus();
    };

    provide(OverflowPanelContext, { close });

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onPointerDown = (event: MouseEvent) => {
        const target = event.target;
        if (target instanceof Node && rootRef.value?.contains(target)) return;
        open.value = false;
      };
      document.addEventListener('mousedown', onPointerDown, true);
      onCleanup(() => document.removeEventListener('mousedown', onPointerDown, true));
    });

    watch(open, (isOpen) => {
      if (!isOpen || !focusOnOpen.value) return;
      focusOnOpen.value = false;
      const panel = panelRef.value;
      if (panel) focusFirstInteractive(panel);
    });

    return () =>
      h(
        'div',
        {
          ref: rootRef,
          class: `docx-toolbar__more${props.class ? ` ${props.class}` : ''}`,
          [MORE_ATTRIBUTE]: '',
        },
        [
          h(
            'button',
            {
              ref: triggerRef,
              type: 'button',
              class: 'docx-toolbar__button docx-toolbar__more-trigger',
              'data-slot': 'toolbar.more',
              'aria-haspopup': 'dialog',
              'aria-expanded': open.value,
              'aria-controls': open.value ? panelId : undefined,
              'aria-label': text,
              title: text,
              ...(open.value ? { 'data-active': '' } : {}),
              onMousedown: guardToolbarMousedown,
              onClick: () => {
                open.value = !open.value;
              },
              onKeydown: (event: KeyboardEvent) => {
                if (event.key !== 'ArrowDown') return;
                event.preventDefault();
                focusOnOpen.value = true;
                open.value = true;
              },
            },
            [chromeIcon(MORE_PATHS)]
          ),
          open.value
            ? h(
                'div',
                {
                  ref: panelRef,
                  id: panelId,
                  role: 'dialog',
                  'aria-label': text,
                  class: 'docx-toolbar__more-panel',
                  'data-testid': 'toolbar-overflow-panel',
                  onKeydown: (event: KeyboardEvent) => {
                    if (event.key !== 'Escape' || event.defaultPrevented) return;
                    event.preventDefault();
                    close(true);
                  },
                },
                props.sections.map((section) =>
                  h(
                    'div',
                    {
                      key: section.id,
                      class: 'docx-toolbar__more-section',
                      role: 'group',
                      'aria-label': label(section.labelKey),
                    },
                    [
                      h(
                        'span',
                        { class: 'docx-toolbar__more-heading', ariaHidden: 'true' },
                        label(section.labelKey)
                      ),
                      ...(section.children ?? []),
                    ]
                  )
                )
              )
            : null,
        ]
      );
  },
});
