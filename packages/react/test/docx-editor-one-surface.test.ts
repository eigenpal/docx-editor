// React one-surface wiring contract (interactive-paginated-editing 6.2).
//
// These assert the wiring rules that keep the adapter honest without a DOM: the
// adapter must route real events through the shared bridge, must not implement
// geometry, and must not reach around the public Editor facade. The browser
// proof that a click actually places a caret is M3.1/M3.2 — this file is the
// static half that a headless run can enforce on every commit.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', 'src');
const editorSource = readFileSync(join(SRC, 'DocxEditor.tsx'), 'utf8');
const paintSource = readFileSync(join(SRC, 'paintDisplay.tsx'), 'utf8');

describe('React one-surface wiring (task 6.2)', () => {
  test('pointer and keyboard input route through the shared adapter bridge', () => {
    expect(editorSource).toContain('attachAdapterEventBridge');
    // The adapter must not hand-roll listeners for input the bridge owns —
    // that is exactly how React and Vue drift apart.
    for (const forbidden of ['onPointerDown=', 'onPointerMove=', 'onPointerUp=', 'onClick=', 'onKeyDown=']) {
      expect(editorSource).not.toContain(forbidden);
    }
  });

  test('the bridge is given the public editor port, not engine internals', () => {
    expect(editorSource).toContain('dispatchInteraction');
    expect(editorSource).toContain('getInteractionFrame');
  });

  test('overlays and click target come from engine helpers, never adapter math', () => {
    expect(editorSource).toContain('overlaysForFrame');
    expect(editorSource).toContain('firstEditableGlyphTarget');
    // No adapter-side geometry derivation.
    for (const forbidden of ['getBoundingClientRect', 'getClientRects', 'elementFromPoint', 'caretRangeFromPoint']) {
      expect(editorSource).not.toContain(forbidden);
      expect(paintSource).not.toContain(forbidden);
    }
  });

  test('host metrics come from the shared measurement helper', () => {
    expect(editorSource).toContain('measureInteractionHostMetrics');
  });

  test('the adapter never imports ProseMirror or a private engine package', () => {
    for (const forbidden of ['prosemirror', 'engine-binding', 'engine-layout', 'engine-core']) {
      expect(editorSource.toLowerCase()).not.toContain(forbidden);
    }
  });

  test('the surface uses the shared one-surface CSS classes, not inline forks', () => {
    expect(editorSource).toContain('ep-one-surface');
    expect(paintSource).toContain('ep-one-surface__page');
    expect(paintSource).toContain('ep-one-surface__content');
    expect(paintSource).toContain('ep-one-surface__overlay');
  });

  test('the frame lifecycle repaints overlays on selection change', () => {
    expect(editorSource).toContain("'selectionChange'");
  });

  test('the event bridge is detached on unmount', () => {
    // attachAdapterEventBridge returns a disposer; an adapter that drops it
    // leaks listeners onto a destroyed editor.
    expect(editorSource).toMatch(/detach|dispose/i);
  });

  test('zoom is reported to the engine rather than corrected in paint', () => {
    expect(editorSource).toContain('measureInteractionHostMetrics');
    expect(paintSource).not.toContain('zoom');
  });
});
