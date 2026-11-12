// The building blocks of the shape and chart parts: `useObjectControl`, which binds one
// `shape.*` or `chart.*` slot to its live state, and the field shapes every part renders as (a
// colour, a list, a text field, a toggle). A part works in a toolbar, a menu, a popover, a
// drawer, or a pane. `variant="field"` shows a visible label and the disabled reason under the
// control; `variant="compact"` keeps the label for screen readers only and puts the reason in
// the tooltip, for a toolbar. Enabled state, the disabled reason, and the value come only from
// `toolbarCommandState`; a change runs `runToolbarCommand`. The React twin is
// `packages/react/src/editor/objects/object-controls.tsx`; both render the same markup.

import { computed, defineComponent, type ComputedRef, type PropType, type VNodeChild } from 'vue';
import {
  CHROME_GROUPS,
  chromeSlotId,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
  type ColorPick,
  type ObjectSlotValueMap,
  type ToolbarCommandState,
} from '@docx-editor.dev/core/editor';
import type { ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation, type TranslationKey } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { ChartField } from '../charts/chart-fields';
import { ColorPicker, type ColorPickerValue } from '../color/ColorPicker';

/** A `shape.*` or `chart.*` slot. @public */
export type ObjectSlotId = keyof ObjectSlotValueMap;

/** How a part renders: with a visible label (`field`), or as a toolbar control (`compact`). @public */
export type ObjectControlVariant = 'field' | 'compact';

/** The props every shape and chart part takes. @public */
export interface ObjectControlProps {
  /** A class name added to the part's root. */
  className?: string;
  /** Replaces the label, which defaults to the slot's translated name. */
  label?: string;
  /** Default `field`; the toolbar renders `compact`. */
  variant?: ObjectControlVariant;
  /** Renders nothing, so a toolbar override can remove the slot. */
  hidden?: boolean;
}

/** The runtime props of `ObjectControlProps`, shared by every part. @internal */
export const objectControlProps = {
  className: { type: String, default: undefined },
  label: { type: String, default: undefined },
  variant: { type: String as PropType<ObjectControlVariant>, default: 'field' },
  hidden: { type: Boolean, default: false },
} as const;

/** What `useObjectControl` returns. @public */
export interface UseObjectControlReturn<K extends ObjectSlotId> {
  readonly slotId: K;
  /** The slot's translated name. */
  readonly label: ComputedRef<string>;
  /** What the control shows now, as text (`accent1`, `none`, `2.25`, `dash`), or undefined. */
  readonly value: ComputedRef<string | undefined>;
  /** Whether a toggle is on, or whether the object shows the property. */
  readonly isActive: ComputedRef<boolean>;
  readonly isEnabled: ComputedRef<boolean>;
  /** Why the control is disabled, translated, or null. */
  readonly disabledReason: ComputedRef<string | null>;
  /** Run the slot with `value`, as `runToolbarCommand` does. */
  readonly execute: (value: ObjectSlotValueMap[K]) => ExecResult;
  /** Run the slot and give its refusal translated, or null when it applied. */
  readonly apply: (value: ObjectSlotValueMap[K]) => string | null;
  /** Run a toggle with no value: it turns the property on or off. */
  readonly toggle: () => ExecResult;
}

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

/**
 * Bind one `shape.*` or `chart.*` slot: its value, enabled state, translated reason, and the
 * function that runs it. Use it to build a control the packaged parts do not cover. @public
 */
export function useObjectControl<K extends ObjectSlotId>(slotId: K): UseObjectControlReturn<K> {
  const editorRef = useDocxEditor();
  const { t } = useTranslation();
  const state = useEditorState(() => toolbarCommandState(editorRef.value, slotId), sameState);
  const execute = (value: ObjectSlotValueMap[K]): ExecResult =>
    runToolbarCommand(editorRef.value, slotId as ChromeSlotId as never, value as never);
  return {
    slotId,
    label: computed(() => t((LABEL_KEYS.get(slotId) ?? slotId) as TranslationKey)),
    value: computed(() => state.value.value),
    isActive: computed(() => state.value.active),
    isEnabled: computed(() => state.value.enabled),
    disabledReason: computed(() => localizeDisabledReason(state.value.disabledReason, t)),
    execute,
    apply: (value) => {
      const result = execute(value);
      return result.ok ? null : (localizeDisabledReason(result.reason, t) ?? '');
    },
    toggle: () => runToolbarCommand(editorRef.value, slotId as ChromeSlotId),
  };
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
  },
  children: VNodeChild
): VNodeChild {
  const { variant, reason } = props;
  return (
    <div
      class={`docx-object-control docx-object-control--${variant}${props.className ? ` ${props.className}` : ''}`}
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
    ...objectControlProps,
    slotId: { type: String as PropType<'shape.fill' | 'shape.outlineColor'>, required: true },
    /** What the trigger says: the colour's name, No fill, Gradient. */
    summary: { type: String, required: true },
    noneLabel: { type: String, required: true },
    /** Text under the control in a field, such as a note about a fill it cannot show. */
    after: { type: null as unknown as PropType<VNodeChild>, default: null },
  },
  setup(props) {
    const control = useObjectControl(props.slotId);
    const reasonId = useStableDocxId('object-reason');
    const labelId = useStableDocxId('object-label');
    return () => {
      if (props.hidden) return null;
      const variant = props.variant;
      const label = props.label ?? control.label.value;
      const raw = control.value.value;
      const value: ColorPickerValue = raw === undefined || raw === '' ? null : (raw as ColorPick);
      const reason = control.disabledReason.value;
      return objectControlFrame(
        { slotId: props.slotId, variant, className: props.className, reason, reasonId },
        [
          <ColorPicker.Root
            value={value}
            disabled={!control.isEnabled.value}
            onPick={(pick: ColorPick | 'none') =>
              control.apply(pick as ObjectSlotValueMap['shape.fill'])
            }
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
                  aria-labelledby={labelId}
                  aria-describedby={reason !== null && variant === 'field' ? reasonId : undefined}
                  {...passAttrs({
                    title: variant === 'compact' ? `${label}: ${props.summary}` : undefined,
                  })}
                >
                  {{
                    default: () => [
                      variant === 'compact' ? (
                        <span class="docx-object-control__icon" aria-hidden="true">
                          {chromeIcon(ICONS.get(props.slotId))}
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
    const control = useObjectControl(props.slotId);
    const id = useStableDocxId('object-choice');
    const reasonId = useStableDocxId('object-reason');
    return () => {
      if (props.hidden) return null;
      const variant = props.variant;
      const label = props.label ?? control.label.value;
      const value = control.value.value ?? '';
      const listed = props.options.some(([option]) => option === value);
      const reason = control.disabledReason.value;
      return objectControlFrame(
        { slotId: props.slotId, variant, className: props.className, reason, reasonId },
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
                const refusal = control.apply((props.parse ? props.parse(text) : text) as never);
                props.onApplied?.(refusal);
              }}
            >
              {listed ? null : (
                <option value="" disabled>
                  {control.value.value == null && variant === 'compact'
                    ? label
                    : (props.other ?? '')}
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
    /** Turns the typed text into the slot value. Default the text itself. */
    parse: { type: Function as PropType<(text: string) => unknown>, default: undefined },
    /** The value the field shows; default the slot's value. */
    value: { type: String, default: undefined },
    /** Keeps unsaved text while it stays the same; default the slot id. */
    draftKey: { type: String, default: undefined },
    /** The id of more text that describes the field, such as a help note. */
    describedBy: { type: String, default: undefined },
  },
  setup(props) {
    const control = useObjectControl(props.slotId);
    const reasonId = useStableDocxId('object-reason');
    return () => {
      if (props.hidden) return null;
      const variant = props.variant;
      const label = props.label ?? control.label.value;
      const reason = control.disabledReason.value;
      const described = [
        reason !== null && variant === 'field' ? reasonId : null,
        props.describedBy ?? null,
      ]
        .filter(Boolean)
        .join(' ');
      return objectControlFrame(
        { slotId: props.slotId, variant, className: props.className, reason, reasonId },
        <ChartField
          draftKey={props.draftKey ?? props.slotId}
          label={label}
          visibleLabel={variant === 'field' ? label : undefined}
          value={props.value ?? control.value.value ?? ''}
          numeric={props.numeric}
          disabled={!control.isEnabled.value}
          describedBy={described || undefined}
          onCommit={(text: string) =>
            control.apply((props.parse ? props.parse(text) : text) as never)
          }
        />
      );
    };
  },
});

/** A toggle part: a check box row in a field, a pressed button in a toolbar. */
export const ToggleControl = defineComponent({
  name: 'ObjectToggleControl',
  props: {
    ...objectControlProps,
    slotId: {
      type: String as PropType<'chart.dataLabels' | 'chart.axes' | 'chart.gridlines'>,
      required: true,
    },
  },
  setup(props) {
    const control = useObjectControl(props.slotId);
    const reasonId = useStableDocxId('object-reason');
    return () => {
      if (props.hidden) return null;
      const variant = props.variant;
      const label = props.label ?? control.label.value;
      const reason = control.disabledReason.value;
      const active = control.isActive.value;
      return objectControlFrame(
        {
          slotId: props.slotId,
          variant,
          className: props.className,
          reason,
          reasonId,
          active,
        },
        variant === 'compact' ? (
          <button
            type="button"
            class="docx-toolbar__button"
            aria-label={label}
            title={label}
            aria-pressed={active}
            disabled={!control.isEnabled.value}
            data-active={active ? '' : undefined}
            onClick={() => control.toggle()}
          >
            {chromeIcon(ICONS.get(props.slotId))}
          </button>
        ) : (
          <label class="docx-dialog__checkbox-row">
            <input
              type="checkbox"
              checked={active}
              disabled={!control.isEnabled.value}
              aria-describedby={reason !== null ? reasonId : undefined}
              onChange={(event: Event) =>
                control.apply((event.currentTarget as HTMLInputElement).checked as never)
              }
            />
            {label}
          </label>
        )
      );
    };
  },
});
