// The chart parts: one exported control for each `chart.*` slot. Each works alone, in a host's
// toolbar, popover, drawer, or pane, and `DocxEditor.ChartPane` is an arrangement of them
// (`PANE_SECTIONS.chart`). The data editor is `ChartDataPart` (chart-data-part.tsx). The React twin
// is `packages/react/src/editor/objects/chart-parts.tsx`; both render the same markup.

import { defineComponent, ref, shallowRef, type PropType } from 'vue';
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
  type ColorPick,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';
import { useDocxEditor } from '../context';
import { useChartTranslate } from '../charts/chart-fields';
import { useSelectedChart } from '../charts/useSelectedChart';
import { ColorPicker } from '../color/ColorPicker';
import {
  ChoiceControl,
  TextControl,
  ToggleControl,
  objectControlFrame,
  objectControlProps,
  passAttrs,
  useObjectControl,
  type ObjectControlProps,
} from './object-controls';

/** Props of a chart part. @public */
export type ChartPartProps = ObjectControlProps;

/** The most colour fields `ChartSeriesColors` shows: a pie chart can have thousands of points. */
const MAX_COLOR_FIELDS = 100;

/** The props a part passes on to its control. */
const passOn = (props: ObjectControlProps) => ({
  className: props.className,
  label: props.label,
  variant: props.variant,
  hidden: props.hidden,
});

/**
 * The chart type (`chart.type`). A field notes when a type change drops colours or axis titles,
 * and when a pie chart shows only its first series. @public
 */
export const ChartTypePart = defineComponent({
  name: 'ChartTypePart',
  props: objectControlProps,
  setup(props) {
    const { t } = useTranslation();
    const translate = useChartTranslate();
    const selected = useSelectedChart();
    const note = shallowRef<{ id: string; before: ChartFormat } | null>(null);
    return () => {
      const id = selected.chart.value?.drawingNodeId ?? '';
      const format = selected.format.value;
      const compact = props.variant === 'compact';
      const current = note.value;
      const changed =
        current && current.id === id && format ? chartTypeChangeNote(current.before, format) : null;
      const notes =
        format && !compact
          ? [
              current?.id === id ? changed : chartTypeHint(format),
              chartSeriesNote(format, selected.data.value?.series.length ?? 0),
            ].filter((key): key is NonNullable<typeof key> => key !== null)
          : [];
      return (
        <ChoiceControl
          {...passOn(props)}
          slotId="chart.type"
          options={CHART_TYPE_CHOICES.map((v) => [v, t(chartTypeLabelKey(v))] as const)}
          other={t('chart.types.other')}
          onApplied={(refusal: string | null) => {
            if (refusal === null && format) note.value = { id, before: format };
          }}
          after={
            compact ? null : (
              <div role="status" class="docx-chart-pane__status">
                {notes.map((key) => (
                  <p key={key} class="docx-chart-pane__note">
                    {translate(key)}
                  </p>
                ))}
              </div>
            )
          }
        />
      );
    };
  },
});

/**
 * The chart title (`chart.title`). A field shows a Title check box and, while it is on, the title
 * text; a toolbar shows the text field alone, where empty text removes the title. @public
 */
export const ChartTitle = defineComponent({
  name: 'ChartTitle',
  props: objectControlProps,
  setup(props) {
    const { t } = useTranslation();
    const control = useObjectControl('chart.title');
    const selected = useSelectedChart();
    const reasonId = useStableDocxId('object-reason');
    return () => {
      if (props.hidden) return null;
      const draftKey = selected.chart.value?.drawingNodeId ?? '';
      if (props.variant === 'compact')
        return <TextControl {...passOn(props)} slotId="chart.title" draftKey={draftKey} />;
      const reason = control.disabledReason.value;
      const active = control.isActive.value;
      return objectControlFrame(
        {
          slotId: 'chart.title',
          variant: 'field',
          className: props.className,
          reason,
          reasonId,
          active,
        },
        [
          <label class="docx-dialog__checkbox-row">
            <input
              type="checkbox"
              checked={active}
              disabled={!control.isEnabled.value}
              aria-describedby={reason !== null ? reasonId : undefined}
              onChange={(event: Event) =>
                control.apply(
                  (event.currentTarget as HTMLInputElement).checked
                    ? t('chart.format.defaultTitle')
                    : null
                )
              }
            />
            {t('chart.format.showTitle')}
          </label>,
          active ? (
            <div class="docx-chart-pane__sub">
              <TextControl slotId="chart.title" label={props.label} draftKey={draftKey} />
            </div>
          ) : null,
        ]
      );
    };
  },
});

/** Where the legend sits, or none (`chart.legend`). @public */
export const ChartLegend = defineComponent({
  name: 'ChartLegend',
  props: objectControlProps,
  setup(props) {
    const { t } = useTranslation();
    return () => (
      <ChoiceControl
        {...passOn(props)}
        slotId="chart.legend"
        options={CHART_LEGEND_CHOICES.map(
          (v) => [v, t(`chart.format.legendPositions.${v}`)] as const
        )}
      />
    );
  },
});

/** Whether each point shows its value (`chart.dataLabels`). @public */
export const ChartDataLabels = defineComponent({
  name: 'ChartDataLabels',
  props: objectControlProps,
  setup(props) {
    return () => <ToggleControl {...passOn(props)} slotId="chart.dataLabels" />;
  },
});

/** Whether the chart shows its axes (`chart.axes`). Nothing for a chart with no axes. @public */
export const ChartAxes = defineComponent({
  name: 'ChartAxes',
  props: objectControlProps,
  setup(props) {
    const selected = useSelectedChart();
    return () =>
      selected.format.value?.axes !== null ? (
        <ToggleControl {...passOn(props)} slotId="chart.axes" />
      ) : null;
  },
});

/** Whether the value axis shows major gridlines (`chart.gridlines`). @public */
export const ChartGridlines = defineComponent({
  name: 'ChartGridlines',
  props: objectControlProps,
  setup(props) {
    const selected = useSelectedChart();
    return () =>
      selected.format.value?.axes !== null ? (
        <ToggleControl {...passOn(props)} slotId="chart.gridlines" />
      ) : null;
  },
});

/** One axis title; X and Y for a scatter chart. Empty text removes the title. */
const AxisTitle = defineComponent({
  name: 'ChartAxisTitle',
  props: {
    ...objectControlProps,
    slotId: {
      type: String as PropType<'chart.categoryAxisTitle' | 'chart.valueAxisTitle'>,
      required: true,
    },
  },
  setup(props) {
    const { t } = useTranslation();
    const selected = useSelectedChart();
    const helpId = useStableDocxId('chart-axis-help');
    return () => {
      const format = selected.format.value;
      if (props.hidden || format?.axes === null) return null;
      const labels = format ? chartAxisTitleLabels(format) : null;
      const key = labels
        ? props.slotId === 'chart.categoryAxisTitle'
          ? labels.category
          : labels.value
        : null;
      const field = props.variant !== 'compact';
      return [
        <TextControl
          {...passOn(props)}
          label={key && !props.label ? t(key) : props.label}
          slotId={props.slotId}
          draftKey={selected.chart.value?.drawingNodeId ?? ''}
          describedBy={field ? helpId : undefined}
        />,
        field ? (
          <p class="docx-chart-pane__note" id={helpId}>
            {t('chart.format.axisTitleHelp')}
          </p>
        ) : null,
      ];
    };
  },
});

/** The category (or X) axis title (`chart.categoryAxisTitle`). @public */
export const ChartCategoryAxisTitle = defineComponent({
  name: 'ChartCategoryAxisTitle',
  props: objectControlProps,
  setup(props) {
    return () => <AxisTitle {...passOn(props)} slotId="chart.categoryAxisTitle" />;
  },
});

/** The value (or Y) axis title (`chart.valueAxisTitle`). @public */
export const ChartValueAxisTitle = defineComponent({
  name: 'ChartValueAxisTitle',
  props: objectControlProps,
  setup(props) {
    return () => <AxisTitle {...passOn(props)} slotId="chart.valueAxisTitle" />;
  },
});

/**
 * The colour of each series, or of each point of a pie chart (`chart.seriesColor`): one shared
 * colour picker per entry, with Automatic. `index` shows one entry only. @public
 */
export const ChartSeriesColors = defineComponent({
  name: 'ChartSeriesColors',
  props: {
    ...objectControlProps,
    /** Shows the entry at this index only. */
    index: { type: Number, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    const translate = useChartTranslate();
    const editorRef = useDocxEditor();
    const selected = useSelectedChart();
    const control = useObjectControl('chart.seriesColor');
    const reasonId = useStableDocxId('object-reason');
    const refusal = ref<string | null>(null);
    return () => {
      if (props.hidden) return null;
      const variant = props.variant;
      const reason = control.disabledReason.value;
      const hexes = documentThemeHexes(editorRef.value?.getDocumentThemeColors());
      const entries = (selected.format.value?.colors ?? [])
        .slice(0, MAX_COLOR_FIELDS)
        .map((entry, index) => ({ entry, index }))
        .filter(({ index }) => props.index === undefined || props.index === index);
      return objectControlFrame(
        { slotId: 'chart.seriesColor', variant, className: props.className, reason, reasonId },
        [
          refusal.value ? (
            <p class="docx-chart-pane__error" role="alert">
              {refusal.value}
            </p>
          ) : null,
          ...entries.map(({ entry, index }) => {
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
                disabled={!control.isEnabled.value}
                onPick={(next: ColorPick | 'none') => {
                  refusal.value = control.apply({
                    index,
                    color: (next === 'none' ? 'auto' : next) as ColorPick,
                  });
                }}
              >
                {{
                  default: () => [
                    variant === 'field' ? (
                      <span class="docx-chart-pane__label" aria-hidden="true">
                        {name}
                      </span>
                    ) : null,
                    <ColorPicker.Trigger
                      aria-label={label}
                      {...passAttrs({
                        title: variant === 'compact' ? label : undefined,
                        'aria-describedby':
                          reason !== null && variant === 'field' ? reasonId : undefined,
                      })}
                    >
                      {{
                        default: () =>
                          variant === 'compact' ? null : (
                            <span class="docx-color-picker__summary docx-shape-pane__summary">
                              {colorPickLabel(pick, translate)}
                            </span>
                          ),
                      }}
                    </ColorPicker.Trigger>,
                    <ColorPicker.Content aria-label={t('chart.format.openColors', { name })} />,
                  ],
                }}
              </ColorPicker.Root>
            );
          }),
        ]
      );
    };
  },
});
