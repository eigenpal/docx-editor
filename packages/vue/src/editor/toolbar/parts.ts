import { defineComponent, h, inject, type PropType, type VNode } from 'vue';
import { chromeProbeForSlot, type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useHyperlinkPopup } from '../useHyperlinkPopup';
import { ToolbarContext, useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import {
  ToolbarButton,
  chromeControlForSlot,
  chromeIcon,
  guardToolbarMousedown,
  type ToolbarButtonProps,
} from './ToolbarButton';

/** @public */
export type ToolbarPartProps = Omit<ToolbarButtonProps, 'slot'>;

/** @public */
export interface ToolbarPartComponent {
  docxSlot: ChromeSlotId;
}

/** @public */
export interface ToolbarSlotPartProps {
  class?: string;
  hidden?: boolean;
}

/** @public */
export interface ToolbarSlotPartComponent {
  docxSlot: ChromeSlotId;
}

function definePart(slot: ChromeSlotId) {
  const Part = defineComponent({
    name: `ToolbarPart_${slot.replace(/\./g, '_')}`,
    props: {
      class: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
      asChild: { type: Boolean, default: undefined },
      icon: { type: Object as PropType<VNode>, default: undefined },
    },
    setup(props, { slots }) {
      return () => h(ToolbarButton, { slot, ...props }, slots);
    },
  });
  (Part as unknown as ToolbarPartComponent).docxSlot = slot;
  return Part;
}

export const ToolbarUndo = definePart('history.undo');
export const ToolbarRedo = definePart('history.redo');
export const ToolbarBold = definePart('text.bold');
export const ToolbarItalic = definePart('text.italic');
export const ToolbarUnderline = definePart('text.underline');
export const ToolbarStrike = definePart('text.strike');
export const ToolbarClearFormatting = definePart('format.clear');
export const ToolbarSuperscript = definePart('script.super');
export const ToolbarSubscript = definePart('script.sub');
export const ToolbarAlignLeft = definePart('alignment.left');
export const ToolbarAlignCenter = definePart('alignment.center');
export const ToolbarAlignRight = definePart('alignment.right');
export const ToolbarAlignJustify = definePart('alignment.justify');
export const ToolbarBulletList = definePart('list.bullet');
export const ToolbarNumberedList = definePart('list.numbered');
export const ToolbarOutdent = definePart('list.outdent');
export const ToolbarIndent = definePart('list.indent');
export const ToolbarTableInsert = definePart('table.insert');
export const ToolbarComments = definePart('review.comments');

/** @public */
export const ToolbarLink = defineComponent({
  name: 'ToolbarLink',
  props: {
    class: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
    icon: { type: Object as PropType<VNode>, default: undefined },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const { openAtCaret } = useHyperlinkPopup();
    const label = useToolbarLabel();
    return () => {
      if (props.hidden) return null;
      const editor = editorRef.value;
      const probe = chromeProbeForSlot('text.link');
      const allowed = editor && probe ? editor.can(probe) : null;
      const isEnabled = allowed?.ok === true;
      const disabledReason = allowed && !allowed.ok ? allowed.reason : null;
      const control = chromeControlForSlot('text.link');
      const text = label(control?.labelKey ?? 'text.link');
      const shared = {
        class: `docx-toolbar__button${props.class ? ` ${props.class}` : ''}`,
        'data-slot': 'text.link',
        disabled: !isEnabled,
        ...(!isEnabled ? { 'data-disabled': '' } : {}),
        'aria-label': text,
        title: disabledReason ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: () => openAtCaret(),
      };
      const content = props.icon ?? slots.default?.() ?? chromeIcon(control?.paths);
      if (props.asChild) return h(Slot, shared, slots.default);
      return h('button', { type: 'button', ...shared }, content ?? undefined);
    };
  },
});
(ToolbarLink as unknown as ToolbarPartComponent).docxSlot = 'text.link';

/** @public */
export const ToolbarSave = defineComponent({
  name: 'ToolbarSave',
  props: {
    class: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const ctx = inject(ToolbarContext, { t: undefined, onSave: undefined });
    const label = useToolbarLabel();
    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot('file.save');
      const text = label(control?.labelKey ?? 'file.save');
      const disabled = !editorRef.value || !ctx.onSave;
      return h(
        'button',
        {
          type: 'button',
          class: `docx-toolbar__button${props.class ? ` ${props.class}` : ''}`,
          'data-slot': 'file.save',
          disabled,
          ...(disabled ? { 'data-disabled': '' } : {}),
          'aria-label': text,
          title: text,
          onMousedown: guardToolbarMousedown,
          onClick: () => ctx.onSave?.(),
        },
        [chromeIcon(control?.paths)]
      );
    };
  },
});
(ToolbarSave as unknown as ToolbarSlotPartComponent).docxSlot = 'file.save';

/** @public */
export interface ToolbarSeparatorProps {
  class?: string;
}

/** @public */
export const ToolbarSeparator = defineComponent({
  name: 'ToolbarSeparator',
  props: { class: { type: String, default: undefined } },
  setup(props) {
    return () =>
      h('div', {
        role: 'separator',
        'aria-orientation': 'vertical',
        class: `docx-toolbar__separator${props.class ? ` ${props.class}` : ''}`,
      });
  },
});

export type { ToolbarButtonProps };
