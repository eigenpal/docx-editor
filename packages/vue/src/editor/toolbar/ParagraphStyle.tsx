import {
  computed,
  defineComponent,
  inject,
  provide,
  ref,
  watch,
  type ComputedRef,
  type CSSProperties,
  type InjectionKey,
  type VNode,
} from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';
import { Slot } from './Slot';
import {
  useParagraphStyle,
  type ParagraphStyleOption,
  type UseParagraphStyleResult,
} from './useParagraphStyle';

function previewStyle(preview: ParagraphStyleOption['preview']): CSSProperties {
  const pt = preview.fontSizePt;
  return {
    ...(preview.fontFamily ? { fontFamily: preview.fontFamily } : {}),
    ...(pt ? { fontSize: `${Math.min(Math.max(pt, 9), 20)}px` } : {}),
    ...(preview.bold ? { fontWeight: 700 } : {}),
    ...(preview.italic ? { fontStyle: 'italic' } : {}),
    ...(preview.color ? { color: `#${preview.color}` } : {}),
  };
}

interface ParagraphStyleContextValue extends UseParagraphStyleResult {
  readonly open: ComputedRef<boolean>;
  readonly setOpen: (next: boolean) => void;
}

const ParagraphStyleContextKey: InjectionKey<ParagraphStyleContextValue> =
  Symbol('ParagraphStyleContext');

function useParagraphStyleContext(): ParagraphStyleContextValue | null {
  return inject(ParagraphStyleContextKey, null);
}

/** @public */
export interface ParagraphStylePartProps {
  asChild?: boolean;
  className?: string;
  children?: DocxEditorChildren;
}

/** @public */
export interface ParagraphStyleProps extends ParagraphStylePartProps {
  hidden?: boolean;
}

/** @public */
export interface ParagraphStyleItemProps extends ParagraphStylePartProps {
  value: string;
}

const ParagraphStyleTrigger = defineComponent({
  name: 'ParagraphStyleTrigger',
  props: {
    asChild: { type: Boolean, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const context = useParagraphStyleContext();
    const label = useToolbarLabel();
    return () => {
      if (!context) return null;
      const control = chromeControlForSlot('styles.style');
      const text = label(control?.labelKey ?? 'styles.style');
      const shared = {
        onClick: () => context.setOpen(!context.open.value),
        onMousedown: guardToolbarMousedown,
        disabled: !context.isEnabled.value,
        class: `docx-toolbar__style-trigger${props.className ? ` ${props.className}` : ''}`,
        ...(!context.isEnabled.value ? { 'data-disabled': '' } : {}),
        'aria-haspopup': 'listbox' as const,
        'aria-expanded': context.open.value,
        'aria-label': text,
        title: text,
      };
      const current = context.options.value.find(
        (option) => option.styleId === context.value.value
      );
      const display =
        slots.default?.() ??
        (context.value.value === null
          ? [<span>{control?.valueKey ? label(control.valueKey) : '—'}</span>]
          : [<span>{current?.name ?? context.value.value}</span>]);
      if (props.asChild) return <Slot {...shared}>{display}</Slot>;
      return (
        <button type="button" {...shared}>
          {display}
        </button>
      );
    };
  },
});
(ParagraphStyleTrigger as { docxToolbarPart?: boolean }).docxToolbarPart = true;

const ParagraphStyleContent = defineComponent({
  name: 'ParagraphStyleContent',
  props: {
    asChild: { type: Boolean, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const context = useParagraphStyleContext();
    return () => {
      if (!context || !context.open.value) return null;
      const shared = {
        role: 'listbox' as const,
        class: `docx-toolbar__menu docx-toolbar__style-content${props.className ? ` ${props.className}` : ''}`,
        style: {
          position: 'absolute' as const,
          top: '100%',
          left: 0,
          zIndex: 30,
          minWidth: '100%',
          maxHeight: '300px',
          overflowY: 'auto' as const,
        },
      };
      const items =
        slots.default?.() ??
        context.options.value.map((option) => (
          <ParagraphStyleItem key={option.styleId} value={option.styleId} />
        ));
      if (props.asChild) return <Slot {...shared}>{items}</Slot>;
      return <div {...shared}>{items}</div>;
    };
  },
});

const ParagraphStyleItem = defineComponent({
  name: 'ParagraphStyleItem',
  props: {
    value: { type: String, required: true },
    asChild: { type: Boolean, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const context = useParagraphStyleContext();
    return () => {
      if (!context) return null;
      const selected = context.value.value === props.value;
      const option = context.options.value.find((entry) => entry.styleId === props.value);
      const shared = {
        role: 'option' as const,
        'aria-selected': selected,
        ...(selected ? { 'data-selected': '' } : {}),
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          context.setValue(props.value);
          context.setOpen(false);
        },
        class: `docx-toolbar__style-item${props.className ? ` ${props.className}` : ''}`,
      };
      const display = slots.default?.() ?? [
        <span style={option ? previewStyle(option.preview) : undefined}>
          {option?.name ?? props.value}
        </span>,
      ];
      if (props.asChild) return <Slot {...shared}>{display}</Slot>;
      return (
        <button type="button" {...shared}>
          {display}
          {selected ? (
            <span class="docx-toolbar__menu-check" aria-hidden="true">
              ✓
            </span>
          ) : null}
        </button>
      );
    };
  },
});

/** @public */
export interface ParagraphStyleNamespace {
  (props: ParagraphStyleProps): VNode | null;
  readonly docxSlot: 'styles.style';
  readonly Trigger: typeof ParagraphStyleTrigger;
  readonly Content: typeof ParagraphStyleContent;
  readonly Item: typeof ParagraphStyleItem;
}

const ParagraphStyleRoot = defineComponent({
  name: 'ParagraphStyle',
  props: {
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const state = useParagraphStyle();
    const open = ref(false);
    const rootRef = ref<HTMLDivElement | null>(null);

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onMouseDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        open.value = false;
      };
      document.addEventListener('mousedown', onMouseDown);
      onCleanup(() => document.removeEventListener('mousedown', onMouseDown));
    });

    const context: ParagraphStyleContextValue = {
      ...state,
      open: computed(() => open.value),
      setOpen: (next) => {
        open.value = next;
      },
    };
    provide(ParagraphStyleContextKey, context);

    return () => {
      if (props.hidden) return null;
      const shared = {
        class: `docx-toolbar__style${props.className ? ` ${props.className}` : ''}`,
        'data-slot': 'styles.style',
        style: { position: 'relative' as const, display: 'inline-block' as const },
      };
      const body = slots.default?.() ?? [<ParagraphStyleTrigger />, <ParagraphStyleContent />];
      if (props.asChild) {
        return (
          <Slot {...shared} ref={rootRef}>
            {body}
          </Slot>
        );
      }
      return (
        <div ref={rootRef} {...shared}>
          {body}
        </div>
      );
    };
  },
});

export const ParagraphStyle = Object.assign(ParagraphStyleRoot, {
  docxSlot: 'styles.style' as const,
  Trigger: ParagraphStyleTrigger,
  Content: ParagraphStyleContent,
  Item: ParagraphStyleItem,
}) as unknown as ParagraphStyleNamespace;

export { useParagraphStyle, type ParagraphStyleOption, type UseParagraphStyleResult };
