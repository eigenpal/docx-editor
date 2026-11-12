// The part of each `shape.*` and `chart.*` slot, and `DocxEditor.PaneSections`, which renders the
// sections of a pane (`PANE_SECTIONS`) from those parts. The packaged panes are this component
// and nothing more; a host renders it in its own popover or drawer, or renders the parts one by
// one. The React twin is `packages/react/src/editor/objects/pane-sections.tsx`.

import { defineComponent, h, type Component, type PropType } from 'vue';
import { paneSections, type EditorPaneId, type PaneSection } from '@docx-editor.dev/core/editor';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { ObjectSlotId } from './object-controls';
import {
  ShapeFill,
  ShapeFillTransparency,
  ShapeOutlineColor,
  ShapeOutlineDashPart,
  ShapeOutlineWidth,
} from './shape-parts';
import {
  ChartAxes,
  ChartCategoryAxisTitle,
  ChartDataLabels,
  ChartGridlines,
  ChartLegend,
  ChartSeriesColors,
  ChartTitle,
  ChartTypePart,
  ChartValueAxisTitle,
} from './chart-parts';
import { ChartDataPart } from './chart-data-part';

/** The packaged part of each shape and chart slot. @public */
export const OBJECT_SLOT_PARTS: Readonly<Record<ObjectSlotId, Component>> = {
  'shape.fill': ShapeFill,
  'shape.fillTransparency': ShapeFillTransparency,
  'shape.outlineColor': ShapeOutlineColor,
  'shape.outlineWidth': ShapeOutlineWidth,
  'shape.outlineDash': ShapeOutlineDashPart,
  'chart.type': ChartTypePart,
  'chart.title': ChartTitle,
  'chart.legend': ChartLegend,
  'chart.dataLabels': ChartDataLabels,
  'chart.axes': ChartAxes,
  'chart.gridlines': ChartGridlines,
  'chart.categoryAxisTitle': ChartCategoryAxisTitle,
  'chart.valueAxisTitle': ChartValueAxisTitle,
  'chart.seriesColor': ChartSeriesColors,
  'chart.data': ChartDataPart,
};

/** Props for `DocxEditor.PaneSections`. @public */
export interface DocxEditorPaneSectionsProps {
  /** The pane whose sections to render: `shape` or `chart`. */
  pane: EditorPaneId;
  /** Only these sections, by id (`fill`, `outline`, `elements`, …); default all. */
  sections?: readonly string[];
  /** Leaves out sections; `ChartPane` leaves out the format sections of a chart it cannot read. */
  filter?: (section: PaneSection) => boolean;
}

/** The sections of a pane, each a heading over its slot parts. @public */
export const DocxEditorPaneSections = defineComponent({
  name: 'DocxEditorPaneSections',
  props: {
    pane: { type: String as PropType<EditorPaneId>, required: true },
    sections: { type: Array as PropType<readonly string[]>, default: undefined },
    filter: { type: Function as PropType<(section: PaneSection) => boolean>, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    return () =>
      paneSections(props.pane)
        .filter(
          (section) =>
            (!props.sections || props.sections.includes(section.id)) &&
            (!props.filter || props.filter(section))
        )
        .map((section) => (
          <section
            key={section.id}
            class="docx-chart-pane__section"
            data-section={section.id}
            aria-label={section.labelKey ? t(section.labelKey as TranslationKey) : undefined}
          >
            {section.labelKey ? (
              <h3 class="docx-chart-pane__title">{t(section.labelKey as TranslationKey)}</h3>
            ) : null}
            {section.slots.map((slot) => {
              const Part = OBJECT_SLOT_PARTS[slot as ObjectSlotId];
              return Part ? h(Part, { key: slot }) : null;
            })}
          </section>
        ));
  },
});
