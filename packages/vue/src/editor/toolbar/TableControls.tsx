import {
  defineComponent,
  Fragment,
  h,
  inject,
  provide,
  ref,
  type ComputedRef,
  type InjectionKey,
  type PropType,
  type Ref,
  type VNode,
} from 'vue';
import type { TableBorderStyle } from '@docx-editor.dev/core/contracts/editor';
import type { TableChromeDraft } from '@docx-editor.dev/core/editor';
import {
  TABLE_BORDER_STYLE_OPTIONS,
  TABLE_BORDER_TARGET_OPTIONS,
  TABLE_BORDER_WIDTH_OPTIONS,
  tableChromeIconPaths,
  type TableBorderTargetValue,
  type TableChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartComponent } from './parts';
import { ToolbarSeparator } from './parts';
import { Slot } from './Slot';
import { ToolbarHexColorPickerBody } from './ColorSplit';
import { useTableChromeProviderVisible, useTableChromeSlot } from './useTableChrome';
import {
  useDropdownClose,
  useTableChromeTriggerA11y,
  useTableDialogKeyboard,
  useTableMenuKeyboard,
  restoreToolbarDocumentFocus,
} from './table-chrome-shared';
import { useTableBorderTargetLabel } from './useTableBorderTargetLabel';

function cssHexColor(raw: string, fallback: string): string {
  const hex = raw.replace(/^#/, '').trim();
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : `#${fallback.toLowerCase()}`;
}

function triggerKeyboardToggle(
  enabled: boolean,
  open: boolean,
  setOpen: (open: boolean) => void
): ((event: KeyboardEvent) => void) | undefined {
  if (!enabled) return undefined;
  return (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(!open);
    }
  };
}

/** @public */
export interface TableChromePartProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
}

/** @public */
export interface TableChromeItemProps extends TableChromePartProps {
  value: string;
}

import type { DocxEditorChildren } from '../../docx-editor-children';

/** @public */
export interface TableChromePartComponent extends ToolbarSlotPartComponent {
  readonly docxSlot: TableChromeSlotId;
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/** @public */
export interface TableBorderTargetNamespace extends TableChromePartComponent {
  readonly docxSlot: 'table.borderTarget';
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/** @public */
export interface TableBorderColorNamespace extends TableChromePartComponent {
  readonly docxSlot: 'table.borderColor';
  readonly Main: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/** @public */
export interface TableCellFillNamespace extends TableChromePartComponent {
  readonly docxSlot: 'table.cellFill';
  readonly Main: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/** @public */
export interface TableBorderStyleNamespace extends TableChromePartComponent {
  readonly docxSlot: 'table.borderStyle';
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

/** @public */
export interface TableBorderWidthNamespace extends TableChromePartComponent {
  readonly docxSlot: 'table.borderWidth';
  readonly Trigger: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Content: (props: TableChromePartProps) => DocxEditorChildren;
  readonly Item: (props: TableChromeItemProps) => DocxEditorChildren;
}

interface TableSlotContextValue {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly apply: (value: unknown) => void;
  readonly draft: ComputedRef<TableChromeDraft>;
  readonly triggerRef: Ref<HTMLButtonElement | null>;
  readonly lastHex?: string;
  readonly setLastHex?: (hex: string) => void;
}

function tableIcon(name: Parameters<typeof tableChromeIconPaths>[0]): VNode {
  return chromeIcon(tableChromeIconPaths(name))!;
}

function buildMenuCompound(slot: TableChromeSlotId, classBase: string, defaultLabelKey: string) {
  const CtxKey: InjectionKey<TableSlotContextValue> = Symbol(`table-menu-${slot}`);

  const Root = defineComponent({
    name: `TableChromeRoot_${slot}`,
    props: {
      className: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
      asChild: { type: Boolean, default: undefined },
    },
    setup(props, { slots }) {
      const chrome = useTableChromeSlot(slot);
      const open = ref(false);
      const rootRef = ref<HTMLDivElement | null>(null);
      const triggerRef = ref<HTMLButtonElement | null>(null);
      const setOpen = (v: boolean) => {
        open.value = v;
      };
      useDropdownClose(open, setOpen, rootRef);

      provide(CtxKey, {
        get open() {
          return open.value;
        },
        setOpen,
        get enabled() {
          return chrome.enabled.value;
        },
        get disabledReason() {
          return chrome.disabledReason.value;
        },
        apply: chrome.apply,
        draft: chrome.draft,
        triggerRef,
      });

      return () => {
        if (props.hidden || !chrome.visible.value) return null;
        const shared = {
          class: `${classBase}${props.className ? ` ${props.className}` : ''}`,
          'data-slot': slot,
          style: {
            position: 'relative' as const,
            display: 'inline-flex' as const,
            alignItems: 'center' as const,
            verticalAlign: 'middle' as const,
          },
        };
        const body = slots.default?.() ?? [<Trigger />, <Content />];
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

  const Trigger = defineComponent({
    name: `TableChromeTrigger_${slot}`,
    props: {
      className: { type: String, default: undefined },
      asChild: { type: Boolean, default: undefined },
    },
    setup(props, { slots }) {
      const ctx = inject(CtxKey)!;
      const label = useToolbarLabel();
      const control = chromeControlForSlot(slot);
      const text = label(control?.labelKey ?? defaultLabelKey);
      return () => {
        const { shared, reasonNode } = useTableChromeTriggerA11y({
          enabled: ctx.enabled,
          disabledReason: ctx.disabledReason,
          ariaLabel: text,
        });
        const btnProps = {
          ...shared,
          ref: ctx.triggerRef,
          class: `docx-toolbar__button docx-table-chrome__trigger${props.className ? ` ${props.className}` : ''}`,
          'aria-haspopup': 'menu' as const,
          'aria-expanded': ctx.open,
          onClick: ctx.enabled ? () => ctx.setOpen(!ctx.open) : undefined,
          ...(props.asChild
            ? {
                tabIndex: ctx.enabled ? 0 : -1,
                role: 'button' as const,
                onKeydown: triggerKeyboardToggle(ctx.enabled, ctx.open, ctx.setOpen),
              }
            : {}),
        };
        const display = slots.default?.() ?? [
          chromeIcon(control?.paths),
          <span class="docx-toolbar__picker-caret" aria-hidden="true">
            ▾
          </span>,
        ];
        if (props.asChild) {
          return (
            <>
              <Slot {...btnProps}>{display}</Slot>
              {reasonNode}
            </>
          );
        }
        return (
          <button {...btnProps}>
            {display}
            {reasonNode}
          </button>
        );
      };
    },
  });
  (Trigger as { docxToolbarPart?: boolean }).docxToolbarPart = true;

  const Content = defineComponent({
    name: `TableChromeContent_${slot}`,
    props: {
      className: { type: String, default: undefined },
      asChild: { type: Boolean, default: undefined },
    },
    setup(props, { slots }) {
      const ctx = inject(CtxKey)!;
      const label = useToolbarLabel();
      const panelRef = ref<HTMLDivElement | null>(null);
      useTableMenuKeyboard(() => ctx.open && ctx.enabled, ctx.setOpen, panelRef, ctx.triggerRef);
      return () => {
        if (!ctx.open || !ctx.enabled) return null;
        const control = chromeControlForSlot(slot);
        const text = label(control?.labelKey ?? defaultLabelKey);
        const shared = {
          ref: panelRef,
          role: 'menu' as const,
          'aria-label': text,
          class: `docx-table-chrome__panel${props.className ? ` ${props.className}` : ''}`,
          onMousedown: guardToolbarMousedown,
        };
        if (props.asChild) return <Slot {...shared}>{slots.default?.()}</Slot>;
        return <div {...shared}>{slots.default?.()}</div>;
      };
    },
  });

  return { Root, Trigger, Content, CtxKey };
}

const targetCompound = buildMenuCompound(
  'table.borderTarget',
  'docx-table-chrome docx-table-chrome--target',
  'table.borders.tooltip'
);

const TableBorderTargetItem = defineComponent({
  name: 'TableBorderTargetItem',
  props: {
    value: { type: String, required: true },
    className: { type: String, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const ctx = inject(targetCompound.CtxKey)!;
    const label = useToolbarLabel();
    return () => {
      const option = TABLE_BORDER_TARGET_OPTIONS.find((entry) => entry.value === props.value);
      if (!option) return null;
      const selected =
        option.value === 'none' ? false : option.value === ctx.draft.value.activeTarget;
      const shared = {
        type: 'button' as const,
        role: 'menuitemradio' as const,
        'aria-checked': selected,
        'data-value': option.value,
        class: `docx-table-chrome__target-btn${props.className ? ` ${props.className}` : ''}`,
        ...(selected ? { 'data-active': '' } : {}),
        'aria-label': label(option.labelKey),
        title: label(option.labelKey),
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          ctx.setOpen(false);
          ctx.apply(option.value satisfies TableBorderTargetValue);
        },
      };
      const display = slots.default?.() ?? [tableIcon(option.icon)];
      if (props.asChild) return <Slot {...shared}>{display}</Slot>;
      return <button {...shared}>{display}</button>;
    };
  },
});

const TableBorderTargetContent = defineComponent({
  name: 'TableBorderTargetContent',
  setup(_, { slots }) {
    return () => (
      <targetCompound.Content>
        {slots.default?.() ?? (
          <div class="docx-table-chrome__target-grid">
            {TABLE_BORDER_TARGET_OPTIONS.map((option) => (
              <TableBorderTargetItem key={option.value} value={option.value} />
            ))}
          </div>
        )}
      </targetCompound.Content>
    );
  },
});

const TableBorderTargetRoot = defineComponent({
  name: 'ToolbarTableBorderTarget',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    return () => (
      <targetCompound.Root {...props}>
        {slots.default?.() ?? [<targetCompound.Trigger />, <TableBorderTargetContent />]}
      </targetCompound.Root>
    );
  },
});

/** @public */
export const ToolbarTableBorderTarget = Object.assign(TableBorderTargetRoot, {
  docxSlot: 'table.borderTarget' as const,
  Trigger: targetCompound.Trigger,
  Content: TableBorderTargetContent,
  Item: TableBorderTargetItem,
}) as unknown as TableBorderTargetNamespace;

const styleCompound = buildMenuCompound(
  'table.borderStyle',
  'docx-table-chrome docx-table-chrome--style',
  'table.borders.styleAriaLabel'
);

const TableBorderStyleItem = defineComponent({
  name: 'TableBorderStyleItem',
  props: { value: { type: String, required: true }, className: String, asChild: Boolean },
  setup(props, { slots }) {
    const ctx = inject(styleCompound.CtxKey)!;
    const label = useToolbarLabel();
    return () => {
      const option = TABLE_BORDER_STYLE_OPTIONS.find((entry) => entry.value === props.value);
      if (!option) return null;
      const selected = option.value === ctx.draft.value.spec.style;
      const shared = {
        type: 'button' as const,
        role: 'menuitemradio' as const,
        'aria-checked': selected,
        ...(selected ? { 'data-selected': '' } : {}),
        class: `docx-table-chrome__width-row${props.className ? ` ${props.className}` : ''}`,
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          ctx.setOpen(false);
          ctx.apply(option.value satisfies TableBorderStyle);
        },
      };
      const display = slots.default?.() ?? [
        <span class={`docx-table-line ${option.previewClass}`} aria-hidden="true" />,
        <span>{label(option.labelKey)}</span>,
      ];
      if (props.asChild) return <Slot {...shared}>{display}</Slot>;
      return <button {...shared}>{display}</button>;
    };
  },
});

/** @public */
export const ToolbarTableBorderStyle = Object.assign(
  defineComponent({
    name: 'ToolbarTableBorderStyle',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      return () => (
        <styleCompound.Root {...props}>
          {slots.default?.() ?? [
            <styleCompound.Trigger />,
            <styleCompound.Content>
              {TABLE_BORDER_STYLE_OPTIONS.map((option) => (
                <TableBorderStyleItem key={option.value} value={option.value} />
              ))}
            </styleCompound.Content>,
          ]}
        </styleCompound.Root>
      );
    },
  }),
  {
    docxSlot: 'table.borderStyle' as const,
    Trigger: styleCompound.Trigger,
    Content: styleCompound.Content,
    Item: TableBorderStyleItem,
  }
) as unknown as TableBorderStyleNamespace;

const widthCompound = buildMenuCompound(
  'table.borderWidth',
  'docx-table-chrome docx-table-chrome--width',
  'table.borderWidth'
);

const TableBorderWidthItem = defineComponent({
  name: 'TableBorderWidthItem',
  props: { value: { type: String, required: true }, className: String, asChild: Boolean },
  setup(props, { slots }) {
    const ctx = inject(widthCompound.CtxKey)!;
    const label = useToolbarLabel();
    return () => {
      const size = Number(props.value);
      const option = TABLE_BORDER_WIDTH_OPTIONS.find((entry) => entry.size === size);
      if (!option) return null;
      const selected = option.size === ctx.draft.value.spec.size;
      const shared = {
        type: 'button' as const,
        role: 'menuitemradio' as const,
        'aria-checked': selected,
        ...(selected ? { 'data-selected': '' } : {}),
        class: `docx-table-chrome__width-row${props.className ? ` ${props.className}` : ''}`,
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          ctx.setOpen(false);
          ctx.apply(option.size);
        },
      };
      const display = slots.default?.() ?? [
        <span
          class="docx-table-line docx-table-line--single"
          style={{ height: `${option.previewThickness}px` }}
          aria-hidden="true"
        />,
        <span>{label(option.labelKey)}</span>,
      ];
      if (props.asChild) return <Slot {...shared}>{display}</Slot>;
      return <button {...shared}>{display}</button>;
    };
  },
});

/** @public */
export const ToolbarTableBorderWidth = Object.assign(
  defineComponent({
    name: 'ToolbarTableBorderWidth',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      return () => (
        <widthCompound.Root {...props}>
          {slots.default?.() ?? [
            <widthCompound.Trigger />,
            <widthCompound.Content>
              {TABLE_BORDER_WIDTH_OPTIONS.map((option) => (
                <TableBorderWidthItem key={option.size} value={String(option.size)} />
              ))}
            </widthCompound.Content>,
          ]}
        </widthCompound.Root>
      );
    },
  }),
  {
    docxSlot: 'table.borderWidth' as const,
    Trigger: widthCompound.Trigger,
    Content: widthCompound.Content,
    Item: TableBorderWidthItem,
  }
) as unknown as TableBorderWidthNamespace;

function buildColorSplitCompound(
  slot: 'table.borderColor' | 'table.cellFill',
  defaultLabelKey: string,
  options?: { clearFill?: boolean; defaultHex?: string }
) {
  const defaultHex = options?.defaultHex ?? 'FF0000';
  const CtxKey: InjectionKey<TableSlotContextValue> = Symbol(`table-color-${slot}`);

  const Root = defineComponent({
    name: `TableColorRoot_${slot}`,
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      const chrome = useTableChromeSlot(slot);
      const open = ref(false);
      const lastHex = ref(defaultHex);
      const rootRef = ref<HTMLDivElement | null>(null);
      const triggerRef = ref<HTMLButtonElement | null>(null);
      const setOpen = (v: boolean) => {
        open.value = v;
      };
      const setLastHex = (v: string) => {
        lastHex.value = v;
      };
      useDropdownClose(open, setOpen, rootRef);
      provide(CtxKey, {
        get open() {
          return open.value;
        },
        setOpen,
        get enabled() {
          return chrome.enabled.value;
        },
        get disabledReason() {
          return chrome.disabledReason.value;
        },
        apply: chrome.apply,
        draft: chrome.draft,
        triggerRef,
        get lastHex() {
          return lastHex.value;
        },
        setLastHex,
      });
      return () => {
        if (props.hidden || !chrome.visible.value) return null;
        const shared = {
          class: `docx-toolbar__colorsplit docx-table-chrome${props.className ? ` ${props.className}` : ''}`,
          'data-slot': slot,
          style: {
            position: 'relative' as const,
            display: 'inline-flex' as const,
            alignItems: 'center' as const,
            verticalAlign: 'middle' as const,
          },
        };
        const body = slots.default?.() ?? [
          <Main />,
          <Trigger />,
          <Content clearFill={options?.clearFill ?? false} />,
        ];
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

  const Main = defineComponent({
    name: `TableColorMain_${slot}`,
    props: { className: String, asChild: Boolean },
    setup(props, { slots }) {
      const ctx = inject(CtxKey)!;
      const label = useToolbarLabel();
      const control = chromeControlForSlot(slot);
      const text = label(control?.labelKey ?? defaultLabelKey);
      return () => {
        const { shared, reasonNode } = useTableChromeTriggerA11y({
          enabled: ctx.enabled,
          disabledReason: ctx.disabledReason,
          ariaLabel: text,
        });
        const barHex =
          slot === 'table.borderColor' && ctx.draft.value.spec.color.kind === 'hex'
            ? ctx.draft.value.spec.color.value
            : (ctx.lastHex ?? defaultHex);
        const btnProps = {
          ...shared,
          class: `docx-toolbar__button docx-toolbar__colorsplit-main${props.className ? ` ${props.className}` : ''}`,
          onClick: ctx.enabled ? () => ctx.apply({ kind: 'hex', value: barHex }) : undefined,
        };
        const display = slots.default?.() ?? [
          chromeIcon(control?.paths),
          <span
            class="docx-toolbar__colorsplit-bar"
            style={{ backgroundColor: cssHexColor(barHex, defaultHex) }}
            aria-hidden="true"
          />,
        ];
        if (props.asChild) {
          return (
            <>
              <Slot {...btnProps}>{display}</Slot>
              {reasonNode}
            </>
          );
        }
        return (
          <button {...btnProps}>
            {display}
            {reasonNode}
          </button>
        );
      };
    },
  });
  (Main as { docxToolbarPart?: boolean }).docxToolbarPart = true;

  const Trigger = defineComponent({
    name: `TableColorTrigger_${slot}`,
    props: { className: String, asChild: Boolean },
    setup(props, { slots }) {
      const ctx = inject(CtxKey)!;
      const label = useToolbarLabel();
      const text = label(defaultLabelKey);
      return () => {
        const { shared, reasonNode } = useTableChromeTriggerA11y({
          enabled: ctx.enabled,
          disabledReason: ctx.disabledReason,
          ariaLabel: text,
        });
        const btnProps = {
          ...shared,
          ref: ctx.triggerRef,
          class: `docx-toolbar__colorsplit-caret${props.className ? ` ${props.className}` : ''}`,
          'aria-haspopup': 'dialog' as const,
          'aria-expanded': ctx.open,
          onClick: ctx.enabled ? () => ctx.setOpen(!ctx.open) : undefined,
        };
        const display = slots.default?.() ?? '▾';
        if (props.asChild) {
          return (
            <>
              <Slot {...btnProps}>{display}</Slot>
              {reasonNode}
            </>
          );
        }
        return (
          <button {...btnProps}>
            {display}
            {reasonNode}
          </button>
        );
      };
    },
  });
  (Trigger as { docxToolbarPart?: boolean }).docxToolbarPart = true;

  const Content = defineComponent({
    name: `TableColorContent_${slot}`,
    props: { className: String, asChild: Boolean, clearFill: { type: Boolean, required: true } },
    setup(props, { slots }) {
      const ctx = inject(CtxKey)!;
      const label = useToolbarLabel();
      const dialogRef = ref<HTMLDivElement | null>(null);
      useTableDialogKeyboard(() => ctx.open && ctx.enabled, ctx.setOpen, dialogRef, ctx.triggerRef);
      return () => {
        if (!ctx.open || !ctx.enabled) return null;
        const text = label(defaultLabelKey);
        const pickerCurrent =
          slot === 'table.borderColor' && ctx.draft.value.spec.color.kind === 'hex'
            ? ctx.draft.value.spec.color.value
            : (ctx.lastHex ?? defaultHex);
        const shared = {
          ref: dialogRef,
          role: 'dialog' as const,
          'aria-label': text,
          class: `docx-toolbar__swatch-popup docx-table-chrome__panel${props.className ? ` ${props.className}` : ''}`,
          onMousedown: guardToolbarMousedown,
        };
        const body = slots.default?.() ?? (
          <>
            {props.clearFill ? (
              <button
                type="button"
                class="docx-toolbar__swatch-clear"
                onMousedown={guardToolbarMousedown}
                onClick={() => {
                  ctx.setOpen(false);
                  ctx.apply(null);
                  restoreToolbarDocumentFocus(ctx.triggerRef.value);
                }}
              >
                <span
                  class="docx-toolbar__swatch-clear-chip docx-toolbar__swatch-clear-chip--none"
                  aria-hidden="true"
                />
                {label('table.clearCellFill')}
              </button>
            ) : null}
            <ToolbarHexColorPickerBody
              apply={(hex) => {
                ctx.setOpen(false);
                ctx.setLastHex?.(hex);
                ctx.apply({ kind: 'hex', value: hex });
                restoreToolbarDocumentFocus(ctx.triggerRef.value);
              }}
              current={pickerCurrent}
            />
          </>
        );
        if (props.asChild) return <Slot {...shared}>{body}</Slot>;
        return <div {...shared}>{body}</div>;
      };
    },
  });

  return { Root, Main, Trigger, Content, CtxKey };
}

const borderColorCompound = buildColorSplitCompound('table.borderColor', 'table.borderColor', {
  defaultHex: '000000',
});

/** @public */
export const ToolbarTableBorderColor = Object.assign(
  defineComponent({
    name: 'ToolbarTableBorderColor',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      return () => (
        <borderColorCompound.Root {...props}>
          {slots.default?.() ?? [
            <borderColorCompound.Main />,
            <borderColorCompound.Trigger />,
            <borderColorCompound.Content clearFill={false} />,
          ]}
        </borderColorCompound.Root>
      );
    },
  }),
  {
    docxSlot: 'table.borderColor' as const,
    Trigger: borderColorCompound.Trigger,
    Content: borderColorCompound.Content,
    Item: defineComponent({ setup: () => () => null }),
    Main: borderColorCompound.Main,
  }
) as unknown as TableBorderColorNamespace;

const fillCompound = buildColorSplitCompound('table.cellFill', 'table.cellFillColor', {
  clearFill: true,
  defaultHex: 'FFFF00',
});

/** @public */
export const ToolbarTableCellFill = Object.assign(
  defineComponent({
    name: 'ToolbarTableCellFill',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      return () => (
        <fillCompound.Root {...props}>
          {slots.default?.() ?? [
            <fillCompound.Main />,
            <fillCompound.Trigger />,
            <fillCompound.Content clearFill={true} />,
          ]}
        </fillCompound.Root>
      );
    },
  }),
  {
    docxSlot: 'table.cellFill' as const,
    Trigger: fillCompound.Trigger,
    Content: fillCompound.Content,
    Item: defineComponent({ setup: () => () => null }),
    Main: fillCompound.Main,
  }
) as unknown as TableCellFillNamespace;

/** @public */
export { useTableBorderTargetLabel };

/** @internal */
export const TableChromeGroup = defineComponent({
  name: 'TableChromeGroup',
  props: {
    overrides: {
      type: Object as PropType<Map<string, VNode>>,
      default: () => new Map(),
    },
    separator: { type: Boolean, default: true },
  },
  setup(props) {
    const visible = useTableChromeProviderVisible();
    return () => {
      if (!visible.value) return null;
      const entries = [
        ToolbarTableBorderTarget,
        ToolbarTableBorderColor,
        ToolbarTableBorderStyle,
        ToolbarTableBorderWidth,
        ToolbarTableCellFill,
      ];
      return (
        <>
          {props.separator ? <ToolbarSeparator /> : null}
          {entries.map((Part) => {
            const override = props.overrides.get(Part.docxSlot);
            if (override) return <Fragment key={Part.docxSlot}>{override}</Fragment>;
            return h(Part, { key: Part.docxSlot });
          })}
        </>
      );
    };
  },
});
