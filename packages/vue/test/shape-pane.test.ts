// The Vue Format shape pane renders the markup of the React pane (both match
// `packages/react/test/shape-pane-markup.json`), and the side panel swaps to it for a selected
// shape, takes the keyboard path through the grid and the fields, and empties when the shape
// goes.

import './dom-setup.ts';

import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'bun:test';
import { h } from 'vue';
import { commandForSlotValue, runToolbarCommand } from '@docx-editor.dev/core/editor';
import { DocxEditorShapePane } from '../src/editor/shapes/ShapePane';
import { DocxEditorSidePanel } from '../src/editor/panes/SidePanel';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { DocxEditorToolbar } from '../src/editor/toolbar/DocxEditorToolbar';
import { DocxEditorChartPane } from '../src/editor/charts/ChartPane';
import { flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';
import {
  GROUP_DRAWING,
  SHAPE_PANE_CASES,
  SHAPE_PANE_MARKUP_PATH,
  normalizeShapePaneMarkup,
  selectParityShape,
  shapePaneDocx,
} from '../../react/test/shape-pane-parity.ts';

let mounted: MountedEditor | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function paneMarkup(fill: string | null): Promise<string> {
  mounted = mountEditorTree(
    () => h(DocxEditorShapePane),
    shapePaneDocx(fill ?? SHAPE_PANE_CASES.solid)
  );
  await flush();
  if (fill) selectParityShape(mounted.editor());
  await flush();
  const pane = mounted.container.querySelector('.docx-shape-pane');
  if (!pane) throw new Error('no pane');
  const html = normalizeShapePaneMarkup(pane.outerHTML);
  mounted.unmount();
  mounted = undefined;
  return html;
}

test('the Vue Format shape pane renders the markup of the React pane', async () => {
  const expected = JSON.parse(readFileSync(SHAPE_PANE_MARKUP_PATH, 'utf8')) as Record<
    string,
    string
  >;
  expect(await paneMarkup(null)).toBe(expected.none!);
  for (const [name, fill] of Object.entries(SHAPE_PANE_CASES))
    expect(await paneMarkup(fill)).toBe(expected[name]!);
});

const input = (root: HTMLElement, label: string): HTMLInputElement =>
  root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

function type(field: HTMLInputElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

test('the side panel swaps to the pane; keyboard picks, typed fields, undo, and a delete', async () => {
  mounted = mountEditorTree(
    () => h(DocxEditorSidePanel, { onClose: () => {} }),
    shapePaneDocx(SHAPE_PANE_CASES.theme)
  );
  await flush();
  const editor = mounted.editor();
  const panel = mounted.container.querySelector<HTMLElement>('.docx-side-panel')!;
  expect(panel.getAttribute('data-pane')).toBe('chart');
  selectParityShape(editor);
  await flush();
  expect(panel.getAttribute('data-pane')).toBe('shape');
  expect(panel.querySelector('.docx-side-panel__title')?.textContent).toBe('Format shape');

  expect(runToolbarCommand(editor, 'image.formatShape')).toEqual({ ok: true, changed: false });
  await flush();
  const fillButton = panel.querySelector<HTMLButtonElement>('.docx-shape-pane__color-button')!;
  expect(document.activeElement).toBe(fillButton);

  fillButton.click();
  await flush();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Accent 1');
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
  );
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Accent 2');
  (document.activeElement as HTMLButtonElement).click();
  await flush();
  expect(panel.querySelector('.docx-chart-pane__grid')).toBeNull();
  expect(document.activeElement).toBe(fillButton);
  expect(editor.snapshot().image?.shapeFormat?.fill.color).toBe('ED7D31');
  expect(editor.snapshot().image?.shapeFormat?.fill.theme).toEqual({ name: 'accent2', shift: 0 });

  const outlineButton = panel.querySelectorAll<HTMLButtonElement>(
    '.docx-color-picker__trigger'
  )[1]!;
  outlineButton.click();
  await flush();
  type(panel.querySelector<HTMLInputElement>('.docx-color-picker__hex input')!, '#0070C0');
  await flush();
  expect(document.activeElement).toBe(outlineButton);
  type(input(panel, 'Width (pt)'), '3');
  await flush();
  expect(editor.snapshot().image?.shapeFormat?.outline).toEqual({
    visible: true,
    color: '0070C0',
    widthPt: 3,
    dash: 'solid',
  });
  expect(panel.querySelectorAll('.docx-shape-pane__color-button')[1]?.textContent).toBe('Blue');

  editor.exec({ type: 'undo' });
  await flush();
  expect(input(panel, 'Width (pt)').value).toBe('1');
  editor.exec({ type: 'setShapeFill', color: '00B050' });
  await flush();
  expect(fillButton.getAttribute('data-color')).toBe('#00B050');
  expect(fillButton.textContent).toBe('Green');

  expect(editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
  await flush();
  expect(panel.textContent).toContain('No shape selected');
});

test('the context menu shows Format shape for a selected shape and opens the pane', async () => {
  mounted = mountEditorTree(
    () => h(DocxEditorSidePanel),
    shapePaneDocx(SHAPE_PANE_CASES.solid),
    () => h(DocxEditorContextMenu)
  );
  await flush();
  selectParityShape(mounted.editor());
  await flush();
  mounted.container
    .querySelector('.docx-editor__scroll-container')!
    .dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 })
    );
  await flush();
  const row = mounted.container.querySelector<HTMLElement>(
    '.docx-contextmenu [data-slot="image.formatShape"]'
  );
  expect(row?.textContent).toContain('Format shape');
  row!.click();
  await flush();
  const pane = mounted.container.querySelector('.docx-shape-pane')!;
  expect(pane.contains(document.activeElement)).toBe(true);
});

test('the side panel follows mode changes, remembers the shape pane, and Escape returns focus', async () => {
  let closed = 0;
  mounted = mountEditorTree(
    () => h(DocxEditorSidePanel, { onClose: () => (closed += 1) }),
    shapePaneDocx(SHAPE_PANE_CASES.theme)
  );
  await flush();
  const editor = mounted.editor();
  selectParityShape(editor);
  await flush();
  const panel = mounted.container.querySelector<HTMLElement>('.docx-side-panel')!;
  const fillButton = () =>
    panel.querySelector<HTMLButtonElement>('.docx-shape-pane__color-button')!;
  expect(fillButton().disabled).toBe(false);
  // Viewing mode changes what `can` answers, not the drawing: the fields still follow it.
  editor.exec(commandForSlotValue('review.editingMode', 'viewing')!);
  await flush();
  expect(editor.snapshot().image).not.toBeNull();
  expect(fillButton().disabled).toBe(true);
  editor.exec(commandForSlotValue('review.editingMode', 'editing')!);
  await flush();
  expect(fillButton().disabled).toBe(false);
  // Escape closes the panel, gives the keyboard to the editor, and keeps the shape selected.
  fillButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();
  expect(closed).toBe(1);
  expect(mounted.container.querySelector('.docx-pages')!.contains(document.activeElement)).toBe(
    true
  );
  expect(editor.snapshot().image?.shapeFormat).not.toBeNull();
  // A caret in text keeps the shape pane: the panel does not fall back to the chart pane.
  const paragraph = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: paragraph, offset: 1 },
    head: { paragraphId: paragraph, offset: 1 },
  });
  await flush();
  expect(editor.snapshot().image).toBeNull();
  expect(panel.getAttribute('data-pane')).toBe('shape');
  expect(panel.textContent).toContain('No shape selected');
});

for (const only of ['chart', 'shape'] as const) {
  test(`with only the ${only} pane mounted, Format shape follows the shape pane alone`, async () => {
    mounted = mountEditorTree(
      () => [
        h(DocxEditorToolbar, { overflow: false }),
        h(only === 'chart' ? DocxEditorChartPane : DocxEditorShapePane),
      ],
      shapePaneDocx(SHAPE_PANE_CASES.solid)
    );
    await flush();
    selectParityShape(mounted.editor());
    await flush();
    const formatShape = mounted.container.querySelector(
      '.docx-toolbar [data-slot="image.formatShape"]'
    );
    expect(formatShape !== null).toBe(only === 'shape');
  });
}

test('on a shape inside a group, the alt text button says why in the interface language', async () => {
  mounted = mountEditorTree(
    () => [h(DocxEditorToolbar, { overflow: false }), h(DocxEditorShapePane)],
    shapePaneDocx('', GROUP_DRAWING)
  );
  await flush();
  selectParityShape(mounted.editor());
  await flush();
  const frame = mounted.container.querySelector<HTMLElement>(
    '.docx-image-selection-overlay__frame'
  )!;
  frame.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: 192, height: 48, right: 292, bottom: 148 }) as DOMRect;
  const at = { clientX: 120, clientY: 124, button: 0, pointerId: 1 };
  frame.dispatchEvent(new PointerEvent('pointerdown', { ...at, bubbles: true, cancelable: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...at, bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flush();
  expect(mounted.editor().snapshot().image?.memberId).toBeString();
  const alt = mounted.container.querySelector<HTMLElement>(
    '.docx-toolbar [data-slot="image.altText"]'
  )!;
  expect(alt.getAttribute('title')).toBe(
    'A shape inside a group takes its wrap, alt text, and properties from the group. Press Escape to select the group.'
  );
});
