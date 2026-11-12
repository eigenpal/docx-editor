// Shape and chart parts placed by a host: the scope class outside every scoped element, the
// toolbar customization ladder (className, icon, asChild, a slot override, hidden, and
// preset={false}), the colour picker focus across a host render, the portal container, the
// typed `useObjectControl`, and one luminance model for every colour grid. The React twin is
// `packages/react/test/object-parts-placement.test.tsx`.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { defineComponent, h, ref, type VNode } from 'vue';
import { colorPickHex, documentThemeHexes } from '@docx-editor.dev/core/editor';
import { DocxEditorToolbar } from '../src/editor/toolbar/DocxEditorToolbar';
import { ColorPicker } from '../src/editor/color/ColorPicker';
import {
  DocxEditorChartDataLabels,
  DocxEditorShapeFill,
  useObjectControl,
} from '../src/editor/objects/index';
import { flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';
import {
  SHAPE_PANE_CASES,
  selectParityShape,
  shapePaneDocx,
} from '../../react/test/shape-pane-parity.ts';
import { CHART_PANE_SOURCE, insertParityChart } from '../../react/test/chart-pane-parity.ts';

let mounted: MountedEditor[] = [];

afterEach(() => {
  for (const view of mounted) view.unmount();
  mounted = [];
});

function mount(
  document: Uint8Array,
  children: () => VNode | VNode[],
  colorMode: 'light' | 'dark' = 'light'
): MountedEditor {
  const view = mountEditorTree(children, document, () => [], undefined, { colorMode });
  mounted.push(view);
  return view;
}

function unmountAll(): void {
  for (const view of mounted) view.unmount();
  mounted = [];
}

test('a part outside every scoped element carries the scope class, with dark under a dark Root', async () => {
  for (const mode of ['light', 'dark'] as const) {
    const view = mount(
      shapePaneDocx(SHAPE_PANE_CASES.theme),
      () =>
        h('div', { 'data-testid': 'host' }, [
          h(DocxEditorShapeFill, { variant: 'compact' }),
          h(ColorPicker.Root, { value: null, onPick: () => {} }, () => [h(ColorPicker.Trigger)]),
        ]),
      mode
    );
    await flush();
    const host = view.container.querySelector('[data-testid="host"]')!;
    const frame = host.querySelector('[data-slot="shape.fill"]')!;
    expect(frame.classList.contains('docx-editor')).toBe(true);
    expect(frame.classList.contains('dark')).toBe(mode === 'dark');
    // The picker inside the part takes the part's scope; a picker alone carries its own.
    expect(frame.querySelector('.docx-color-picker')!.classList.contains('docx-editor')).toBe(
      false
    );
    const alone = host.querySelector(':scope > .docx-color-picker')!;
    expect(alone.classList.contains('docx-editor')).toBe(true);
    unmountAll();
  }
});

/** The shape.fill and chart.dataLabels nodes inside the default toolbar. */
const toolbarSlots = (root: HTMLElement, slot: string) => [
  ...root.querySelectorAll(`.docx-toolbar [data-slot="${slot}"]`),
];

test('toolbar overrides of a shape part and a chart part: className, icon, asChild, hidden', async () => {
  const cases: readonly { name: string; shape: () => VNode; chart: () => VNode }[] = [
    {
      name: 'className',
      shape: () => h(DocxEditorShapeFill, { className: 'mine' }),
      chart: () => h(DocxEditorChartDataLabels, { className: 'mine' }),
    },
    {
      name: 'icon',
      shape: () => h(DocxEditorShapeFill, { icon: h('i', { class: 'host-icon' }) }),
      chart: () => h(DocxEditorChartDataLabels, { icon: h('i', { class: 'host-icon' }) }),
    },
    {
      name: 'asChild',
      shape: () =>
        h(DocxEditorShapeFill, { asChild: true }, () =>
          h('button', { type: 'button', class: 'host-button' }, 'Fill')
        ),
      chart: () =>
        h(DocxEditorChartDataLabels, { asChild: true }, () =>
          h('button', { type: 'button', class: 'host-button' }, 'Labels')
        ),
    },
    {
      name: 'hidden',
      shape: () => h(DocxEditorShapeFill, { hidden: true }),
      chart: () => h(DocxEditorChartDataLabels, { hidden: true }),
    },
  ];
  for (const { name, shape, chart } of cases) {
    const shapeView = mount(shapePaneDocx(SHAPE_PANE_CASES.solid), () =>
      h(DocxEditorToolbar, { overflow: false }, () => [shape()])
    );
    await flush();
    selectParityShape(shapeView.editor());
    await flush();
    const fills = toolbarSlots(shapeView.container, 'shape.fill');
    const chartView = mount(CHART_PANE_SOURCE, () =>
      h(DocxEditorToolbar, { overflow: false }, () => [chart()])
    );
    await flush();
    insertParityChart(chartView.editor(), 'columnClustered');
    await flush();
    const labels = toolbarSlots(chartView.container, 'chart.dataLabels');
    if (name === 'hidden') {
      expect(fills).toHaveLength(0);
      expect(labels).toHaveLength(0);
      unmountAll();
      continue;
    }
    // The override replaces the slot in place: one control, rendered compact.
    expect(fills).toHaveLength(1);
    expect(labels).toHaveLength(1);
    for (const node of [fills[0]!, labels[0]!]) {
      expect(node.classList.contains('docx-object-control--compact')).toBe(true);
      if (name === 'className') expect(node.classList.contains('mine')).toBe(true);
      if (name === 'icon') expect(node.querySelector('.host-icon')).not.toBeNull();
    }
    if (name === 'asChild') {
      const fillButton = fills[0]!.querySelector<HTMLButtonElement>('.host-button')!;
      expect(fillButton.getAttribute('aria-haspopup')).toBe('true');
      fillButton.click();
      await flush();
      expect(fills[0]!.querySelector('[data-color-swatch]')).not.toBeNull();
      const labelButton = labels[0]!.querySelector<HTMLButtonElement>('.host-button')!;
      expect(labelButton.getAttribute('aria-pressed')).toBe('false');
      labelButton.click();
      await flush();
      expect(labelButton.getAttribute('aria-pressed')).toBe('true');
    }
    unmountAll();
  }
});

test('preset={false} renders the parts verbatim, compact, with nothing else', async () => {
  const view = mount(shapePaneDocx(SHAPE_PANE_CASES.solid), () =>
    h(DocxEditorToolbar, { preset: false }, () => [
      h(DocxEditorShapeFill),
      h(DocxEditorChartDataLabels),
    ])
  );
  await flush();
  selectParityShape(view.editor());
  await flush();
  const slots = [...view.container.querySelectorAll('.docx-toolbar [data-slot]')].map((n) =>
    n.getAttribute('data-slot')
  );
  expect(slots).toEqual(['shape.fill', 'chart.dataLabels']);
  const fill = view.container.querySelector('.docx-toolbar [data-slot="shape.fill"]')!;
  expect(fill.classList.contains('docx-object-control--compact')).toBe(true);
});

const count = ref(0);
const RerenderingHost = defineComponent({
  name: 'RerenderingHost',
  setup() {
    return () =>
      h('div', { role: 'toolbar', 'aria-label': 'Host', 'data-count': count.value }, [
        h(DocxEditorShapeFill, { variant: 'compact' }),
        // A host picker with an inline handler and theme list: new values on every render.
        h(
          ColorPicker.Root,
          {
            className: 'host-picker',
            value: 'accent1',
            themeHexes: documentThemeHexes(undefined).slice(),
            onPick: (pick: string) => void pick,
          },
          () => [h(ColorPicker.Trigger), h(ColorPicker.Content)]
        ),
      ]);
  },
});

test('the open grid keeps the focus in the hex field across an unrelated host render', async () => {
  const view = mount(shapePaneDocx(SHAPE_PANE_CASES.theme), () => h(RerenderingHost));
  await flush();
  selectParityShape(view.editor());
  await flush();
  const bar = view.container.querySelector<HTMLElement>('[role="toolbar"][aria-label="Host"]')!;
  bar.querySelector<HTMLButtonElement>('.docx-color-picker__trigger')!.click();
  await flush();
  const hex = bar.querySelector<HTMLInputElement>('.docx-color-picker__hex input')!;
  hex.focus();
  hex.value = '#12';
  hex.dispatchEvent(new Event('input', { bubbles: true }));
  count.value += 1;
  await flush();
  expect(bar.getAttribute('data-count')).toBe(String(count.value));
  expect(document.activeElement).toBe(hex);
  hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();
  const host = bar.querySelector('.host-picker')!;
  host.querySelector<HTMLButtonElement>('.docx-color-picker__trigger')!.click();
  await flush();
  const hostHex = host.querySelector<HTMLInputElement>('.docx-color-picker__hex input')!;
  hostHex.focus();
  count.value += 1;
  await flush();
  expect(document.activeElement).toBe(hostHex);
});

test('Content renders in a host container through Teleport, scoped, and the refs expose elements', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const trigger = ref<{ element: HTMLButtonElement | null } | null>(null);
  const content = ref<{ element: HTMLDivElement | null } | null>(null);
  const view = mount(
    shapePaneDocx(SHAPE_PANE_CASES.theme),
    () =>
      h(ColorPicker.Root, { value: 'accent1', onPick: () => {} }, () => [
        h(ColorPicker.Trigger, { ref: trigger, 'data-testid': 'trigger' }),
        h(ColorPicker.Content, { ref: content, container }),
      ]),
    'dark'
  );
  await flush();
  const button = view.container.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!;
  expect(trigger.value?.element).toBe(button);
  button.click();
  await flush();
  const grid = container.querySelector<HTMLElement>('.docx-color-picker__content')!;
  expect(grid).not.toBeNull();
  expect(view.container.querySelector('.docx-color-picker__content')).toBeNull();
  expect(content.value?.element).toBe(grid as HTMLDivElement);
  expect(grid.classList.contains('docx-editor')).toBe(true);
  expect(grid.classList.contains('dark')).toBe(true);
  // The host places it: no popover position of its own.
  expect(grid.classList.contains('docx-chart-pane__grid')).toBe(false);
  // A press inside the portal does not close it.
  grid
    .querySelector('[data-pick="accent2"]')!
    .dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await flush();
  expect(container.querySelector('.docx-color-picker__content')).not.toBeNull();
  view.unmount();
  mounted = [];
  container.remove();
});

const seen: Record<string, unknown> = {};
const TypedReader = defineComponent({
  name: 'TypedReader',
  setup() {
    // A Vue setup function, not a React component.
    /* eslint-disable react-hooks/rules-of-hooks */
    const width = useObjectControl('shape.outlineWidth');
    const labels = useObjectControl('chart.dataLabels');
    const legend = useObjectControl('chart.legend');
    /* eslint-enable react-hooks/rules-of-hooks */
    return () => {
      // No casts: the value types come from the slot.
      const widthValue: number | null = width.value.value;
      const labelsValue: boolean | null = labels.value.value;
      seen.width = widthValue;
      seen.labels = labelsValue;
      seen.legend = legend.value.value;
      seen.legendOptions = legend.options.value;
      seen.labelsToggle = typeof labels.toggle;
      seen.widthToggle = 'toggle' in width;
      return null;
    };
  },
});

test('useObjectControl gives a typed value per slot, the list options, and toggle only on toggles', async () => {
  const shape = mount(shapePaneDocx(SHAPE_PANE_CASES.solid), () => h(TypedReader));
  await flush();
  expect(seen.width).toBeNull();
  selectParityShape(shape.editor());
  await flush();
  expect(typeof seen.width).toBe('number');
  expect(seen.widthToggle).toBe(false);
  unmountAll();
  const chart = mount(CHART_PANE_SOURCE, () => h(TypedReader));
  await flush();
  expect(seen.labels).toBeNull();
  insertParityChart(chart.editor(), 'columnClustered');
  await flush();
  expect(seen.labels).toBe(false);
  expect(seen.legend).toBe('bottom');
  expect(seen.legendOptions).toContain('right');
  expect(seen.labelsToggle).toBe('function');
});

test('the font colour grid paints each tint as the shared colour picker does', async () => {
  const view = mount(shapePaneDocx(SHAPE_PANE_CASES.theme), () =>
    h(DocxEditorToolbar, { overflow: false })
  );
  await flush();
  const font = view.container.querySelector('[data-slot="text.color"]')!;
  font.querySelector<HTMLButtonElement>('.docx-toolbar__colorsplit-caret')!.click();
  await flush();
  const hexes = documentThemeHexes(view.editor().getDocumentThemeColors());
  const swatches = [
    ...font.querySelectorAll<HTMLButtonElement>('.docx-toolbar__swatch-grid--theme button'),
  ];
  // Row two, column four: Text 2, Lighter 80%.
  expect(swatches[10 + 3]!.getAttribute('data-value')).toBe(colorPickHex('tx2:80', hexes).slice(1));
  expect(swatches[10 + 4]!.getAttribute('data-value')).toBe(
    colorPickHex('accent1:80', hexes).slice(1)
  );
});
