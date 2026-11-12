// The Vue twin of `packages/react/test/shape-pane-peers.test.tsx`: the Format shape pane in two
// collaborating editors, and a shape inside a group selected by a second press.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { h } from 'vue';
import { strFromU8, unzipSync } from 'fflate';
import {
  runToolbarCommand,
  toolbarCommandState,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { DocxEditorSidePanel } from '../src/editor/panes/SidePanel';
import { flush } from './helpers/fixtures';
import { mountEditorTree } from './helpers/mount';
import { collaborationModule } from '../../pro/src/collaboration/collaboration-module';
import type { DocumentCollaborationHandle } from '../../pro/src/collaboration/document-session';
import { createPeerHarness } from '../../pro/src/collaboration/__tests__/document-peer-support';
import {
  GROUP_DRAWING,
  SHAPE_PANE_CASES,
  selectParityShape,
  shapePaneDocx,
} from '../../react/test/shape-pane-parity.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function update(action: () => unknown = () => {}) {
  action();
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await flush();
}

async function mount(room: DocumentCollaborationHandle) {
  const mounted = mountEditorTree(
    () => h(DocxEditorSidePanel, { onClose: () => {} }),
    room.document,
    () => [],
    [collaborationModule({ session: room.session })]
  );
  cleanups.push(() => mounted.unmount());
  await update();
  const panel = () => mounted.container.querySelector<HTMLElement>('.docx-side-panel')!;
  return {
    container: mounted.container,
    editor: mounted.editor,
    panel,
    input: (label: string) =>
      panel().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!,
    fillButton: () => panel().querySelector<HTMLButtonElement>('.docx-shape-pane__color-button')!,
    /** The hex field of the fill grid; opens the grid first. */
    fillHex: async () => {
      const open = () => panel().querySelector<HTMLInputElement>('.docx-color-picker__hex input');
      if (!open())
        await update(() =>
          panel().querySelector<HTMLButtonElement>('.docx-shape-pane__color-button')!.click()
        );
      return open()!;
    },
  };
}

const xml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

async function pair(bytes: Uint8Array, name: string) {
  const harness = createPeerHarness(name, { offlineEditing: true });
  const { alice, bob } = await harness.pair(bytes);
  alice.detach();
  bob.detach();
  const left = await mount(alice.room);
  const right = await mount(bob.room);
  cleanups.push(() => harness.cleanup());
  return { left, right };
}

function type(field: HTMLInputElement, value: string, enter = true): void {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  if (enter) field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

test('a remote delete while the color grid is open closes the grid and empties the pane', async () => {
  const { left, right } = await pair(shapePaneDocx(SHAPE_PANE_CASES.theme), 'vue-pane-delete');
  await update(() => selectParityShape(left.editor()));
  await update(() => left.fillButton().click());
  expect(left.panel().querySelector('.docx-chart-pane__grid')).not.toBeNull();
  await update(() => selectParityShape(right.editor()));
  await update(() =>
    expect(right.editor().exec({ type: 'deleteImage' })).toMatchObject({ ok: true })
  );
  expect(left.panel().querySelector('.docx-chart-pane__grid')).toBeNull();
  expect(left.panel().textContent).toContain('No shape selected');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
  await update(() => right.editor().exec({ type: 'undo' }));
  expect(await xml(left.editor())).toContain('<wps:wsp>');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});

test('a remote recolor keeps a hex draft in the field, and Enter then writes the draft', async () => {
  const { left, right } = await pair(shapePaneDocx(SHAPE_PANE_CASES.solid), 'vue-pane-draft');
  await update(() => selectParityShape(left.editor()));
  const hex = await left.fillHex();
  await update(() => type(hex, '#123456', false));
  await update(() => selectParityShape(right.editor()));
  await update(() => right.editor().exec({ type: 'setShapeFill', color: 'FF0000' }));
  // The remote color shows on the button; the open grid and the typed draft stay.
  expect(left.fillButton().getAttribute('data-color')).toBe('#FF0000');
  const draft = await left.fillHex();
  expect(draft.value).toBe('#123456');
  await update(() =>
    draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  );
  expect(right.editor().snapshot().image?.shapeFormat?.fill.color).toBe('123456');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});

test('undo after a remote edit takes back the local edit only', async () => {
  const { left, right } = await pair(shapePaneDocx(SHAPE_PANE_CASES.solid), 'vue-pane-undo');
  await update(() => selectParityShape(left.editor()));
  await update(() => type(left.input('Width (pt)'), '3'));
  await update(() => selectParityShape(right.editor()));
  await update(() => right.editor().exec({ type: 'setShapeFill', color: 'FF0000' }));
  await update(() => left.editor().exec({ type: 'undo' }));
  for (const side of [left, right])
    expect(side.editor().snapshot().image?.shapeFormat).toMatchObject({
      fill: { color: 'FF0000' },
      outline: { widthPt: 1 },
    });
  expect(left.input('Width (pt)').value).toBe('1');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});

async function pressFrameAt(container: HTMLElement, fraction: number) {
  const frame = container.querySelector<HTMLElement>('.docx-image-selection-overlay__frame')!;
  frame.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: 192, height: 48, right: 292, bottom: 148 }) as DOMRect;
  const at = { clientX: 100 + 192 * fraction, clientY: 124, button: 0, pointerId: 1 };
  await update(() => {
    frame.dispatchEvent(
      new PointerEvent('pointerdown', { ...at, bubbles: true, cancelable: true })
    );
    window.dispatchEvent(new PointerEvent('pointerup', { ...at, bubbles: true }));
  });
}

test('a second press selects a shape inside a group; the selection stays local, edits sync', async () => {
  const { left, right } = await pair(shapePaneDocx('', GROUP_DRAWING), 'vue-pane-member');
  await update(() => selectParityShape(left.editor()));
  expect(left.fillButton().textContent).toContain('Mixed');
  await pressFrameAt(left.container, 0.25);
  const memberId = left.editor().snapshot().image?.memberId;
  expect(memberId).toBeString();
  expect(left.fillButton().getAttribute('data-color')).toBe('#9DC3E6');
  expect(right.editor().snapshot().image).toBeNull();

  const hex = await left.fillHex();
  await update(() => type(hex, '#FF0000'));
  let saved = await xml(right.editor());
  expect(saved).toContain('<a:srgbClr val="FF0000"/>');
  expect(saved).toContain('<a:srgbClr val="A9D18E"/>');
  expect(left.editor().snapshot().image?.memberId).toBe(memberId);

  await update(() => selectParityShape(right.editor()));
  await pressFrameAt(right.container, 0.75);
  expect(right.editor().snapshot().image?.memberId).not.toBe(memberId);
  await update(() => right.editor().exec({ type: 'setShapeFill', color: '7030A0' }));
  expect(left.fillButton().getAttribute('data-color')).toBe('#FF0000');
  expect(left.editor().snapshot().image?.memberId).toBe(memberId);

  expect(left.editor().exec({ type: 'deleteImage' })).toMatchObject({
    ok: false,
    code: 'unsupported',
  });
  const overlay = left.container.querySelector<HTMLElement>('.docx-image-selection-overlay')!;
  await update(() =>
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  );
  expect(left.editor().snapshot().image?.memberId).toBeUndefined();
  expect(left.fillButton().textContent).toContain('Mixed');

  await update(() =>
    expect(left.editor().exec({ type: 'deleteImage' })).toMatchObject({ ok: true })
  );
  expect(right.panel().textContent).toContain('No shape selected');
  saved = await xml(left.editor());
  expect(saved).toBe(await xml(right.editor()));
  expect(saved).not.toContain('<wpg:wgp>');
});

test('a dash syncs to the other peer; slot commands on a shape the other peer deleted refuse', async () => {
  const { left, right } = await pair(shapePaneDocx(SHAPE_PANE_CASES.solid), 'vue-pane-dash');
  await update(() => selectParityShape(left.editor()));
  await update(() => selectParityShape(right.editor()));
  // The dash part in the pane writes the dash, and the other peer reads it back.
  const dash = left
    .panel()
    .querySelector<HTMLSelectElement>('[data-slot="shape.outlineDash"] select')!;
  await update(() => {
    dash.value = 'sysDash';
    dash.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(right.editor().snapshot().image?.shapeFormat?.outline.dash).toBe('sysDash');
  expect(await xml(right.editor())).toContain('<a:prstDash val="sysDash"/>');
  // Concurrent edits converge: a remote width and a local dash both land.
  await update(() => {
    runToolbarCommand(right.editor(), 'shape.outlineWidth', 4.5);
    runToolbarCommand(left.editor(), 'shape.outlineDash', 'lgDash');
  });
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
  expect(left.editor().snapshot().image?.shapeFormat?.outline).toMatchObject({
    widthPt: 4.5,
    dash: 'lgDash',
  });
  // Undo takes back the local dash only.
  await update(() => left.editor().exec({ type: 'undo' }));
  expect(right.editor().snapshot().image?.shapeFormat?.outline).toMatchObject({
    widthPt: 4.5,
    dash: 'sysDash',
  });
  // The right peer deletes the shape: the left slots disable and a run refuses.
  await update(() =>
    expect(right.editor().exec({ type: 'deleteImage' })).toMatchObject({ ok: true })
  );
  expect(toolbarCommandState(left.editor(), 'shape.outlineDash').enabled).toBe(false);
  expect(runToolbarCommand(left.editor(), 'shape.outlineDash', 'dot')).toMatchObject({ ok: false });
  expect(left.panel().textContent).toContain('No shape selected');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});
