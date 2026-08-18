import { defineComponent, h, type PropType, type VNode } from 'vue';
import { type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { useContentControl, CONTENT_CONTROL_SLOTS } from '../useContentControl';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarPartComponent } from './parts';

function asSlot(id: string): ChromeSlotId {
  return id as ChromeSlotId;
}

function defineTogglePart(slotId: string, mode: 'showAll' | 'formFill'): ToolbarPartComponent {
  const slot = asSlot(slotId);
  const Part = defineComponent({
    name: `ContentControlToggle_${mode}`,
    props: {
      className: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
      icon: { type: Object as PropType<VNode>, default: undefined },
      asChild: { type: Boolean, default: undefined },
    },
    setup(props, { slots }) {
      const command = useEditorCommand(slot);
      const chrome = useContentControl();
      const label = useToolbarLabel();
      return () => {
        if (props.hidden) return null;
        const pressed = mode === 'showAll' ? chrome.showAll.value : chrome.formFill.value;
        const control = chromeControlForSlot(slot);
        const text = label(control?.labelKey ?? slotId);
        const shared = {
          type: 'button',
          class: `docx-toolbar__button${props.className ? ` ${props.className}` : ''}`,
          'data-slot': slotId,
          disabled: !command.isEnabled.value,
          ...(!command.isEnabled.value ? { 'data-disabled': '' } : {}),
          ...(pressed ? { 'data-active': '' } : {}),
          'aria-pressed': pressed,
          'aria-label': text,
          title: command.disabledReason.value ?? text,
          onMousedown: guardToolbarMousedown,
          onClick: () => {
            if (mode === 'showAll') chrome.toggleShowAll();
            else chrome.toggleFormFill();
          },
        };
        const content = props.icon ?? slots.default?.() ?? chromeIcon(control?.paths);
        if (props.asChild) return h(Slot, shared, slots.default);
        return h('button', shared, content ?? undefined);
      };
    },
  });
  (Part as unknown as ToolbarPartComponent).docxSlot = slot;
  return Part as unknown as ToolbarPartComponent;
}

/** @public */
export const ToolbarContentControlShowAll = defineTogglePart(
  CONTENT_CONTROL_SLOTS.showAll,
  'showAll'
);
/** @public */
export const ToolbarContentControlFormFill = defineTogglePart(
  CONTENT_CONTROL_SLOTS.formFill,
  'formFill'
);

/** @public */
export const ToolbarContentControlInspector = defineComponent({
  name: 'ToolbarContentControlInspector',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    icon: { type: Object as PropType<VNode>, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const slot = asSlot(CONTENT_CONTROL_SLOTS.inspector);
    const command = useEditorCommand(slot);
    const { inspectorOpen, openInspector } = useContentControl();
    const label = useToolbarLabel();
    return () => {
      if (props.hidden) return null;
      const registry = chromeControlForSlot(slot);
      const text = label(registry?.labelKey ?? 'contentControl.inspector');
      const shared = {
        type: 'button',
        class: `docx-toolbar__button${props.className ? ` ${props.className}` : ''}`,
        'data-slot': CONTENT_CONTROL_SLOTS.inspector,
        disabled: !command.isEnabled.value,
        ...(!command.isEnabled.value ? { 'data-disabled': '' } : {}),
        ...(inspectorOpen.value ? { 'data-active': '' } : {}),
        'aria-pressed': inspectorOpen.value,
        'aria-label': text,
        title: command.disabledReason.value ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: () => openInspector(),
      };
      const content = props.icon ?? slots.default?.() ?? chromeIcon(registry?.paths);
      if (props.asChild) return h(Slot, shared, slots.default);
      return h('button', shared, content ?? undefined);
    };
  },
}) as unknown as ToolbarPartComponent;

(ToolbarContentControlInspector as unknown as ToolbarPartComponent).docxSlot = asSlot(
  CONTENT_CONTROL_SLOTS.inspector
);

/** @public */
export const ToolbarContentControlRemove = defineComponent({
  name: 'ToolbarContentControlRemove',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    icon: { type: Object as PropType<VNode>, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const { canRemove, removeDisabledReason, remove } = useContentControl();
    const label = useToolbarLabel();
    return () => {
      if (props.hidden) return null;
      const slot = asSlot(CONTENT_CONTROL_SLOTS.remove);
      const registry = chromeControlForSlot(slot);
      const text = label(registry?.labelKey ?? 'contentControl.remove');
      const shared = {
        type: 'button',
        class: `docx-toolbar__button${props.className ? ` ${props.className}` : ''}`,
        'data-slot': CONTENT_CONTROL_SLOTS.remove,
        disabled: !canRemove.value,
        ...(!canRemove.value ? { 'data-disabled': '' } : {}),
        'aria-label': text,
        title: removeDisabledReason.value ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: () => remove(),
      };
      const content = props.icon ?? slots.default?.() ?? chromeIcon(registry?.paths);
      if (props.asChild) return h(Slot, shared, slots.default);
      return h('button', shared, content ?? undefined);
    };
  },
}) as unknown as ToolbarPartComponent;

(ToolbarContentControlRemove as unknown as ToolbarPartComponent).docxSlot = asSlot(
  CONTENT_CONTROL_SLOTS.remove
);

export const CONTENT_CONTROL_SHAPED_PARTS: Partial<
  Record<ChromeSlotId, (props: { hidden?: boolean }) => VNode | null>
> = {
  [asSlot(CONTENT_CONTROL_SLOTS.showAll)]: ToolbarContentControlShowAll,
  [asSlot(CONTENT_CONTROL_SLOTS.formFill)]: ToolbarContentControlFormFill,
  [asSlot(CONTENT_CONTROL_SLOTS.inspector)]: ToolbarContentControlInspector,
  [asSlot(CONTENT_CONTROL_SLOTS.remove)]: ToolbarContentControlRemove,
};
