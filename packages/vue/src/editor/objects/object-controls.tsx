// The building blocks of the shape and chart parts: `useObjectControl`, which binds one
// `shape.*` or `chart.*` slot to its live state, and the field shapes every part renders as (a
// colour, a list, a text field, a toggle). A part works in a toolbar, a menu, a popover, a
// drawer, or a pane. `variant="field"` shows a visible label and the disabled reason under the
// control; `variant="compact"` keeps the label for screen readers only and puts the reason in
// the tooltip, for a toolbar. Enabled state, the disabled reason, and the value come only from
// `toolbarCommandState`; a change runs `runToolbarCommand`. The React twin is
// `packages/react/src/editor/objects/object-controls.tsx`; both render the same markup.

import {
  computed,
  defineComponent,
  inject,
  provide,
  type ComputedRef,
  type InjectionKey,
  type PropType,
  type VNodeChild,
} from 'vue';
import {
  CHROME_GROUPS,
  chartSlotIsToggle,
  chromeSlotId,
  objectSlotOptions,
  objectSlotValue,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
  type ColorPick,
  type ObjectSlotReadValueMap,
  type ObjectSlotValueMap,
  type ObjectToggleSlotId,
  type ToolbarCommandState,
} from '@docx-editor.dev/core/editor';
import type { EditorExecOptions, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useStableDocxId } from '../../lib/stable-id';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useChromeScopeClassName } from '../color-mode-context';
import { ScopedByAncestorContext } from '../scope-context';
import { chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { ChartField } from '../charts/chart-fields';
import { ColorPicker, type ColorPickerValue } from '../color/ColorPicker';

/** A `shape.*` or `chart.*` slot. @public */
export type ObjectSlotId = keyof ObjectSlotValueMap;

/** How a part renders: with a visible label (`field`), or as a toolbar control (`compact`). @public */
export type ObjectControlVariant = 'field' | 'compact';

/**
 * The variant a part takes when its own `variant` prop is absent. `DocxEditorToolbar` provides
 * `compact`, so a part placed in the toolbar renders as a toolbar control.
 */
export const ObjectControlVariantContext: InjectionKey<ObjectControlVariant> = Symbol(
  'ObjectControlVariantContext'
);

/** The variant of a part: its own prop, else the one its container provides. */
export function useObjectControlVariant(
  variant: () => ObjectControlVariant | undefined
): () => ObjectControlVariant {
  const inherited = inject(ObjectControlVariantContext, 'field');
  return () => variant() ?? inherited;
}

/**
 * The scope class of a part's root, read while rendering, and the scoped flag for what the part
 * renders inside it. A part placed outside every scoped element (a host toolbar beside `Root`)
 * carries the scope itself, so the chrome tokens, dark mode, and the popover position apply.
 */
export function usePartScope(): () => string {
  const scope = useChromeScopeClassName();
  provide(ScopedByAncestorContext, true);
  return scope;
}

/** The props every shape and chart part takes. @public */
export interface ObjectControlProps {
  /** A class name added to the part's root. */
  className?: string;
  /** Replaces the label, which defaults to the slot's translated name. */
  label?: string;
  /** Default `field`, or `compact` inside `DocxEditorToolbar`. */
  variant?: ObjectControlVariant;
  /** Renders nothing, so a toolbar override can remove the slot. */
  hidden?: boolean;
}

/**
 * The props of a part whose control is a button: the colour parts and the toggle parts. With
 * `asChild`, the one child of the default slot becomes the button. @public
 */
export interface ObjectButtonPartProps extends ObjectControlProps {
  /** Replaces the slot's icon in the compact variant. */
  icon?: DocxEditorChildren;
  /** Renders the one child of the default slot as the button, with the part's props merged in. */
  asChild?: boolean;
  /** With `asChild`, the element that becomes the button. Pass it in the default slot. */
  children?: DocxEditorChildren;
}

/** The runtime props of `ObjectControlProps`, shared by every part. @internal */
export const objectControlProps = {
  className: { type: String, default: undefined },
  label: { type: String, default: undefined },
  variant: { type: String as PropType<ObjectControlVariant>, default: undefined },
  hidden: { type: Boolean, default: false },
} as const;

/** The runtime props of `ObjectButtonPartProps`. @internal */
export const objectButtonPartProps = {
  ...objectControlProps,
  icon: { type: null as unknown as PropType<DocxEditorChildren>, default: undefined },
  asChild: { type: Boolean, default: false },
} as const;

/** What `useObjectControl` returns for every slot. @public */
export interface ObjectControlState<K extends ObjectSlotId> {
  readonly slotId: K;
  /** The slot's translated name. */
  readonly label: ComputedRef<string>;
  /**
   * The value the object shows now, typed for the slot, or null when nothing is selected, the
   * object shows several values, or the slot has no single value (`chart.seriesColor`,
   * `chart.data`).
   */
  readonly value: ComputedRef<ObjectSlotReadValueMap[K] | null>;
  /** The values a list slot offers, in list order; empty for other slots. */
  readonly options: ComputedRef<readonly ObjectSlotValueMap[K][]>;
  /** Whether a toggle is on, or whether the object shows the property. */
  readonly isActive: ComputedRef<boolean>;
  readonly isEnabled: ComputedRef<boolean>;
  /** Why the control is disabled, translated, or null. */
  readonly disabledReason: ComputedRef<string | null>;
  /** Run the slot with `value`, as `runToolbarCommand` does. */
  readonly execute: (value: ObjectSlotValueMap[K], options?: EditorExecOptions) => ExecResult;
}

/** The member a toggle slot adds: a run with no value turns the element on or off. @public */
export interface ObjectToggleControl {
  readonly toggle: (options?: EditorExecOptions) => ExecResult;
}

/**
 * What `useObjectControl` returns: the state and `execute`, and `toggle` for the toggle slots
 * (`chart.dataLabels`, `chart.axes`, `chart.gridlines`). @public
 */
export type UseObjectControlReturn<K extends ObjectSlotId> = ObjectControlState<K> &
  (K extends ObjectToggleSlotId ? ObjectToggleControl : unknown);

const sameState = (a: ToolbarCommandState, b: ToolbarCommandState) =>
  a.value === b.value &&
  a.enabled === b.enabled &&
  a.active === b.active &&
  a.disabledReason === b.disabledReason;

const LABEL_KEYS = new Map<string, string>(
  CHROME_GROUPS.flatMap((group) =>
    group.controls.map((control) => [chromeSlotId(group, control), control.labelKey] as const)
  )
);
const ICONS = new Map<string, readonly string[] | null>(
  CHROME_GROUPS.flatMap((group) =>
    group.controls.map((control) => [chromeSlotId(group, control), control.paths] as const)
  )
);

/** What the parts read: the public control, the value as text, and a run with its refusal. */
interface ObjectSlotBinding<K extends ObjectSlotId> {
  readonly control: UseObjectControlReturn<K>;
  /** The value as the toolbar state carries it, or empty text. */
  readonly text: ComputedRef<string>;
  /** Run the slot with any value it reads; the refusal translated, or null when it applied. */
  readonly apply: (value: unknown) => string | null;
}

/** The binding of one slot, shared by `useObjectControl` and the parts. */
export function useObjectSlot<K extends ObjectSlotId>(slotId: K): ObjectSlotBinding<K> {
  const editorRef = useDocxEditor();
  const { t } = useTranslation();
  const state = useEditorState(() => toolbarCommandState(editorRef.value, slotId), sameState);
  const run = (value: unknown, options?: EditorExecOptions): ExecResult =>
    runToolbarCommand(editorRef.value, slotId as ChromeSlotId as never, value as never, options);
  const control = {
    slotId,
    label: computed(() => t((LABEL_KEYS.get(slotId) ?? slotId) as TranslationKey)),
    value: computed(() => objectSlotValue(slotId, state.value.value)),
    options: computed(() => objectSlotOptions(slotId)),
    isActive: computed(() => state.value.active),
    isEnabled: computed(() => state.value.enabled),
    disabledReason: computed(() => localizeDisabledReason(state.value.disabledReason, t)),
    execute: (value: ObjectSlotValueMap[K], options?: EditorExecOptions) => run(value, options),
    ...(chartSlotIsToggle(slotId)
      ? { toggle: (options?: EditorExecOptions) => run(undefined, options) }
      : {}),
  } as unknown as UseObjectControlReturn<K>;
  return {
    control,
    text: computed(() => state.value.value ?? ''),
    apply: (value: unknown) => {
      const result = run(value);
      return result.ok ? null : (localizeDisabledReason(result.reason, t) ?? '');
    },
  };
}

/**
 * Bind one `shape.*` or `chart.*` slot: its typed value, the values a list offers, the enabled
 * state, the translated reason, and `execute`. Use it to build a control the packaged parts do
 * not cover. @public
 */
export function useObjectControl<K extends ObjectSlotId>(slotId: K): UseObjectControlReturn<K> {
  return useObjectSlot(slotId).control;
}

/** A part component: it renders one slot, and `docxSlot` names the slot for toolbar overrides. @public */
export type ObjectPartComponent<C, S extends ObjectSlotId> = C & { readonly docxSlot: S };

/** Mark a part with its slot, so `DocxEditorToolbar` replaces that slot with it. */
export function objectPart<C extends object, S extends ObjectSlotId>(
  slot: S,
  component: C
): ObjectPartComponent<C, S> {
  return Object.assign(component, { docxSlot: slot });
}

/** Attributes a part passes through to a compound part, such as a trigger's `title`. */
export const passAttrs = (attrs: Record<string, string | undefined>): Record<string, unknown> =>
  attrs;

/** The root of a part: its label, its control, and the disabled reason of a field. */
export function objectControlFrame(
  props: {
    slotId: ObjectSlotId;
    variant: ObjectControlVariant;
    className: string | undefined;
    reason: string | null;
    reasonId: string;
    active?: boolean;
    /** The scope class from `usePartScope`. */
    scope: string;
  },
  children: VNodeChild
): VNodeChild {
  const { variant, reason } = props;
  return (
    <div
      class={`${props.scope}docx-object-control docx-object-control--${variant}${props.className ? ` ${props.className}` : ''}`}
      data-slot={props.slotId}
      data-active={props.active ? '' : undefined}
      data-disabled={reason !== null ? '' : undefined}
      title={variant === 'compact' ? (reason ?? undefined) : undefined}
      onMousedown={variant === 'compact' ? guardToolbarMousedown : undefined}
    >
      {children}
      {reason !== null && variant === 'field' ? (
        <p class="docx-chart-pane__note" id={props.reasonId}>
          {reason}
        </p>
      ) : null}
    </div>
  );
}

/** A colour part: a trigger that names the colour, and the shared grid. */
export const ColorControl = defineComponent({
  name: 'ObjectColorControl',
  props: {
    ...objectButtonPartProps,
    slotId: { type: String as PropType<'shape.fill' | 'shape.outlineColor'>, required: true },
    /** What the trigger says: the colour's name, No fill, Gradient. */
    summary: { type: String, required: true },
    noneLabel: { type: String, required: true },
    /** Text under the control in a field, such as a note about a fill it cannot show. */
    after: { type: null as unknown as PropType<VNodeChild>, default: null },
  },
  setup(props, { slots }) {
    const { control, text, apply } = useObjectSlot(props.slotId);
    const reasonId = useStableDocxId('object-reason');
    const labelId = useStableDocxId('object-label');
    const variantOf = useObjectControlVariant(() => props.variant);
    const scope = usePartScope();
    return () => {
      if (props.hidden) return null;
      const variant = variantOf();
      const label = props.label ?? control.label.value;
      const raw = text.value;
      const value: ColorPickerValue = raw === '' ? null : (raw as ColorPick);
      const reason = control.disabledReason.value;
      return objectControlFrame(
        {
          slotId: props.slotId,
          variant,
          className: props.className,
          reason,
          reasonId,
          scope: scope(),
        },
        [
          <ColorPicker.Root
            value={value}
            disabled={!control.isEnabled.value}
            onPick={(pick: ColorPick | 'none') => apply(pick)}
          >
            {{
              default: () => [
                <span
                  class={`docx-chart-pane__label${variant === 'compact' ? ' docx-editor-sr-only' : ''}`}
                  id={labelId}
                >
                  {label}
                </span>,
                <ColorPicker.Trigger
                  asChild={props.asChild}
                  aria-labelledby={labelId}
                  aria-describedby={reason !== null && variant === 'field' ? reasonId : undefined}
                  {...passAttrs({
                    title: variant === 'compact' ? `${label}: ${props.summary}` : undefined,
                  })}
                >
                  {{
                    default: () =>
                      props.asChild
                        ? slots.default?.()
                        : [
                            variant === 'compact' ? (
                              <span class="docx-object-control__icon" aria-hidden="true">
                                {props.icon ?? chromeIcon(ICONS.get(props.slotId))}
                              </span>
                            ) : null,
                            <span class="docx-color-picker__summary docx-shape-pane__summary">
                              {props.summary}
                            </span>,
                          ],
                  }}
                </ColorPicker.Trigger>,
                <ColorPicker.Content aria-label={label}>
                  {{
                    default: () => [
                      <ColorPicker.NoColor>
                        {{ default: () => props.noneLabel }}
                      </ColorPicker.NoColor>,
                      <ColorPicker.Grid />,
                      <ColorPicker.HexInput />,
                    ],
                  }}
                </ColorPicker.Content>,
              ],
            }}
          </ColorPicker.Root>,
          variant === 'field' ? props.after : null,
        ]
      );
    };
  },
});

/** A list part. `other` names a value that is none of `options` (mixed, custom). */
export const ChoiceControl = defineComponent({
  name: 'ObjectChoiceControl',
  props: {
    ...objectControlProps,
    slotId: { type: String as PropType<ObjectSlotId>, required: true },
    options: {
      type: Array as PropType<readonly (readonly [string, string])[]>,
      required: true,
    },
    other: { type: String, default: undefined },
    /** Turns the picked option text into the slot value. Default the text itself. */
    parse: { type: Function as PropType<(text: string) => unknown>, default: undefined },
    /** Text under the list, such as a note after a change. */
    after: { type: null as unknown as PropType<VNodeChild>, default: null },
    onApplied: { type: Function as PropType<(refusal: string | null) => void>, default: undefined },
  },
  setup(props) {
    const { control, text, apply } = useObjectSlot(props.slotId);
    const id = useStableDocxId('object-choice');
    const reasonId = useStableDocxId('object-reason');
    const variantOf = useObjectControlVariant(() => props.variant);
    const scope = usePartScope();
    return () => {
      if (props.hidden) return null;
      const variant = variantOf();
      const label = props.label ?? control.label.value;
      const value = text.value;
      const listed = props.options.some(([option]) => option === value);
      const reason = control.disabledReason.value;
      // With nothing selected, a compact list names itself, as its label is hidden.
      const placeholder =
        !control.isEnabled.value && value === '' && variant === 'compact'
          ? label
          : (props.other ?? '');
      return objectControlFrame(
        {
          slotId: props.slotId,
          variant,
          className: props.className,
          reason,
          reasonId,
          scope: scope(),
        },
        [
          <div class="docx-chart-pane__field">
            <label
              class={`docx-chart-pane__label${variant === 'compact' ? ' docx-editor-sr-only' : ''}`}
              for={id}
            >
              {label}
            </label>
            <select
              id={id}
              class="docx-dialog__select"
              value={listed ? value : ''}
              disabled={!control.isEnabled.value}
              aria-describedby={reason !== null && variant === 'field' ? reasonId : undefined}
              onChange={(event: Event) => {
                const text = (event.currentTarget as HTMLSelectElement).value;
                const refusal = apply(props.parse ? props.parse(text) : text);
                props.onApplied?.(refusal);
              }}
            >
              {listed ? null : (
                <option value="" disabled>
                  {placeholder}
                </option>
              )}
              {props.options.map(([option, text]) => (
                <option key={option} value={option}>
                  {text}
                </option>
              ))}
            </select>
          </div>,
          props.after,
        ]
      );
    };
  },
});

/** A text part that applies on Enter or blur; refused text stays with its reason. */
export const TextControl = defineComponent({
  name: 'ObjectTextControl',
  props: {
    ...objectControlProps,
    slotId: { type: String as PropType<ObjectSlotId>, required: true },
    numeric: { type: Boolean, default: false },
    /** The value the field shows; default the slot's value. */
    value: { type: String, default: undefined },
    /** Keeps unsaved text while it stays the same; default the slot id. */
    draftKey: { type: String, default: undefined },
    /** The id of more text that describes the field, such as a help note. */
    describedBy: { type: String, default: undefined },
  },
  setup(props) {
    const { control, text, apply } = useObjectSlot(props.slotId);
    const reasonId = useStableDocxId('object-reason');
    const variantOf = useObjectControlVariant(() => props.variant);
    const scope = usePartScope();
    return () => {
      if (props.hidden) return null;
      const variant = variantOf();
      const label = props.label ?? control.label.value;
      const reason = control.disabledReason.value;
      const described = [
        reason !== null && variant === 'field' ? reasonId : null,
        props.describedBy ?? null,
      ]
        .filter(Boolean)
        .join(' ');
      return objectControlFrame(
        {
          slotId: props.slotId,
          variant,
          className: props.className,
          reason,
          reasonId,
          scope: scope(),
        },
        <ChartField
          draftKey={props.draftKey ?? props.slotId}
          label={label}
          visibleLabel={variant === 'field' ? label : undefined}
          value={props.value ?? text.value}
          numeric={props.numeric}
          disabled={!control.isEnabled.value}
          describedBy={described || undefined}
          onCommit={(typed: string) => apply(typed)}
        />
      );
    };
  },
});

/** A toggle part: a check box row in a field, a pressed button in a toolbar. */
export const ToggleControl = defineComponent({
  name: 'ObjectToggleControl',
  props: {
    ...objectButtonPartProps,
    slotId: { type: String as PropType<ObjectToggleSlotId>, required: true },
  },
  setup(props, { slots }) {
    const { control, apply } = useObjectSlot(props.slotId);
    const reasonId = useStableDocxId('object-reason');
    const variantOf = useObjectControlVariant(() => props.variant);
    const scope = usePartScope();
    return () => {
      if (props.hidden) return null;
      const variant = variantOf();
      const label = props.label ?? control.label.value;
      const reason = control.disabledReason.value;
      const active = control.isActive.value;
      const button = (name: string, on: boolean) => ({
        type: 'button' as const,
        class: 'docx-toolbar__button',
        'aria-label': name,
        title: name,
        'aria-pressed': on,
        disabled: !control.isEnabled.value,
        'data-active': on ? '' : undefined,
        onClick: () => (control as UseObjectControlReturn<ObjectToggleSlotId>).toggle(),
      });
      return objectControlFrame(
        {
          slotId: props.slotId,
          variant,
          className: props.className,
          reason,
          reasonId,
          active,
          scope: scope(),
        },
        variant === 'compact' ? (
          props.asChild ? (
            <Slot {...button(label, active)}>{{ default: () => slots.default?.() }}</Slot>
          ) : (
            <button {...button(label, active)}>
              {props.icon ?? chromeIcon(ICONS.get(props.slotId))}
            </button>
          )
        ) : (
          <label class="docx-dialog__checkbox-row">
            <input
              type="checkbox"
              checked={active}
              disabled={!control.isEnabled.value}
              aria-describedby={reason !== null ? reasonId : undefined}
              onChange={(event: Event) => apply((event.currentTarget as HTMLInputElement).checked)}
            />
            {label}
          </label>
        )
      );
    };
  },
});
