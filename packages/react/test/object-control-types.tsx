// Type checks of the shape and chart part API, compiled by `bun check` (see tsconfig.json):
// typed slot values with no casts, `toggle` only on toggle slots, and section ids per pane.

import { DocxEditorPaneSections, useObjectControl } from '../src/editor/objects/index.ts';

export function TypedControls(): null {
  const width = useObjectControl('shape.outlineWidth');
  const labels = useObjectControl('chart.dataLabels');
  const legend = useObjectControl('chart.legend');
  const widthValue: number | null = width.value;
  const labelsValue: boolean | null = labels.value;
  width.execute(2.25);
  legend.execute('right', {});
  labels.toggle();
  // @ts-expect-error A value slot has no toggle.
  void width.toggle;
  // @ts-expect-error A legend position is not any text.
  legend.execute('middle');
  void widthValue;
  void labelsValue;
  return null;
}

export function TypedSections() {
  return (
    <>
      <DocxEditorPaneSections pane="shape" sections={['fill', 'outline']} />
      <DocxEditorPaneSections pane="chart" sections={['type', 'elements']} />
      {/* @ts-expect-error `elements` is a chart section, not a shape section. */}
      <DocxEditorPaneSections pane="shape" sections={['elements']} />
    </>
  );
}
