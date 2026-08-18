import { defineComponent, h, type PropType, type VNode } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { Slot } from './Slot';
import { guardToolbarMousedown } from './ToolbarButton';

/** @public */
export interface ToolbarActionProps {
  label: string;
  icon?: DocxEditorChildren;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: () => void;
  asChild?: boolean;
  class?: string;
  className?: string;
  children?: DocxEditorChildren;
}

/** @public */
export const ToolbarAction = defineComponent({
  name: 'ToolbarAction',
  props: {
    label: { type: String, required: true },
    icon: { type: Object as PropType<VNode>, default: undefined },
    active: { type: Boolean, default: undefined },
    disabled: { type: Boolean, default: undefined },
    disabledReason: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
    class: { type: String, default: undefined },
  },
  emits: ['select'],
  setup(props, { emit, slots }) {
    return () => {
      const shared = {
        type: 'button',
        class: `docx-toolbar__button${props.class ? ` ${props.class}` : ''}`,
        disabled: props.disabled,
        ...(props.active ? { 'data-active': '' } : {}),
        ...(props.disabled ? { 'data-disabled': '' } : {}),
        ...(props.active !== undefined ? { 'aria-pressed': props.active } : {}),
        'aria-label': props.label,
        title: props.disabled ? (props.disabledReason ?? props.label) : props.label,
        onMousedown: guardToolbarMousedown,
        onClick: props.disabled ? undefined : () => emit('select'),
      };
      const content = props.icon ?? slots.default?.();
      if (props.asChild) return h(Slot, shared, slots.default);
      return h('button', shared, content ?? undefined);
    };
  },
});
