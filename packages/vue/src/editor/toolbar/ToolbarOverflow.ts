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
import {
  chromeSlotIsToggle,
  hasOpenNestedPopup,
  listenForPopupEscape,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useNavigationViewportElement } from '../navigation/navigation-layout';
import { useEditorCommand } from '../useEditorCommand';
import { usePlatformShortcut } from '../usePlatformShortcut';
import { useStableDocxId } from '../../lib/stable-id';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { MORE_ATTRIBUTE } from './useToolbarOverflow';
import { toolbarPanelPlacement, type ToolbarPanelPlacement } from '@docx-editor.dev/core/editor';

export const MORE_PATHS: readonly string[] = [
  'M240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400Z',
];

/** @public */
export interface ToolbarOverflowSection {
  readonly id: string;
  readonly labelKey: string;
  /** Display text that wins over `labelKey`, for a host group. */
  readonly label?: string;
  readonly children: VNode[];
}

interface OverflowPanelContextValue {
  readonly close: (focusTrigger: boolean) => void;
}

const OverflowPanelContext: InjectionKey<OverflowPanelContextValue> =
  Symbol('OverflowPanelContext');

/**
 * Closes the "⋯" panel from a row inside it. `focusTrigger` returns focus to the trigger,
 * which a keyboard activation needs because the focused row unmounts.
 */
export function useToolbarOverflowClose(): (focusTrigger: boolean) => void {
  return inject(OverflowPanelContext, { close: () => {} }).close;
}

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
    const shortcut = usePlatformShortcut();
    const panel = inject(OverflowPanelContext, { close: () => {} });
    const command = useEditorCommand(computed(() => props.slot) as unknown as ChromeSlotId);
    return () => {
      const control = chromeControlForSlot(props.slot);
      // The same three answers the in-bar button renders, because on a narrow window this IS
      // the button: the toggle rule is the engine's (`chromeSlotIsToggle`), `data-value` is
      // what tells a locked format painter apart from an armed one, and the label is
      // corrected for this keyboard.
      const isToggle = chromeSlotIsToggle(props.slot);
      const text = shortcut(label(control?.labelKey ?? props.slot));
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
          ...(command.value.value !== null ? { 'data-value': command.value.value } : {}),
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
    const viewport = useNavigationViewportElement();
    const text = label('formattingBar.more');

    const close = (focusTrigger: boolean) => {
      open.value = false;
      if (focusTrigger) triggerRef.value?.focus();
    };

    provide(OverflowPanelContext, { close });

    // Clamped into the viewport. The stylesheet lines the panel up with the trigger's end,
    // which runs off the left edge when the bar is centered or narrow. Placed after the
    // panel renders, before the browser paints it, and again on resize.
    const placement = ref<ToolbarPanelPlacement | null>(null);
    const place = (): void => {
      const root = rootRef.value;
      const panel = panelRef.value;
      const trigger = triggerRef.value;
      const view = root?.ownerDocument.defaultView;
      if (!root || !panel || !trigger || !view) return;
      const rect = trigger.getBoundingClientRect();
      const next = toolbarPanelPlacement({
        triggerLeft: rect.left,
        triggerRight: rect.right,
        panelWidth: panel.offsetWidth,
        viewportWidth: view.innerWidth,
      });
      // In the root's own coordinates, because the panel is positioned against it.
      placement.value = { ...next, left: next.left - root.getBoundingClientRect().left };
    };
    watch(
      open,
      (isOpen, _, onCleanup) => {
        if (!isOpen) {
          placement.value = null;
          return;
        }
        place();
        const view = rootRef.value?.ownerDocument.defaultView;
        view?.addEventListener('resize', place);
        onCleanup(() => view?.removeEventListener('resize', place));
      },
      { flush: 'post' }
    );

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onPointerDown = (event: MouseEvent) => {
        const target = event.target;
        if (target instanceof Node && rootRef.value?.contains(target)) return;
        open.value = false;
      };
      const root = rootRef.value;
      // Escape in the capture phase, ahead of the surface: a click opens the panel with focus
      // left in the pages, and the surface would spend the key on its own mode first. An open
      // nested popup (a table menu, a picker) takes this Escape, and the panel stays open.
      const stopEscape = root
        ? listenForPopupEscape({
            popup: root,
            contains: (node) =>
              rootRef.value?.contains(node) === true || panelRef.value?.contains(node) === true,
            editorElements: () => [viewport.value],
            skip: () => hasOpenNestedPopup(panelRef.value),
            close,
          })
        : undefined;
      document.addEventListener('mousedown', onPointerDown, true);
      onCleanup(() => {
        document.removeEventListener('mousedown', onPointerDown, true);
        stopEscape?.();
      });
    });

    watch(
      open,
      (isOpen) => {
        if (!isOpen || !focusOnOpen.value) return;
        focusOnOpen.value = false;
        const panel = panelRef.value;
        if (panel) focusFirstInteractive(panel);
      },
      { flush: 'post' }
    );

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
                  ...(placement.value ? { 'data-anchor': placement.value.anchor } : {}),
                  style: placement.value
                    ? {
                        left: `${placement.value.left}px`,
                        right: 'auto',
                        maxInlineSize: `${placement.value.maxWidth}px`,
                      }
                    : undefined,
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
                      'aria-label': section.label ?? label(section.labelKey),
                    },
                    [
                      h(
                        'span',
                        { class: 'docx-toolbar__more-heading', ariaHidden: 'true' },
                        section.label ?? label(section.labelKey)
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
