// The color field of the Format shape pane: a button that shows the current color and opens the
// color grid of the Chart pane, with No fill (or No line) above the theme and standard colors.
// The grid focuses the current color, the arrow keys move in it, and Escape closes it and returns
// the focus to the button. The React twin is
// `packages/react/src/editor/shapes/ShapeColorField.tsx`; both render the same markup.

import { defineComponent, ref, watch, type PropType } from 'vue';
import {
  chartColorGrid,
  chartColorLabel,
  focusChartSwatch,
  hostDocumentOf,
  isDomNode,
  moveChartSwatchFocus,
  shapeHexText,
  shapeSwatchCurrent,
  type ChartColorPick,
} from '@docx-editor.dev/core/editor';
import { useStableDocxId } from '../../lib/stable-id';
import { useChartTranslate } from '../charts/chart-fields';

/** A color field of the Format shape pane. */
export const ShapeColorField = defineComponent({
  name: 'ShapeColorField',
  props: {
    label: { type: String, required: true },
    openLabel: { type: String, required: true },
    noneLabel: { type: String, required: true },
    summary: { type: String, required: true },
    color: { type: String as PropType<string | null>, default: null },
    none: { type: Boolean, required: true },
    themeHexes: { type: Array as PropType<readonly string[]>, required: true },
    disabled: { type: Boolean, required: true },
    describedBy: { type: String, default: undefined },
    onPick: {
      type: Function as PropType<(pick: ChartColorPick | 'none') => void>,
      required: true,
    },
  },
  setup(props) {
    const t = useChartTranslate();
    const labelId = useStableDocxId('shape-color-label');
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
    // A disabled field closes its grid: a remote edit or a mode change can disable it while open.
    watch(
      () => props.disabled,
      (disabled) => {
        if (disabled) open.value = false;
      }
    );
    const pick = (next: ChartColorPick | 'none'): void => {
      open.value = false;
      button.value?.focus();
      props.onPick(next);
    };
    return () => {
      const grid = chartColorGrid(props.themeHexes);
      const hex = shapeHexText(props.color);
      const swatch = (s: { pick: ChartColorPick; hex: string }) => (
        <button
          key={s.pick}
          type="button"
          class="docx-chart-pane__swatch"
          aria-label={chartColorLabel(s.pick, t)}
          title={chartColorLabel(s.pick, t)}
          aria-pressed={!props.none && shapeSwatchCurrent(s.hex, props.color)}
          style={{ background: s.hex }}
          onClick={() => pick(s.pick)}
        />
      );
      return (
        <div class="docx-chart-pane__color docx-shape-pane__color">
          <span class="docx-chart-pane__label" id={labelId}>
            {props.label}
          </span>
          <button
            ref={button}
            type="button"
            class="docx-shape-pane__color-button"
            aria-labelledby={labelId}
            aria-describedby={props.describedBy}
            aria-haspopup="true"
            aria-expanded={open.value}
            disabled={props.disabled}
            data-color={hex}
            onClick={() => {
              open.value = !open.value;
            }}
          >
            <span
              class="docx-shape-pane__chip"
              data-none={props.none || !hex}
              style={hex && !props.none ? { background: hex } : undefined}
              aria-hidden="true"
            />
            <span class="docx-shape-pane__summary">{props.summary}</span>
          </button>
          {open.value ? (
            <div
              ref={panel}
              role="group"
              aria-label={props.openLabel}
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
                aria-pressed={props.none}
                onClick={() => pick('none')}
              >
                {props.noneLabel}
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
