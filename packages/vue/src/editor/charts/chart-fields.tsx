// The fields of the Chart pane: a text field that applies on Enter or blur, a check box row, a
// list, and a color field (a list of Automatic and the theme colors, and a swatch that opens
// the color grid). The React twin is `packages/react/src/editor/charts/chart-fields.tsx`; both
// render the same markup.

import { defineComponent, ref, watch, type PropType } from 'vue';
import {
  chartColorGrid,
  chartColorLabel,
  chartColorPicks,
  chartPickHex,
  focusChartSwatch,
  moveChartSwatchFocus,
  hostDocumentOf,
  isDomNode,
  type ChartColor,
  type ChartColorPick,
} from '@docx-editor.dev/core/editor';
import { useTranslation, type TranslationKey } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';

/** A translator with a plain string key, as the core helpers take it. */
export function useChartTranslate(): (
  key: string,
  params?: Record<string, string | number>
) => string {
  const { t } = useTranslation();
  return (key, params) => t(key as TranslationKey, params);
}

/**
 * A text field that applies on Enter or blur and shows the chart's value otherwise. Text that
 * the pane or the editor refuses stays in the field with its reason; Escape restores the value.
 */
export const ChartField = defineComponent({
  name: 'ChartField',
  props: {
    draftKey: { type: String, required: true },
    label: { type: String, required: true },
    visibleLabel: { type: String, default: undefined },
    value: { type: String, required: true },
    numeric: { type: Boolean, default: false },
    disabled: { type: Boolean, required: true },
    describedBy: { type: String, default: undefined },
    row: { type: Number, default: undefined },
    onCommit: { type: Function as PropType<(text: string) => string | null>, required: true },
  },
  setup(props) {
    const errorId = useStableDocxId('chart-field-error');
    const draft = ref<string | null>(null);
    const error = ref<string | null>(null);
    const reset = (): void => {
      draft.value = null;
      error.value = null;
    };
    watch(() => props.draftKey, reset);
    const commit = (): void => {
      if (draft.value === null) return;
      if (draft.value === props.value) return reset();
      const refused = props.onCommit(draft.value);
      if (refused === null) reset();
      else error.value = refused;
    };
    return () => {
      const described = [error.value !== null ? errorId : null, props.describedBy ?? null]
        .filter(Boolean)
        .join(' ');
      return (
        <label class="docx-chart-pane__field">
          {props.visibleLabel ? (
            <span class="docx-chart-pane__label">{props.visibleLabel}</span>
          ) : null}
          <input
            class="docx-dialog__input"
            aria-label={props.label}
            inputmode={props.numeric ? 'decimal' : undefined}
            aria-invalid={error.value !== null}
            aria-describedby={described || undefined}
            value={draft.value ?? props.value}
            disabled={props.disabled}
            data-row={props.row}
            data-draft={draft.value !== null}
            onInput={(e: Event) => {
              draft.value = (e.target as HTMLInputElement).value;
            }}
            onBlur={commit}
            onKeydown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape' && draft.value !== null) {
                e.stopPropagation();
                reset();
              }
            }}
          />
          {error.value !== null ? (
            <span id={errorId} class="docx-chart-pane__error">
              {error.value}
            </span>
          ) : null}
        </label>
      );
    };
  },
});

/** A check box row of the Chart pane. */
export const ChartCheck = defineComponent({
  name: 'ChartCheck',
  props: {
    label: { type: String, required: true },
    checked: { type: Boolean, required: true },
    disabled: { type: Boolean, required: true },
    describedBy: { type: String, default: undefined },
    onChange: { type: Function as PropType<(checked: boolean) => void>, required: true },
  },
  setup(props) {
    return () => (
      <label class="docx-dialog__checkbox-row">
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          aria-describedby={props.describedBy}
          onChange={(e: Event) => props.onChange((e.currentTarget as HTMLInputElement).checked)}
        />
        {props.label}
      </label>
    );
  },
});

/** A list of the Chart pane. `other` names a value that is not one of `options`. */
export const ChartSelect = defineComponent({
  name: 'ChartSelect',
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
    options: {
      type: Array as PropType<readonly (readonly [string, string])[]>,
      required: true,
    },
    other: { type: String, default: undefined },
    disabled: { type: Boolean, required: true },
    onChange: { type: Function as PropType<(value: string) => void>, required: true },
  },
  setup(props) {
    const id = useStableDocxId('chart-select');
    return () => {
      const listed = props.options.some(([value]) => value === props.value);
      return (
        <div class="docx-chart-pane__field">
          <label class="docx-chart-pane__label" for={id}>
            {props.label}
          </label>
          <select
            id={id}
            class="docx-dialog__select"
            value={listed ? props.value : ''}
            disabled={props.disabled}
            onChange={(e: Event) => props.onChange((e.currentTarget as HTMLSelectElement).value)}
          >
            {listed ? null : (
              <option value="" disabled>
                {props.other ?? ''}
              </option>
            )}
            {props.options.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
      );
    };
  },
});

/**
 * A color field: a list of Automatic and the theme colors, and a swatch that opens the color
 * grid. The grid focuses the current color, the arrow keys move in it, and Escape closes it and
 * returns the focus to the swatch.
 */
export const ChartColorField = defineComponent({
  name: 'ChartColorField',
  props: {
    label: { type: String, required: true },
    name: { type: String, required: true },
    value: { type: String as PropType<ChartColorPick>, required: true },
    automatic: { type: [String, Object] as PropType<ChartColor>, required: true },
    themeHexes: { type: Array as PropType<readonly string[]>, required: true },
    disabled: { type: Boolean, required: true },
    onChange: { type: Function as PropType<(pick: ChartColorPick) => void>, required: true },
  },
  setup(props) {
    const t = useChartTranslate();
    const id = useStableDocxId('chart-color');
    const open = ref(false);
    const panel = ref<HTMLDivElement | null>(null);
    const button = ref<HTMLButtonElement | null>(null);
    watch(
      open,
      (isOpen, _, onCleanup) => {
        if (!isOpen) return;
        const doc = hostDocumentOf(button.value);
        const away = (event: PointerEvent): void => {
          const target = event.target;
          if (!isDomNode(target)) return;
          if (!panel.value?.contains(target) && !button.value?.contains(target)) open.value = false;
        };
        doc.addEventListener('pointerdown', away, true);
        focusChartSwatch(panel.value);
        onCleanup(() => doc.removeEventListener('pointerdown', away, true));
      },
      { flush: 'post' }
    );
    const pick = (next: ChartColorPick): void => {
      props.onChange(next);
      open.value = false;
      button.value?.focus();
    };
    return () => {
      const hex = chartPickHex(props.value, props.themeHexes, props.automatic);
      const grid = chartColorGrid(props.themeHexes);
      const swatch = (s: { pick: ChartColorPick; hex: string }) => (
        <button
          key={s.pick}
          type="button"
          class="docx-chart-pane__swatch"
          aria-label={chartColorLabel(s.pick, t)}
          title={chartColorLabel(s.pick, t)}
          aria-pressed={s.pick === props.value}
          style={{ background: s.hex }}
          onClick={() => pick(s.pick)}
        />
      );
      return (
        <div class="docx-chart-pane__color">
          <div class="docx-chart-pane__field">
            <label class="docx-chart-pane__label" for={id}>
              {props.label}
            </label>
            <select
              id={id}
              class="docx-dialog__select"
              value={props.value}
              disabled={props.disabled}
              onChange={(e: Event) =>
                props.onChange((e.currentTarget as HTMLSelectElement).value as ChartColorPick)
              }
            >
              {chartColorPicks(props.value).map((p) => (
                <option key={p} value={p}>
                  {chartColorLabel(p, t)}
                </option>
              ))}
            </select>
          </div>
          <button
            ref={button}
            type="button"
            class="docx-chart-pane__color-button"
            aria-label={t('chart.format.openColors', { name: props.name })}
            aria-haspopup="true"
            aria-expanded={open.value}
            disabled={props.disabled}
            data-color={hex}
            style={{ background: hex }}
            onClick={() => {
              open.value = !open.value;
            }}
          />
          {open.value ? (
            <div
              ref={panel}
              role="group"
              aria-label={t('chart.format.openColors', { name: props.name })}
              class="docx-chart-pane__grid"
              onKeydown={(e: KeyboardEvent) => {
                if (moveChartSwatchFocus(panel.value, e.key)) {
                  e.preventDefault();
                  return;
                }
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                open.value = false;
                button.value?.focus();
              }}
            >
              <button
                type="button"
                class="docx-chart-pane__grid-auto"
                aria-pressed={props.value === 'auto'}
                onClick={() => pick('auto')}
              >
                {t('colorPicker.automatic')}
              </button>
              <span class="docx-chart-pane__grid-title">{t('colorPicker.themeColors')}</span>
              <div class="docx-chart-pane__swatches">{grid.theme.flat().map(swatch)}</div>
              <span class="docx-chart-pane__grid-title">{t('colorPicker.standardColors')}</span>
              <div class="docx-chart-pane__swatches">{grid.standard.map(swatch)}</div>
            </div>
          ) : null}
        </div>
      );
    };
  },
});
