// The selection frame of a turned shape rings its unturned extent, turned about its centre.
// An upright shape keeps an unturned frame. Parity with the React `turned-shape-frame` test.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';
import {
  SHAPE_PANE_CASES,
  TURNED_DRAWING,
  selectParityShape,
  shapePaneDocx,
} from '../../react/test/shape-pane-parity.ts';

let mounted: MountedEditor | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function selectedFrame(source: Uint8Array) {
  mounted = mountEditorTree(() => [], source);
  await flush();
  const editor = mounted.editor();
  selectParityShape(editor);
  await flush();
  const frame = mounted.container.querySelector<HTMLElement>(
    '.docx-image-selection-overlay__frame'
  );
  if (!frame) throw new Error('no selection frame');
  return { frame, paintScale: editor.surface!.overlayCoordinates().paintScale };
}

test('a turned shape frame is its unturned extent, turned', async () => {
  const { frame, paintScale } = await selectedFrame(shapePaneDocx('', TURNED_DRAWING));
  expect(frame.style.transform).toBe('rotate(30deg)');
  // The turned frame carries the hit band that keeps a thin turned line easy to drag.
  expect(frame.getAttribute('data-turned')).toBe('true');
  expect(parseFloat(frame.style.width)).toBeCloseTo(144 * paintScale, 3);
  expect(parseFloat(frame.style.height)).toBeCloseTo(36 * paintScale, 3);
});

test('an upright shape frame has no turn', async () => {
  const { frame, paintScale } = await selectedFrame(shapePaneDocx(SHAPE_PANE_CASES.solid));
  expect(frame.style.transform).toBe('');
  expect(frame.hasAttribute('data-turned')).toBe(false);
  expect(parseFloat(frame.style.width)).toBeCloseTo(144 * paintScale, 3);
  expect(parseFloat(frame.style.height)).toBeCloseTo(36 * paintScale, 3);
});
