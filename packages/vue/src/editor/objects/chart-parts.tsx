// The chart parts: one exported control for each `chart.*` slot. Each works alone, in a host's
// toolbar, popover, drawer, or pane, and `DocxEditor.ChartPane` is an arrangement of them
// (`PANE_SECTIONS.chart`). The data editor is `DocxEditorChartData` (chart-data-part.tsx). The React
// twin is `packages/react/src/editor/objects/chart-parts.tsx`; both render the same markup.

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
  objectButtonPartProps,
  objectControlFrame,
  objectControlProps,
  objectPart,
  passAttrs,
  useObjectControlVariant,
  useObjectSlot,
  usePartScope,
  type ObjectButtonPartProps,
  type ObjectControlProps,
} from './object-controls';

/** Props of a chart part. @public */
export type ChartPartProps = ObjectControlProps;

/** Props of a chart toggle part: it also takes `icon` and `asChild`. @public */
export type ChartTogglePartProps = ObjectButtonPartProps;

/** Props of `DocxEditor.ChartSeriesColors`. @public */
export interface ChartSeriesColorsProps extends ChartPartProps {
  /** Shows the colour of this series (or pie point) only. */
  index?: number;
}

/** The most colour fields `ChartSeriesColors` shows: a pie chart can have thousands of points. */
const MAX_COLOR_FIELDS = 100;

/** The props a part passes on to its control. */
const passOn = (props: ObjectControlProps) => ({
  className: props.className,
  label: props.label,
  variant: props.variant,
  hidden: props.hidden,
});

/** The props a toggle part passes on to its control. */
const passOnButton = (props: ObjectButtonPartProps) => ({
  ...passOn(props),
  icon: props.icon,
  asChild: props.asChild,
});

/**
 * The chart type (`chart.type`). A field notes when a type change drops colours or axis titles,
 * and when a pie chart shows only its first series. @public
 */
export const DocxEditorChartType = objectPart(
  'chart.type',
  defineComponent({
    name: 'DocxEditorChartType',
    props: objectControlProps,
    setup(props) {
      const { t } = useTranslation();
      const translate = useChartTranslate();
      const selected = useSelectedChart();
      const note = shallowRef<{ id: string; before: ChartFormat } | null>(null);
      const variantOf = useObjectControlVariant(() => props.variant);
      return () => {
        const id = selected.chart.value?.drawingNodeId ?? '';
        const format = selected.format.value;
        const variant = variantOf();
        const compact = variant === 'compact';
        const current = note.value;
        const changed =
          current && current.id === id && format
            ? chartTypeChangeNote(current.before, format)
            : null;
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
            variant={variant}
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
  })
);

/**
 * The chart title (`chart.title`). A field shows a Title check box and, while it is on, the title
 * text; a toolbar shows the text field alone, where empty text removes the title. @public
 */
export const DocxEditorChartTitle = objectPart(
  'chart.title',
  defineComponent({
    name: 'DocxEditorChartTitle',
    props: objectControlProps,
    setup(props) {
      const { t } = useTranslation();
      const { control, apply } = useObjectSlot('chart.title');
      const selected = useSelectedChart();
      const reasonId = useStableDocxId('object-reason');
      const variantOf = useObjectControlVariant(() => props.variant);
      const scope = usePartScope();
      return () => {
        if (props.hidden) return null;
        const draftKey = selected.chart.value?.drawingNodeId ?? '';
        if (variantOf() === 'compact')
          return (
            <TextControl
              {...passOn(props)}
              variant="compact"
              slotId="chart.title"
              draftKey={draftKey}
            />
          );
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
            scope: scope(),
          },
          [
            <label class="docx-dialog__checkbox-row">
              <input
                type="checkbox"
                checked={active}
                disabled={!control.isEnabled.value}
                aria-describedby={reason !== null ? reasonId : undefined}
                onChange={(event: Event) =>
                  apply(
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
                <TextControl
                  slotId="chart.title"
                  variant="field"
                  label={props.label}
                  draftKey={draftKey}
                />
              </div>
            ) : null,
          ]
        );
      };
    },
  })
);

/** Where the legend sits, or none (`chart.legend`). @public */
export const DocxEditorChartLegend = objectPart(
  'chart.legend',
  defineComponent({
    name: 'DocxEditorChartLegend',
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
  })
);

/** Whether each point shows its value (`chart.dataLabels`). @public */
export const DocxEditorChartDataLabels = objectPart(
  'chart.dataLabels',
  defineComponent({
    name: 'DocxEditorChartDataLabels',
    props: objectButtonPartProps,
    setup(props, { slots }) {
      return () => (
        <ToggleControl {...passOnButton(props)} slotId="chart.dataLabels">
          {{ default: () => slots.default?.() }}
        </ToggleControl>
      );
    },
  })
);

/** Whether the chart shows its axes (`chart.axes`). Nothing for a chart with no axes. @public */
export const DocxEditorChartAxes = objectPart(
  'chart.axes',
  defineComponent({
    name: 'DocxEditorChartAxes',
    props: objectButtonPartProps,
    setup(props, { slots }) {
      const selected = useSelectedChart();
      return () =>
        selected.format.value?.axes !== null ? (
          <ToggleControl {...passOnButton(props)} slotId="chart.axes">
            {{ default: () => slots.default?.() }}
          </ToggleControl>
        ) : null;
    },
  })
);

/** Whether the value axis shows major gridlines (`chart.gridlines`). @public */
export const DocxEditorChartGridlines = objectPart(
  'chart.gridlines',
  defineComponent({
    name: 'DocxEditorChartGridlines',
    props: objectButtonPartProps,
    setup(props, { slots }) {
      const selected = useSelectedChart();
      return () =>
        selected.format.value?.axes !== null ? (
          <ToggleControl {...passOnButton(props)} slotId="chart.gridlines">
            {{ default: () => slots.default?.() }}
          </ToggleControl>
        ) : null;
    },
  })
);

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
    const variantOf = useObjectControlVariant(() => props.variant);
    return () => {
      const format = selected.format.value;
      const variant = variantOf();
      if (props.hidden || format?.axes === null) return null;
      const labels = format ? chartAxisTitleLabels(format) : null;
      const key = labels
        ? props.slotId === 'chart.categoryAxisTitle'
          ? labels.category
          : labels.value
        : null;
      const field = variant !== 'compact';
      return [
        <TextControl
          {...passOn(props)}
          variant={variant}
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
export const DocxEditorChartCategoryAxisTitle = objectPart(
  'chart.categoryAxisTitle',
  defineComponent({
    name: 'DocxEditorChartCategoryAxisTitle',
    props: objectControlProps,
    setup(props) {
      return () => <AxisTitle {...passOn(props)} slotId="chart.categoryAxisTitle" />;
    },
  })
);

/** The value (or Y) axis title (`chart.valueAxisTitle`). @public */
export const DocxEditorChartValueAxisTitle = objectPart(
  'chart.valueAxisTitle',
  defineComponent({
    name: 'DocxEditorChartValueAxisTitle',
    props: objectControlProps,
    setup(props) {
      return () => <AxisTitle {...passOn(props)} slotId="chart.valueAxisTitle" />;
    },
  })
);

/**
 * The colour of each series, or of each point of a pie chart (`chart.seriesColor`): one shared
 * colour picker per entry, with Automatic. `index` shows one entry only. @public
 */
export const DocxEditorChartSeriesColors = objectPart(
  'chart.seriesColor',
  defineComponent({
    name: 'DocxEditorChartSeriesColors',
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
      const { control, apply } = useObjectSlot('chart.seriesColor');
      const reasonId = useStableDocxId('object-reason');
      const refusal = ref<string | null>(null);
      const variantOf = useObjectControlVariant(() => props.variant);
      const scope = usePartScope();
      return () => {
        if (props.hidden) return null;
        const variant = variantOf();
        const reason = control.disabledReason.value;
        const hexes = documentThemeHexes(editorRef.value?.getDocumentThemeColors());
        const entries = (selected.format.value?.colors ?? [])
          .slice(0, MAX_COLOR_FIELDS)
          .map((entry, index) => ({ entry, index }))
          .filter(({ index }) => props.index === undefined || props.index === index);
        return objectControlFrame(
          {
            slotId: 'chart.seriesColor',
            variant,
            className: props.className,
            reason,
            reasonId,
            scope: scope(),
          },
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
                    refusal.value = apply({
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
  })
);
