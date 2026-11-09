// `useSelectedChart`: a host's own chart pane, built only from the composable and placed in
// `DocxEditor.SidePanel`, reads the selected chart and edits it with the chart commands.
// The React twin is `packages/react/test/use-selected-chart.test.tsx`.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { defineComponent, h } from 'vue';
import { openChartPaneFor } from '@docx-editor.dev/core/editor';
import { DocxEditorSidePanel } from '../src/editor/charts/SidePanel';
import {
  useSelectedChart,
  type UseSelectedChartReturn,
} from '../src/editor/charts/useSelectedChart';
import { flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';
import { CHART_PANE_SOURCE, insertParityChart } from '../../react/test/chart-pane-parity.ts';

let mounted: MountedEditor | undefined;
let latest: UseSelectedChartReturn | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A host pane: the chart type and the first series name, from the composable alone. */
const MyChartPane = defineComponent({
  name: 'MyChartPane',
  setup() {
    // A Vue setup function, not a React component.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const chart = useSelectedChart();
    latest = chart;
    return () =>
      chart.chart.value
        ? [
            h(
              'p',
              { class: 'my-pane' },
              `${chart.format.value?.type} ${chart.data.value?.series[0]?.name}`
            ),
            h('input', { 'aria-label': 'First value', class: 'my-field' }),
          ]
        : h('p', { class: 'my-pane' }, 'No chart');
  },
});

async function mount(): Promise<MountedEditor> {
  mounted = mountEditorTree(
    () => h(DocxEditorSidePanel, null, { default: () => h(MyChartPane) }),
    CHART_PANE_SOURCE
  );
  await flush();
  return mounted;
}

const pane = () => mounted!.container.querySelector('.my-pane')?.textContent ?? '';

test('a custom pane reads and edits the selected chart with the composable alone', async () => {
  const { editor } = await mount();
  expect(pane()).toBe('No chart');
  expect(latest!.canEditData.value).toBe(false);
  // The reasons are translated, as `useEditorCommand` translates its own.
  expect(latest!.dataDisabledReason.value).toBeTruthy();
  expect(latest!.dataDisabledReason.value).not.toContain('chart.errors');
  expect(latest!.execute({ type: 'setChartType', chartType: 'line' })).toMatchObject({
    ok: false,
    reason: 'chart.errors.noChart',
  });

  insertParityChart(editor(), 'columnClustered');
  await flush();
  expect(pane()).toBe('columnClustered Series 1');
  expect(latest!.canEditData.value).toBe(true);
  expect(latest!.canEditFormat.value).toBe(true);

  expect(latest!.execute({ type: 'setChartType', chartType: 'line' }).ok).toBe(true);
  await flush();
  expect(pane()).toBe('line Series 1');

  const data = latest!.data.value!;
  const renamed = latest!.execute({
    type: 'setChartData',
    data: { ...data, series: data.series.map((s, i) => (i ? s : { ...s, name: 'Sales' })) },
  });
  expect(renamed.ok).toBe(true);
  await flush();
  expect(pane()).toBe('line Sales');

  // One checked cell edit, as the packaged pane makes it.
  expect(latest!.editData({ type: 'seriesName', series: 0, text: 'Cost' }).ok).toBe(true);
  await flush();
  expect(pane()).toBe('line Cost');
  expect(latest!.editData({ type: 'value', series: 0, category: 0, text: 'x' })).toMatchObject({
    ok: false,
    code: 'invalidArgs',
    reason: 'chart.data.fieldErrors.number',
  });
  expect(latest!.editData({ type: 'value', series: 0, category: 0, text: '9' }).ok).toBe(true);
  await flush();
  expect(latest!.data.value!.series[0]!.values[0]).toBe(9);

  editor().exec({ type: 'undo' });
  editor().exec({ type: 'undo' });
  editor().exec({ type: 'undo' });
  await flush();
  expect(pane()).toBe('line Series 1');
});

test('Edit chart moves the focus into a custom pane', async () => {
  const { editor } = await mount();
  insertParityChart(editor(), 'pie');
  await flush();
  expect(openChartPaneFor(editor(), latest!.chart.value!.drawingNodeId)).toBe(true);
  await flush();
  expect(document.activeElement).toBe(mounted!.container.querySelector('.my-field'));
});

test('viewing mode turns the edits off and names the reason', async () => {
  const { editor } = await mount();
  insertParityChart(editor(), 'pie');
  await flush();
  editor().exec({ type: 'setEditingMode', mode: 'viewing' });
  await flush();
  expect(latest!.chart.value).not.toBeNull();
  expect(latest!.canEditData.value).toBe(false);
  expect(latest!.canEditFormat.value).toBe(false);
  expect(latest!.dataDisabledReason.value).toBeTruthy();
  expect(latest!.dataDisabledReason.value).toBe(latest!.formatDisabledReason.value);
});
