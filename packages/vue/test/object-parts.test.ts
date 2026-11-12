// The shape and chart parts outside the packaged panes: a host toolbar with its own fill and
// chart title, a popover that answers a pane request with pane sections, the default toolbar's
// contextual groups, and the colour picker keyboard model. The React twin is
// `packages/react/test/object-parts.test.tsx`.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { defineComponent, h, ref, type VNode } from 'vue';
import { runToolbarCommand } from '@docx-editor.dev/core/editor';
import { DocxEditorToolbar } from '../src/editor/toolbar/DocxEditorToolbar';
import { ColorPicker } from '../src/editor/color/ColorPicker';
import { ToolbarTableBorderColor, ToolbarTableCellFill } from '../src/editor/toolbar/TableControls';
import { usePaneRequest } from '../src/editor/panes/index';
import {
  DocxEditorChartAxes,
  DocxEditorChartData,
  DocxEditorChartDataLabels,
  DocxEditorChartLegend,
  DocxEditorChartSeriesColors,
  DocxEditorChartTitle,
  DocxEditorChartType,
  DocxEditorPaneSections,
  DocxEditorShapeFill,
  DocxEditorShapeOutlineDash,
  DocxEditorShapeOutlineWidth,
} from '../src/editor/objects/index';
import { docx, flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';
import {
  SHAPE_PANE_CASES,
  selectParityShape,
  shapePaneDocx,
} from '../../react/test/shape-pane-parity.ts';
import { CHART_PANE_SOURCE, insertParityChart } from '../../react/test/chart-pane-parity.ts';

let mounted: MountedEditor | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const key = (target: Element, name: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
};

const choose = (select: HTMLSelectElement, value: string): void => {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

const bar = (): HTMLElement =>
  mounted!.container.querySelector<HTMLElement>('[role="toolbar"][aria-label="Host"]')!;

const hostBar = (children: () => VNode[]) =>
  h('div', { role: 'toolbar', 'aria-label': 'Host' }, children());

test('shape parts in a host toolbar: compact fill, dash, and width apply and follow the shape', async () => {
  mounted = mountEditorTree(
    () =>
      hostBar(() => [
        h(DocxEditorShapeFill, { variant: 'compact' }),
        h(DocxEditorShapeOutlineWidth, { variant: 'compact' }),
        h(DocxEditorShapeOutlineDash, { variant: 'compact', className: 'host-dash' }),
      ]),
    shapePaneDocx(SHAPE_PANE_CASES.theme)
  );
  await flush();
  const editor = mounted.editor();
  const trigger = bar().querySelector<HTMLButtonElement>('.docx-color-picker__trigger')!;
  // Nothing selected: disabled, with the reason in the tooltip.
  expect(trigger.disabled).toBe(true);
  expect(bar().querySelector('[data-slot="shape.fill"]')?.getAttribute('title')).toBeTruthy();
  selectParityShape(editor);
  await flush();
  expect(trigger.disabled).toBe(false);
  // The label is for screen readers only in a compact part.
  expect(bar().querySelector('[data-slot="shape.fill"] .docx-editor-sr-only')?.textContent).toBe(
    'Fill color'
  );
  // Keyboard: the grid opens on the current colour, Down moves a row, Escape returns focus.
  trigger.click();
  await flush();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Accent 1');
  key(document.activeElement!, 'ArrowDown');
  expect(document.activeElement?.getAttribute('data-pick')).toMatch(/^accent1:/);
  key(document.activeElement!, 'Escape');
  await flush();
  expect(document.activeElement).toBe(trigger);
  trigger.click();
  await flush();
  bar().querySelector<HTMLButtonElement>('[data-pick="accent6"]')!.click();
  await flush();
  expect(editor.snapshot().image?.shapeFormat?.fill.theme).toEqual({ name: 'accent6', shift: 0 });
  const dash = bar().querySelector<HTMLSelectElement>('.host-dash select')!;
  choose(dash, 'dashDot');
  await flush();
  expect(editor.snapshot().image?.shapeFormat?.outline.dash).toBe('dashDot');
  expect(dash.value).toBe('dashDot');
  const width = bar().querySelector<HTMLSelectElement>('[data-slot="shape.outlineWidth"] select')!;
  choose(width, '6');
  await flush();
  expect(editor.snapshot().image?.shapeFormat?.outline.widthPt).toBe(6);
  // A change from elsewhere repaints the parts.
  runToolbarCommand(editor, 'shape.outlineDash', 'solid');
  await flush();
  expect(dash.value).toBe('solid');
});

const ChartPopover = defineComponent({
  name: 'ChartPopover',
  setup() {
    const open = ref(false);
    // A Vue setup function, not a React component.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    usePaneRequest(() => (open.value = true), { panes: ['chart'] });
    return () =>
      open.value
        ? h('div', { role: 'dialog', 'aria-label': 'Chart popover' }, [
            h(DocxEditorPaneSections, { pane: 'chart', sections: ['type', 'elements'] }),
          ])
        : null;
  },
});

test('chart parts in a host toolbar and a popover that answers the pane request', async () => {
  mounted = mountEditorTree(
    () => [
      hostBar(() => [
        h(DocxEditorChartType, { variant: 'compact' }),
        h(DocxEditorChartTitle, { variant: 'compact' }),
        h(DocxEditorChartLegend, { variant: 'compact' }),
        h(DocxEditorChartDataLabels, { variant: 'compact' }),
      ]),
      h(ChartPopover),
      h('div', { 'data-testid': 'drawer' }, [
        h(DocxEditorChartAxes),
        h(DocxEditorChartSeriesColors, { index: 0 }),
        h(DocxEditorChartData),
      ]),
    ],
    CHART_PANE_SOURCE
  );
  await flush();
  const editor = mounted.editor();
  const title = bar().querySelector<HTMLInputElement>('[data-slot="chart.title"] input')!;
  expect(title.disabled).toBe(true);
  insertParityChart(editor, 'columnClustered');
  await flush();
  expect(title.disabled).toBe(false);
  title.value = 'Revenue';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  key(title, 'Enter');
  await flush();
  const id = editor.snapshot().chart!.drawingNodeId;
  const format = () => {
    const read = editor.query({ type: 'chartFormat', drawingNodeId: id });
    if (!read.ok) throw new Error(read.reason);
    return read.format;
  };
  expect(format().title).toBe('Revenue');
  const labels = bar().querySelector<HTMLButtonElement>('[data-slot="chart.dataLabels"] button')!;
  expect(labels.getAttribute('aria-pressed')).toBe('false');
  labels.click();
  await flush();
  expect(format().dataLabels).toBe(true);
  expect(labels.getAttribute('aria-pressed')).toBe('true');
  choose(bar().querySelector<HTMLSelectElement>('[data-slot="chart.type"] select')!, 'line');
  await flush();
  expect(format().type).toBe('line');
  // Edit chart opens the host's popover, which renders pane sections.
  expect(runToolbarCommand(editor, 'image.editChart')).toEqual({ ok: true, changed: false });
  await flush();
  const popover = mounted.container.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Chart popover"]'
  )!;
  expect(popover.querySelector('[data-section="type"]')).not.toBeNull();
  expect(popover.querySelector('[data-section="data"]')).toBeNull();
  choose(popover.querySelector<HTMLSelectElement>('[data-slot="chart.legend"] select')!, 'left');
  await flush();
  expect(format().legend).toBe('left');
  expect(bar().querySelector<HTMLSelectElement>('[data-slot="chart.legend"] select')!.value).toBe(
    'left'
  );
  // The drawer: one series colour and the data editor, outside any pane.
  const drawer = mounted.container.querySelector<HTMLElement>('[data-testid="drawer"]')!;
  drawer.querySelector<HTMLButtonElement>('.docx-color-picker__trigger')!.click();
  await flush();
  drawer.querySelector<HTMLButtonElement>('[data-pick="accent4"]')!.click();
  await flush();
  expect(format().colors[0]?.color).toEqual({ theme: 'accent4' });
  const add = [...drawer.querySelectorAll('button')].find((b) => b.textContent === 'Add category')!;
  add.click();
  await flush();
  const data = editor.query({ type: 'chartData', drawingNodeId: id });
  expect(data.ok && data.data.categories.length).toBe(5);
  // A pie chart has no axes: the axes part renders nothing.
  expect(drawer.querySelector('[data-slot="chart.axes"]')).not.toBeNull();
  runToolbarCommand(editor, 'chart.type', 'pie');
  await flush();
  expect(drawer.querySelector('[data-slot="chart.axes"]')).toBeNull();
});

test('the default toolbar shows the contextual shape and chart groups for a selection', async () => {
  mounted = mountEditorTree(
    () => h(DocxEditorToolbar, { overflow: false }),
    shapePaneDocx(SHAPE_PANE_CASES.solid)
  );
  await flush();
  const slots = () =>
    [...mounted!.container.querySelectorAll('.docx-toolbar [data-slot]')].map((n) =>
      n.getAttribute('data-slot')
    );
  expect(slots()).not.toContain('shape.fill');
  selectParityShape(mounted.editor());
  await flush();
  expect(slots()).toEqual(
    expect.arrayContaining([
      'shape.fill',
      'shape.outlineColor',
      'shape.outlineWidth',
      'shape.outlineDash',
    ])
  );
  expect(slots()).not.toContain('shape.fillTransparency');
});

test('table border color and cell fill use the shared colour picker', async () => {
  mounted = mountEditorTree(
    () =>
      h(DocxEditorToolbar, { preset: false }, () => [
        h(ToolbarTableBorderColor),
        h(ToolbarTableCellFill),
      ]),
    docx(
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    )
  );
  await flush();
  const editor = mounted.editor();
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
  await flush();
  for (const slot of ['table.borderColor', 'table.cellFill'] as const) {
    const root = mounted.container.querySelector(`[data-slot="${slot}"]`)!;
    root.querySelector<HTMLButtonElement>('.docx-toolbar__colorsplit-caret')!.click();
    await flush();
    const popup = root.querySelector('[role="dialog"]')!;
    // The shared colour picker: six theme rows, the standard row, and the hex field.
    const grid = popup.querySelector('.docx-color-picker__content--inline')!;
    expect(grid.querySelectorAll('[data-color-swatch]')).toHaveLength(70);
    expect(grid.querySelector('.docx-color-picker__hex input')).not.toBeNull();
    if (slot === 'table.cellFill') {
      grid.querySelector<HTMLButtonElement>('[data-pick="accent1"]')!.click();
      await flush();
      expect(root.querySelector('[role="dialog"]')).toBeNull();
    } else {
      key(grid, 'Escape');
      await flush();
    }
  }
});

test('ColorPicker.Trigger asChild renders the host button as the trigger', async () => {
  const picks: string[] = [];
  mounted = mountEditorTree(() =>
    h(ColorPicker.Root, { value: 'accent1', onPick: (pick: string) => picks.push(pick) }, () => [
      h(ColorPicker.Trigger, { asChild: true, 'aria-label': 'Host colour' }, () =>
        h('button', { class: 'host-trigger' }, 'Colour')
      ),
      h(ColorPicker.Content),
    ])
  );
  await flush();
  const trigger = mounted.container.querySelector<HTMLButtonElement>('.host-trigger')!;
  expect(trigger.classList.contains('docx-color-picker__trigger')).toBe(true);
  expect(trigger.getAttribute('aria-label')).toBe('Host colour');
  expect(trigger.querySelector('.docx-color-picker__chip')).toBeNull();
  trigger.click();
  await flush();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  mounted.container.querySelector<HTMLButtonElement>('[data-pick="accent5"]')!.click();
  await flush();
  expect(picks).toEqual(['accent5']);
  expect(document.activeElement).toBe(trigger);
});
