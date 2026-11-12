// The part of each `shape.*` and `chart.*` slot, and `DocxEditor.PaneSections`, which renders the
// sections of a pane (`PANE_SECTIONS`) from those parts. The packaged panes are this component
// and nothing more; a host renders it in its own popover or drawer, or renders the parts one by
// one. The Vue twin is `packages/vue/src/editor/objects/pane-sections.tsx`.

import type { ComponentType, ReactElement } from 'react';
import { paneSections, type EditorPaneId, type PaneSection } from '@docx-editor.dev/core/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import type { ObjectControlProps, ObjectSlotId } from './object-controls';
import {
  ShapeFill,
  ShapeFillTransparency,
  ShapeOutlineColor,
  ShapeOutlineDash,
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
import { ChartData } from './chart-data-part';

/** The packaged part of each shape and chart slot. @public */
export const OBJECT_SLOT_PARTS: Readonly<Record<ObjectSlotId, ComponentType<ObjectControlProps>>> =
  {
    'shape.fill': ShapeFill,
    'shape.fillTransparency': ShapeFillTransparency,
    'shape.outlineColor': ShapeOutlineColor,
    'shape.outlineWidth': ShapeOutlineWidth,
    'shape.outlineDash': ShapeOutlineDash,
    'chart.type': ChartTypePart,
    'chart.title': ChartTitle,
    'chart.legend': ChartLegend,
    'chart.dataLabels': ChartDataLabels,
    'chart.axes': ChartAxes,
    'chart.gridlines': ChartGridlines,
    'chart.categoryAxisTitle': ChartCategoryAxisTitle,
    'chart.valueAxisTitle': ChartValueAxisTitle,
    'chart.seriesColor': ChartSeriesColors,
    'chart.data': ChartData,
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
export function DocxEditorPaneSections({
  pane,
  sections,
  filter,
}: DocxEditorPaneSectionsProps): ReactElement {
  const { t } = useTranslation();
  const shown = paneSections(pane).filter(
    (section) => (!sections || sections.includes(section.id)) && (!filter || filter(section))
  );
  return (
    <>
      {shown.map((section) => (
        <section
          key={section.id}
          className="docx-chart-pane__section"
          data-section={section.id}
          aria-label={section.labelKey ? t(section.labelKey as TranslationKey) : undefined}
        >
          {section.labelKey ? (
            <h3 className="docx-chart-pane__title">{t(section.labelKey as TranslationKey)}</h3>
          ) : null}
          {section.slots.map((slot) => {
            const Part = OBJECT_SLOT_PARTS[slot as ObjectSlotId];
            return Part ? <Part key={slot} /> : null;
          })}
        </section>
      ))}
    </>
  );
}
