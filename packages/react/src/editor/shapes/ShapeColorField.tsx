// The color field of the Format shape pane: a button that shows the current color and opens the
// color grid of the Chart pane, with No fill (or No line) above the theme and standard colors.
// The grid focuses the current color, the arrow keys move in it, and Escape closes it and returns
// the focus to the button. The Vue twin is `packages/vue/src/editor/shapes/ShapeColorField.tsx`;
// both render the same markup.

import { useEffect, useId, useRef, useState } from 'react';
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
import { useChartTranslate } from '../charts/chart-fields';

/** A color field of the Format shape pane. */
export function ShapeColorField(props: {
  /** The label over the field: Fill color, Outline color. */
  label: string;
  /** The name of the grid and of the button that opens it. */
  openLabel: string;
  /** The text of the grid's first button: No fill, No line. */
  noneLabel: string;
  /** What the button says now: a color name, No fill, Gradient. */
  summary: string;
  /** `RRGGBB` of the current color, or null. */
  color: string | null;
  /** Whether the shape has no fill (or no line) now. */
  none: boolean;
  themeHexes: readonly string[];
  disabled: boolean;
  /** The id of the text that says why the field is disabled. */
  describedBy?: string;
  /** Applies a pick, or `none` for No fill or No line. */
  onPick: (pick: ChartColorPick | 'none') => void;
}) {
  const t = useChartTranslate();
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const doc = hostDocumentOf(button.current);
    const away = (event: PointerEvent): void => {
      const target = event.target;
      if (!isDomNode(target)) return;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    doc.addEventListener('pointerdown', away, true);
    focusChartSwatch(panel.current);
    return () => doc.removeEventListener('pointerdown', away, true);
  }, [open]);
  // A disabled field closes its grid: a remote edit or a mode change can disable it while open.
  if (open && props.disabled) setOpen(false);
  const grid = chartColorGrid(props.themeHexes);
  const pick = (next: ChartColorPick | 'none'): void => {
    setOpen(false);
    button.current?.focus();
    props.onPick(next);
  };
  const swatch = (s: { pick: ChartColorPick; hex: string }) => (
    <button
      key={s.pick}
      type="button"
      className="docx-chart-pane__swatch"
      aria-label={chartColorLabel(s.pick, t)}
      title={chartColorLabel(s.pick, t)}
      aria-pressed={!props.none && shapeSwatchCurrent(s.hex, props.color)}
      style={{ background: s.hex }}
      onClick={() => pick(s.pick)}
    />
  );
  const hex = shapeHexText(props.color);
  return (
    <div className="docx-chart-pane__color docx-shape-pane__color">
      <span className="docx-chart-pane__label" id={labelId}>
        {props.label}
      </span>
      <button
        ref={button}
        type="button"
        className="docx-shape-pane__color-button"
        aria-labelledby={labelId}
        aria-describedby={props.describedBy}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={props.disabled}
        data-color={hex}
        onClick={() => setOpen((was) => !was)}
      >
        <span
          className="docx-shape-pane__chip"
          data-none={props.none || !hex}
          style={hex && !props.none ? { background: hex } : undefined}
          aria-hidden="true"
        />
        <span className="docx-shape-pane__summary">{props.summary}</span>
      </button>
      {open ? (
        <div
          ref={panel}
          role="group"
          aria-label={props.openLabel}
          className="docx-chart-pane__grid"
          onKeyDown={(e) => {
            if (moveChartSwatchFocus(panel.current, e.key)) {
              e.preventDefault();
              return;
            }
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            button.current?.focus();
          }}
        >
          <button
            type="button"
            className="docx-chart-pane__grid-auto"
            aria-pressed={props.none}
            onClick={() => pick('none')}
          >
            {props.noneLabel}
          </button>
          <span className="docx-chart-pane__grid-title">{t('colorPicker.themeColors')}</span>
          <div className="docx-chart-pane__swatches">{grid.theme.flat().map(swatch)}</div>
          <span className="docx-chart-pane__grid-title">{t('colorPicker.standardColors')}</span>
          <div className="docx-chart-pane__swatches">{grid.standard.map(swatch)}</div>
        </div>
      ) : null}
    </div>
  );
}
