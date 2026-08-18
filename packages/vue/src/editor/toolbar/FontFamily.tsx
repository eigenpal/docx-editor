import {
  computed,
  defineComponent,
  inject,
  provide,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type VNode,
} from 'vue';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';
import { Slot } from './Slot';
import { useFontFamily, type UseFontFamilyResult } from './useFontFamily';

const FONT_CATEGORY: ReadonlyMap<string, 'sansSerif' | 'serif' | 'monospace'> = new Map([
  ['arial', 'sansSerif'],
  ['calibri', 'sansSerif'],
  ['helvetica', 'sansSerif'],
  ['verdana', 'sansSerif'],
  ['open sans', 'sansSerif'],
  ['roboto', 'sansSerif'],
  ['times new roman', 'serif'],
  ['georgia', 'serif'],
  ['cambria', 'serif'],
  ['garamond', 'serif'],
  ['courier new', 'monospace'],
  ['consolas', 'monospace'],
]);

const FONT_GROUPS = [
  { category: 'sansSerif', labelKey: 'font.sansSerif' },
  { category: 'serif', labelKey: 'font.serif' },
  { category: 'monospace', labelKey: 'font.monospace' },
  { category: 'other', labelKey: null },
] as const;

interface FontFamilyContextValue extends UseFontFamilyResult {
  readonly open: ComputedRef<boolean>;
  readonly setOpen: (next: boolean) => void;
}

const FontFamilyContextKey: InjectionKey<FontFamilyContextValue> = Symbol('FontFamilyContext');

function useFontFamilyContext(): FontFamilyContextValue | null {
  return inject(FontFamilyContextKey, null);
}

/** @public */
export interface FontFamilyPartProps {
  asChild?: boolean;
  className?: string;
}

/** @public */
export interface FontFamilyProps extends FontFamilyPartProps {
  hidden?: boolean;
}

/** @public */
export interface FontFamilyItemProps extends FontFamilyPartProps {
  value: string;
}

const FontFamilyTrigger = defineComponent({
  name: 'FontFamilyTrigger',
  props: {
    asChild: { type: Boolean, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const context = useFontFamilyContext();
    const label = useToolbarLabel();
    return () => {
      if (!context) return null;
      const text = label(chromeControlForSlot('font.family')?.labelKey ?? 'font.family');
      const shared = {
        onClick: () => context.setOpen(!context.open.value),
        onMousedown: guardToolbarMousedown,
        disabled: !context.isEnabled.value,
        class: `docx-toolbar__font-family-trigger${props.className ? ` ${props.className}` : ''}`,
        ...(!context.isEnabled.value ? { 'data-disabled': '' } : {}),
        'aria-haspopup': 'listbox' as const,
        'aria-expanded': context.open.value,
        'aria-label': text,
        title: text,
      };
      const display = slots.default?.() ?? [<span>{context.value.value ?? '—'}</span>];
      if (props.asChild) return <Slot {...shared}>{display}</Slot>;
      return (
        <button type="button" {...shared}>
          {display}
        </button>
      );
    };
  },
});
(FontFamilyTrigger as { docxToolbarPart?: boolean }).docxToolbarPart = true;

const FontFamilyContent = defineComponent({
  name: 'FontFamilyContent',
  props: {
    asChild: { type: Boolean, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const context = useFontFamilyContext();
    const label = useToolbarLabel();
    return () => {
      if (!context || !context.open.value) return null;
      const shared = {
        role: 'listbox' as const,
        class: `docx-toolbar__menu docx-toolbar__font-family-content${props.className ? ` ${props.className}` : ''}`,
        style: {
          position: 'absolute' as const,
          top: '100%',
          left: 0,
          zIndex: 30,
          minWidth: '100%',
          maxHeight: 300,
          overflowY: 'auto' as const,
        },
      };
      let items: VNode[] | undefined;
      if (slots.default) {
        items = slots.default();
      } else {
        const grouped = FONT_GROUPS.map((group) => ({
          ...group,
          fonts: context.options.value.filter(
            (option) => (FONT_CATEGORY.get(option.toLowerCase()) ?? 'other') === group.category
          ),
        })).filter((group) => group.fonts.length > 0);
        items = grouped.flatMap((group, index) => {
          const nodes: VNode[] = [];
          if (index > 0) {
            nodes.push(<div class="docx-toolbar__menu-separator" role="separator" />);
          }
          if (group.labelKey) {
            nodes.push(<div class="docx-toolbar__menu-label">{label(group.labelKey)}</div>);
          }
          for (const option of group.fonts) {
            nodes.push(<FontFamilyItem key={option} value={option} />);
          }
          return nodes;
        });
      }
      if (props.asChild) return <Slot {...shared}>{items}</Slot>;
      return <div {...shared}>{items}</div>;
    };
  },
});

const FontFamilyItem = defineComponent({
  name: 'FontFamilyItem',
  props: {
    value: { type: String, required: true },
    asChild: { type: Boolean, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const context = useFontFamilyContext();
    return () => {
      if (!context) return null;
      const selected = context.value.value === props.value;
      const shared = {
        role: 'option' as const,
        'aria-selected': selected,
        ...(selected ? { 'data-selected': '' } : {}),
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          context.setValue(props.value);
          context.setOpen(false);
        },
        class: `docx-toolbar__font-family-item${props.className ? ` ${props.className}` : ''}`,
      };
      const display = slots.default?.() ?? [
        <span style={{ fontFamily: props.value }}>{props.value}</span>,
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
export interface FontFamilyNamespace {
  (props: FontFamilyProps): VNode | null;
  readonly docxSlot: 'font.family';
  readonly Trigger: typeof FontFamilyTrigger;
  readonly Content: typeof FontFamilyContent;
  readonly Item: typeof FontFamilyItem;
}

const FontFamilyRoot = defineComponent({
  name: 'FontFamily',
  props: {
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const state = useFontFamily();
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

    const context: FontFamilyContextValue = {
      ...state,
      open: computed(() => open.value),
      setOpen: (next) => {
        open.value = next;
      },
    };
    provide(FontFamilyContextKey, context);

    return () => {
      if (props.hidden) return null;
      const shared = {
        class: `docx-toolbar__font-family${props.className ? ` ${props.className}` : ''}`,
        'data-slot': 'font.family',
        style: { position: 'relative' as const, display: 'inline-block' as const },
      };
      const body = slots.default?.() ?? [<FontFamilyTrigger />, <FontFamilyContent />];
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

export const FontFamily = Object.assign(FontFamilyRoot, {
  docxSlot: 'font.family' as const,
  Trigger: FontFamilyTrigger,
  Content: FontFamilyContent,
  Item: FontFamilyItem,
}) as unknown as FontFamilyNamespace;

export { useFontFamily, type UseFontFamilyResult };
