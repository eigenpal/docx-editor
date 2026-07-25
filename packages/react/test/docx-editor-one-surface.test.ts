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
// `components/DocxEditor.tsx`, matching the legacy React package layout that this
// adapter is being ported onto (see GOAL-legacy-react-port.md).
const editorSource = readFileSync(join(SRC, 'components', 'DocxEditor.tsx'), 'utf8');
const paintSource = readFileSync(join(SRC, 'paintDisplay.tsx'), 'utf8');
// The paged area is its own component, at the path the legacy layout uses. It holds the
// surface markup this file used to find in `DocxEditor.tsx`; the assertions moved with
// it rather than being dropped.
const pagedAreaSource = readFileSync(
  join(SRC, 'components', 'DocxEditor', 'DocxEditorPagedArea.tsx'),
  'utf8'
);

describe('React one-surface wiring (task 6.2)', () => {
  test('pointer and keyboard input route through the shared adapter bridge', () => {
    expect(editorSource).toContain('attachAdapterEventBridge');
    // The adapter must not hand-roll listeners for input the bridge owns —
    // that is exactly how React and Vue drift apart.
    // `onClick=` is NOT forbidden: the ported legacy components take click handlers for
    // their buttons (the outline toggle, header actions), and legacy's own DocxEditor
    // passes them. What must not appear is pointer/keyboard handling for the painted
    // surface, which is what the bridge owns and what actually drifts between adapters.
    for (const forbidden of ['onPointerDown=', 'onPointerMove=', 'onPointerUp=', 'onKeyDown=']) {
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
      expect(pagedAreaSource).not.toContain(forbidden);
    }
  });

  test('host metrics come from the shared measurement helper', () => {
    expect(editorSource).toContain('measureInteractionHostMetrics');
  });

  test('the adapter never imports ProseMirror or a private engine package', () => {
    for (const forbidden of ['prosemirror', 'engine-binding', 'engine-layout', 'engine-core']) {
      expect(editorSource.toLowerCase()).not.toContain(forbidden);
      expect(pagedAreaSource.toLowerCase()).not.toContain(forbidden);
    }
  });

  test('the surface uses the shared one-surface CSS classes, not inline forks', () => {
    expect(pagedAreaSource).toContain('ep-one-surface');
    expect(pagedAreaSource).toContain('ep-one-surface__pages');
    expect(pagedAreaSource).toContain('ep-one-surface__input-host');
    // The page wrapper is `layout-page` with the legacy data attributes, matching the
    // markup the legacy painter emitted so anything keyed on the page element still
    // resolves. The layers INSIDE it stay one-surface classes — those are the greenfield
    // painter's own, and they position the stack the engine's hit testing assumes.
    expect(paintSource).toContain('layout-page');
    expect(paintSource).toContain('data-page-number');
    expect(paintSource).toContain('ep-one-surface__content');
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
