// The building blocks of the shape and chart parts: `useObjectControl`, which binds one
// `shape.*` or `chart.*` slot to its live state, and the field shapes every part renders as (a
// colour, a list, a text field, a toggle). A part works in a toolbar, a menu, a popover, a
// drawer, or a pane. `variant="field"` shows a visible label and the disabled reason under the
// control; `variant="compact"` keeps the label for screen readers only and puts the reason in
// the tooltip, for a toolbar. Enabled state, the disabled reason, and the value come only from
// `toolbarCommandState`; a change runs `runToolbarCommand`. The Vue twin is
// `packages/vue/src/editor/objects/object-controls.tsx`.

import { useCallback, useId, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
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
import { localizeDisabledReason, type TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
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

/** What `useObjectControl` returns. @public */
export interface UseObjectControlReturn<K extends ObjectSlotId> {
  readonly slotId: K;
  /** The slot's translated name. */
  readonly label: string;
  /** What the control shows now, as text (`accent1`, `none`, `2.25`, `dash`), or undefined. */
  readonly value: string | undefined;
  /** Whether a toggle is on, or whether the object shows the property. */
  readonly isActive: boolean;
  readonly isEnabled: boolean;
  /** Why the control is disabled, translated, or null. */
  readonly disabledReason: string | null;
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
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const select = useCallback(() => toolbarCommandState(editor, slotId), [editor, slotId]);
  const state = useEditorState(select, sameState);
  return useMemo(() => {
    const execute = (value: ObjectSlotValueMap[K]): ExecResult =>
      runToolbarCommand(editor, slotId as ChromeSlotId as never, value as never);
    return {
      slotId,
      label: t((LABEL_KEYS.get(slotId) ?? slotId) as TranslationKey),
      value: state.value,
      isActive: state.active,
      isEnabled: state.enabled,
      disabledReason: localizeDisabledReason(state.disabledReason, t),
      execute,
      apply: (value) => {
        const result = execute(value);
        return result.ok ? null : (localizeDisabledReason(result.reason, t) ?? '');
      },
      toggle: () => runToolbarCommand(editor, slotId as ChromeSlotId),
    };
  }, [editor, slotId, state, t]);
}

/** The root of a part: its label, its control, and the disabled reason of a field. */
export function ObjectControlFrame(props: {
  slotId: ObjectSlotId;
  variant: ObjectControlVariant;
  className: string | undefined;
  reason: string | null;
  reasonId: string;
  active?: boolean;
  children: ReactNode;
}): ReactElement {
  const { variant, reason } = props;
  return (
    <div
      className={`docx-object-control docx-object-control--${variant}${props.className ? ` ${props.className}` : ''}`}
      data-slot={props.slotId}
      data-active={props.active ? '' : undefined}
      data-disabled={reason !== null ? '' : undefined}
      title={variant === 'compact' ? (reason ?? undefined) : undefined}
      onMouseDown={variant === 'compact' ? guardToolbarMousedown : undefined}
    >
      {props.children}
      {reason !== null && variant === 'field' ? (
        <p className="docx-chart-pane__note" id={props.reasonId}>
          {reason}
        </p>
      ) : null}
    </div>
  );
}

/** A colour part: a trigger that names the colour, and the shared grid. */
export function ColorControl<K extends 'shape.fill' | 'shape.outlineColor'>(
  props: ObjectControlProps & {
    slotId: K;
    /** What the trigger says: the colour's name, No fill, Gradient. */
    summary: string;
    noneLabel: string;
    /** Text under the control in a field, such as a note about a fill it cannot show. */
    after?: ReactNode;
  }
): ReactElement | null {
  const control = useObjectControl(props.slotId);
  const reasonId = useId();
  const labelId = useId();
  if (props.hidden) return null;
  const variant = props.variant ?? 'field';
  const label = props.label ?? control.label;
  const value: ColorPickerValue =
    control.value === undefined || control.value === '' ? null : (control.value as ColorPick);
  return (
    <ObjectControlFrame
      slotId={props.slotId}
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
    >
      <ColorPicker.Root
        value={value}
        disabled={!control.isEnabled}
        onPick={(pick) => control.apply(pick as ObjectSlotValueMap[K])}
      >
        <span
          className={`docx-chart-pane__label${variant === 'compact' ? ' docx-editor-sr-only' : ''}`}
          id={labelId}
        >
          {label}
        </span>
        <ColorPicker.Trigger
          aria-labelledby={labelId}
          aria-describedby={
            control.disabledReason !== null && variant === 'field' ? reasonId : undefined
          }
          title={variant === 'compact' ? `${label}: ${props.summary}` : undefined}
        >
          {variant === 'compact' ? (
            <span className="docx-object-control__icon" aria-hidden="true">
              {chromeIcon(ICONS.get(props.slotId))}
            </span>
          ) : null}
          <span className="docx-color-picker__summary docx-shape-pane__summary">
            {props.summary}
          </span>
        </ColorPicker.Trigger>
        <ColorPicker.Content aria-label={label}>
          <ColorPicker.NoColor>{props.noneLabel}</ColorPicker.NoColor>
          <ColorPicker.Grid />
          <ColorPicker.HexInput />
        </ColorPicker.Content>
      </ColorPicker.Root>
      {variant === 'field' ? props.after : null}
    </ObjectControlFrame>
  );
}

/** A list part. `other` names a value that is none of `options` (mixed, custom). */
export function ChoiceControl<K extends ObjectSlotId>(
  props: ObjectControlProps & {
    slotId: K;
    options: readonly (readonly [string, string])[];
    other?: string;
    /** Turns the picked option text into the slot value. Default the text itself. */
    parse?: (text: string) => ObjectSlotValueMap[K];
    /** Text under the list, such as a note after a change. */
    after?: ReactNode;
    onApplied?: (refusal: string | null) => void;
  }
): ReactElement | null {
  const control = useObjectControl(props.slotId);
  const id = useId();
  const reasonId = useId();
  if (props.hidden) return null;
  const variant = props.variant ?? 'field';
  const label = props.label ?? control.label;
  const value = control.value ?? '';
  const listed = props.options.some(([option]) => option === value);
  return (
    <ObjectControlFrame
      slotId={props.slotId}
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
    >
      <div className="docx-chart-pane__field">
        <label
          className={`docx-chart-pane__label${variant === 'compact' ? ' docx-editor-sr-only' : ''}`}
          htmlFor={id}
        >
          {label}
        </label>
        <select
          id={id}
          className="docx-dialog__select"
          value={listed ? value : ''}
          disabled={!control.isEnabled}
          aria-describedby={
            control.disabledReason !== null && variant === 'field' ? reasonId : undefined
          }
          onChange={(event) => {
            const text = event.currentTarget.value;
            const refusal = control.apply(
              (props.parse ? props.parse(text) : text) as ObjectSlotValueMap[K]
            );
            props.onApplied?.(refusal);
          }}
        >
          {listed ? null : (
            <option value="" disabled>
              {/* With nothing to show, a compact list names itself, as its label is hidden. */}
              {control.value == null && variant === 'compact' ? label : (props.other ?? '')}
            </option>
          )}
          {props.options.map(([option, text]) => (
            <option key={option} value={option}>
              {text}
            </option>
          ))}
        </select>
      </div>
      {props.after}
    </ObjectControlFrame>
  );
}

/** A text part that applies on Enter or blur; refused text stays with its reason. */
export function TextControl<K extends ObjectSlotId>(
  props: ObjectControlProps & {
    slotId: K;
    numeric?: boolean;
    /** Turns the typed text into the slot value. Default the text itself. */
    parse?: (text: string) => ObjectSlotValueMap[K];
    /** The value the field shows; default the slot's value. */
    value?: string;
    /** Keeps unsaved text while it stays the same; default the slot id. */
    draftKey?: string;
    /** The id of more text that describes the field, such as a help note. */
    describedBy?: string;
  }
): ReactElement | null {
  const control = useObjectControl(props.slotId);
  const reasonId = useId();
  if (props.hidden) return null;
  const variant = props.variant ?? 'field';
  const label = props.label ?? control.label;
  const described = [
    control.disabledReason !== null && variant === 'field' ? reasonId : null,
    props.describedBy ?? null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <ObjectControlFrame
      slotId={props.slotId}
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
    >
      <ChartField
        draftKey={props.draftKey ?? props.slotId}
        label={label}
        {...(variant === 'field' ? { visibleLabel: label } : {})}
        value={props.value ?? control.value ?? ''}
        {...(props.numeric ? { numeric: true } : {})}
        disabled={!control.isEnabled}
        {...(described ? { describedBy: described } : {})}
        onCommit={(text) =>
          control.apply((props.parse ? props.parse(text) : text) as ObjectSlotValueMap[K])
        }
      />
    </ObjectControlFrame>
  );
}

/** A toggle part: a check box row in a field, a pressed button in a toolbar. */
export function ToggleControl(
  props: ObjectControlProps & { slotId: 'chart.dataLabels' | 'chart.axes' | 'chart.gridlines' }
): ReactElement | null {
  const control = useObjectControl(props.slotId);
  const reasonId = useId();
  if (props.hidden) return null;
  const variant = props.variant ?? 'field';
  const label = props.label ?? control.label;
  return (
    <ObjectControlFrame
      slotId={props.slotId}
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
      active={control.isActive}
    >
      {variant === 'compact' ? (
        <button
          type="button"
          className="docx-toolbar__button"
          aria-label={label}
          title={label}
          aria-pressed={control.isActive}
          disabled={!control.isEnabled}
          data-active={control.isActive ? '' : undefined}
          onClick={() => control.toggle()}
        >
          {chromeIcon(ICONS.get(props.slotId))}
        </button>
      ) : (
        <label className="docx-dialog__checkbox-row">
          <input
            type="checkbox"
            checked={control.isActive}
            disabled={!control.isEnabled}
            aria-describedby={control.disabledReason !== null ? reasonId : undefined}
            onChange={(event) =>
              control.apply(event.currentTarget.checked as ObjectSlotValueMap['chart.axes'])
            }
          />
          {label}
        </label>
      )}
    </ObjectControlFrame>
  );
}
