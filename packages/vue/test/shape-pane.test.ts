// The Vue Format shape pane renders the markup of the React pane (both match
// `packages/react/test/shape-pane-markup.json`), and the side panel swaps to it for a selected
// shape, takes the keyboard path through the grid and the fields, and empties when the shape
// goes.

import './dom-setup.ts';

import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'bun:test';
import { h } from 'vue';
import { runToolbarCommand } from '@docx-editor.dev/core/editor';
import { DocxEditorShapePane } from '../src/editor/shapes/ShapePane';
import { DocxEditorSidePanel } from '../src/editor/charts/SidePanel';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';
import {
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
    shapePaneDocx(SHAPE_PANE_CASES.solid)
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

  type(input(panel, 'Outline hex color'), '#0070C0');
  await flush();
  type(input(panel, 'Width (pt)'), '3');
  await flush();
  expect(editor.snapshot().image?.shapeFormat?.outline).toEqual({
    visible: true,
    color: '0070C0',
    widthPt: 3,
  });
  expect(panel.querySelectorAll('.docx-shape-pane__color-button')[1]?.textContent).toBe('Blue');

  editor.exec({ type: 'undo' });
  await flush();
  expect(input(panel, 'Width (pt)').value).toBe('1');
  editor.exec({ type: 'setShapeFill', color: '00B050' });
  await flush();
  expect(input(panel, 'Fill hex color').value).toBe('#00B050');

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
