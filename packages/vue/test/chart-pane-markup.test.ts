// The Vue Chart pane renders the same markup as the React pane: both match
// `packages/react/test/chart-pane-markup.json`.

import './dom-setup.ts';

import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'bun:test';
import { h } from 'vue';
import { DocxEditorChartPane } from '../src/editor/charts/ChartPane';
import { flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';
import {
  CHART_PANE_CASES,
  CHART_PANE_MARKUP_PATH,
  CHART_PANE_SOURCE,
  insertParityChart,
  normalizeChartPaneMarkup,
} from '../../react/test/chart-pane-parity.ts';

let mounted: MountedEditor | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function paneMarkup(type: string | null): Promise<string> {
  mounted = mountEditorTree(() => h(DocxEditorChartPane), CHART_PANE_SOURCE);
  await flush();
  if (type) insertParityChart(mounted.editor(), type);
  await flush();
  const pane = mounted.container.querySelector('.docx-chart-pane');
  if (!pane) throw new Error('no pane');
  const html = normalizeChartPaneMarkup(pane.outerHTML);
  mounted.unmount();
  mounted = undefined;
  return html;
}

test('the Vue Chart pane renders the markup of the React pane', async () => {
  const expected = JSON.parse(readFileSync(CHART_PANE_MARKUP_PATH, 'utf8')) as Record<
    string,
    string
  >;
  expect(await paneMarkup(null)).toBe(expected.none!);
  for (const type of CHART_PANE_CASES) expect(await paneMarkup(type)).toBe(expected[type]!);
});

test('the pane moves the focus to the next row after a remove and to a new row after an add', async () => {
  mounted = mountEditorTree(() => h(DocxEditorChartPane), CHART_PANE_SOURCE);
  await flush();
  insertParityChart(mounted.editor(), 'columnClustered');
  await flush();
  const buttons = () => [
    ...mounted!.container.querySelectorAll<HTMLButtonElement>('.docx-chart-pane__list button'),
  ];
  buttons()[1]!.click();
  await flush();
  expect(document.activeElement?.getAttribute('data-row')).toBe('1');
  const add = [...mounted.container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Add category'
  )!;
  add.click();
  await flush();
  expect(document.activeElement?.getAttribute('data-row')).toBe('3');
});
