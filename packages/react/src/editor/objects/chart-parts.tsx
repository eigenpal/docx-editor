// The chart parts: one exported control for each `chart.*` slot. Each works alone, in a host's
// toolbar, popover, drawer, or pane, and `DocxEditor.ChartPane` is an arrangement of them
// (`PANE_SECTIONS.chart`). The data editor is `ChartData` (chart-data-part.tsx). The Vue twin is
// `packages/vue/src/editor/objects/chart-parts.tsx`.

import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import {
  CHART_LEGEND_CHOICES,
  CHART_TYPE_CHOICES,
  chartAxisTitleLabels,
  chartColorPick,
  chartPickHex,
  chartSeriesNote,
  chartTypeChangeNote,
  chartTypeHint,
  chartTypeLabelKey,
  colorPickLabel,
  documentThemeHexes,
  type ChartFormat,
  type ChartType,
  type ColorPick,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useChartTranslate } from '../charts/chart-fields';
import { useSelectedChart } from '../charts/useSelectedChart';
import { ColorPicker } from '../color/ColorPicker';
import {
  ChoiceControl,
  ObjectControlFrame,
  TextControl,
  ToggleControl,
  useObjectControl,
  type ObjectControlProps,
} from './object-controls';

/** Props of a chart part. @public */
export type ChartPartProps = ObjectControlProps;

/** The most colour fields `ChartSeriesColors` shows: a pie chart can have thousands of points. */
const MAX_COLOR_FIELDS = 100;

/**
 * The chart type (`chart.type`). A field notes when a type change drops colours or axis titles,
 * and when a pie chart shows only its first series. @public
 */
export function ChartTypePart(props: ChartPartProps): ReactElement | null {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const selected = useSelectedChart();
  const [note, setNote] = useState<{ id: string; key: string; before: ChartFormat } | null>(null);
  const id = selected.chart?.drawingNodeId ?? '';
  const format = selected.format;
  const changed =
    note && note.id === id && format ? chartTypeChangeNote(note.before, format) : null;
  const notes =
    format && props.variant !== 'compact'
      ? [
          note?.id === id ? changed : chartTypeHint(format),
          chartSeriesNote(format, selected.data?.series.length ?? 0),
        ].filter((key): key is NonNullable<typeof key> => key !== null)
      : [];
  return (
    <ChoiceControl
      {...props}
      slotId="chart.type"
      options={CHART_TYPE_CHOICES.map((v) => [v, t(chartTypeLabelKey(v))] as const)}
      other={t('chart.types.other')}
      parse={(text) => text as ChartType}
      onApplied={(refusal) => {
        if (refusal === null && format) setNote({ id, key: 'type', before: format });
      }}
      after={
        props.variant === 'compact' ? null : (
          <div role="status" className="docx-chart-pane__status">
            {notes.map((key) => (
              <p key={key} className="docx-chart-pane__note">
                {translate(key)}
              </p>
            ))}
          </div>
        )
      }
    />
  );
}

/**
 * The chart title (`chart.title`). A field shows a Title check box and, while it is on, the title
 * text; a toolbar shows the text field alone, where empty text removes the title. @public
 */
export function ChartTitle(props: ChartPartProps): ReactElement | null {
  const { t } = useTranslation();
  const control = useObjectControl('chart.title');
  const selected = useSelectedChart();
  const reasonId = useId();
  if (props.hidden) return null;
  const draftKey = selected.chart?.drawingNodeId ?? '';
  if (props.variant === 'compact')
    return <TextControl {...props} slotId="chart.title" draftKey={draftKey} />;
  return (
    <ObjectControlFrame
      slotId="chart.title"
      variant="field"
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
      active={control.isActive}
    >
      <label className="docx-dialog__checkbox-row">
        <input
          type="checkbox"
          checked={control.isActive}
          disabled={!control.isEnabled}
          aria-describedby={control.disabledReason !== null ? reasonId : undefined}
          onChange={(event) =>
            control.apply(event.currentTarget.checked ? t('chart.format.defaultTitle') : null)
          }
        />
        {t('chart.format.showTitle')}
      </label>
      {control.isActive ? (
        <div className="docx-chart-pane__sub">
          <TextControl
            slotId="chart.title"
            {...(props.label ? { label: props.label } : {})}
            draftKey={draftKey}
          />
        </div>
      ) : null}
    </ObjectControlFrame>
  );
}

/** Where the legend sits, or none (`chart.legend`). @public */
export function ChartLegend(props: ChartPartProps): ReactElement | null {
  const { t } = useTranslation();
  return (
    <ChoiceControl
      {...props}
      slotId="chart.legend"
      options={CHART_LEGEND_CHOICES.map(
        (v) => [v, t(`chart.format.legendPositions.${v}`)] as const
      )}
    />
  );
}

/** Whether each point shows its value (`chart.dataLabels`). @public */
export const ChartDataLabels = (props: ChartPartProps): ReactElement | null => (
  <ToggleControl {...props} slotId="chart.dataLabels" />
);

/** Whether the selected chart has axes; a pie or doughnut chart has none. */
const useHasAxes = (): boolean => useSelectedChart().format?.axes !== null;

/** Whether the chart shows its axes (`chart.axes`). Nothing for a chart with no axes. @public */
export function ChartAxes(props: ChartPartProps): ReactElement | null {
  return useHasAxes() ? <ToggleControl {...props} slotId="chart.axes" /> : null;
}

/** Whether the value axis shows major gridlines (`chart.gridlines`). @public */
export function ChartGridlines(props: ChartPartProps): ReactElement | null {
  return useHasAxes() ? <ToggleControl {...props} slotId="chart.gridlines" /> : null;
}

/** One axis title; X and Y for a scatter chart. Empty text removes the title. */
function AxisTitle(
  props: ChartPartProps & { slotId: 'chart.categoryAxisTitle' | 'chart.valueAxisTitle' }
): ReactElement | null {
  const { t } = useTranslation();
  const selected = useSelectedChart();
  const helpId = useId();
  if (props.hidden || selected.format?.axes === null) return null;
  const labels = selected.format ? chartAxisTitleLabels(selected.format) : null;
  const key = labels
    ? props.slotId === 'chart.categoryAxisTitle'
      ? labels.category
      : labels.value
    : null;
  const field = props.variant !== 'compact';
  return (
    <>
      <TextControl
        {...props}
        {...(key && !props.label ? { label: t(key) } : {})}
        slotId={props.slotId}
        draftKey={selected.chart?.drawingNodeId ?? ''}
        {...(field ? { describedBy: helpId } : {})}
      />
      {field ? (
        <p className="docx-chart-pane__note" id={helpId}>
          {t('chart.format.axisTitleHelp')}
        </p>
      ) : null}
    </>
  );
}

/** The category (or X) axis title (`chart.categoryAxisTitle`). @public */
export const ChartCategoryAxisTitle = (props: ChartPartProps): ReactElement | null => (
  <AxisTitle {...props} slotId="chart.categoryAxisTitle" />
);

/** The value (or Y) axis title (`chart.valueAxisTitle`). @public */
export const ChartValueAxisTitle = (props: ChartPartProps): ReactElement | null => (
  <AxisTitle {...props} slotId="chart.valueAxisTitle" />
);

/**
 * The colour of each series, or of each point of a pie chart (`chart.seriesColor`): one shared
 * colour picker per entry, with Automatic. `index` shows one entry only. @public
 */
export function ChartSeriesColors(props: ChartPartProps & { index?: number }): ReactElement | null {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const editor = useDocxEditor();
  const selected = useSelectedChart();
  const control = useObjectControl('chart.seriesColor');
  const reasonId = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  if (props.hidden) return null;
  const variant = props.variant ?? 'field';
  const hexes = documentThemeHexes(editor?.getDocumentThemeColors());
  const entries = (selected.format?.colors ?? [])
    .slice(0, MAX_COLOR_FIELDS)
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => props.index === undefined || props.index === index);
  return (
    <ObjectControlFrame
      slotId="chart.seriesColor"
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
    >
      {refusal ? (
        <p className="docx-chart-pane__error" role="alert">
          {refusal}
        </p>
      ) : null}
      {entries.map(({ entry, index }) => {
        const name = entry.name || t('chart.data.unnamed');
        const pick = chartColorPick(entry);
        const label = props.label ?? t('chart.format.seriesColor', { name });
        return (
          <ColorPicker.Root
            key={index}
            value={pick}
            noColor="auto"
            automaticHex={chartPickHex('auto', hexes, entry.automatic)}
            themeHexes={hexes}
            disabled={!control.isEnabled}
            onPick={(next) =>
              setRefusal(
                control.apply({ index, color: (next === 'none' ? 'auto' : next) as ColorPick })
              )
            }
          >
            {variant === 'field' ? (
              <span className="docx-chart-pane__label" aria-hidden="true">
                {name}
              </span>
            ) : null}
            <ColorPicker.Trigger
              aria-label={label}
              title={variant === 'compact' ? label : undefined}
              {...(control.disabledReason !== null && variant === 'field'
                ? { 'aria-describedby': reasonId }
                : {})}
            >
              {variant === 'compact' ? null : (
                <span className="docx-color-picker__summary docx-shape-pane__summary">
                  {colorPickLabel(pick, translate)}
                </span>
              )}
            </ColorPicker.Trigger>
            <ColorPicker.Content aria-label={t('chart.format.openColors', { name })} />
          </ColorPicker.Root>
        );
      })}
    </ObjectControlFrame>
  );
}
