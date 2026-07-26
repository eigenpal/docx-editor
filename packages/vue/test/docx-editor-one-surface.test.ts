// Vue one-surface wiring contract (interactive-paginated-editing 6.3).
//
// The Vue mirror of `packages/react/test/docx-editor-one-surface.test.ts`. Both
// adapters are held to the SAME rules by the same assertions, so a divergence
// shows up as a failing test rather than as a behavioural surprise in M5.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VUE_SRC = join(import.meta.dir, '..', 'src');
const REACT_SRC = join(import.meta.dir, '..', '..', 'react', 'src');
const editorSource = readFileSync(join(VUE_SRC, 'DocxEditor.ts'), 'utf8');
const paintSource = readFileSync(join(VUE_SRC, 'paintDisplay.ts'), 'utf8');
const reactEditorSource = readFileSync(join(REACT_SRC, 'components', 'DocxEditor.tsx'), 'utf8');

describe('Vue one-surface wiring (task 6.3)', () => {
  test('pointer and keyboard input route through the shared adapter bridge', () => {
    expect(editorSource).toContain('attachAdapterEventBridge');
    // No hand-rolled listeners for input the bridge owns.
    for (const forbidden of ['onPointerdown', 'onPointermove', 'onPointerup', 'onClick', 'onKeydown']) {
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
    for (const forbidden of ['getBoundingClientRect', 'getClientRects', 'elementFromPoint', 'caretRangeFromPoint']) {
      expect(editorSource).not.toContain(forbidden);
      expect(paintSource).not.toContain(forbidden);
    }
  });

  test('host metrics are measured from the PAGES stack, matching React', () => {
    // Measuring the scroll container instead offsets every hit test by the
    // centering gap — the M3 bug. Both adapters must measure the same element.
    const metricsBody = (source: string): string => {
      const at = source.indexOf('getInteractionHostMetrics');
      expect(at).toBeGreaterThan(-1);
      return source.slice(at, source.indexOf('scheduleFrame', at));
    };
    for (const source of [editorSource, reactEditorSource]) {
      const body = metricsBody(source);
      expect(body).toContain('measureInteractionHostMetrics');
      expect(body).toContain('pagesEl');
      // The scroll container must not be what gets measured.
      expect(body).not.toContain('scrollEl');
      expect(body).not.toContain('scrollRef');
    }
  });

  test('the adapter never imports ProseMirror or a private engine package', () => {
    for (const forbidden of ['prosemirror', 'engine-binding', 'engine-layout', 'engine-core']) {
      expect(editorSource.toLowerCase()).not.toContain(forbidden);
    }
  });

  test('the surface uses the shared one-surface CSS classes, including ep-root', () => {
    // ep-root is the scope every --doc-* token is declared under; without it the
    // caret, selection, and page background all paint transparent (M3.2).
    expect(editorSource).toContain('ep-root');
    expect(editorSource).toContain('ep-one-surface');
    expect(paintSource).toContain('ep-one-surface__page');
    expect(paintSource).toContain('ep-one-surface__content');
    expect(paintSource).toContain('ep-one-surface__overlay');
  });

  test('the frame lifecycle repaints overlays on selection change', () => {
    expect(editorSource).toContain("'selectionChange'");
  });

  test('the event bridge is detached on unmount', () => {
    expect(editorSource).toMatch(/detach|dispose/i);
  });

  test('Vue stamps the same public click-target attribute as React', () => {
    // M2.3 shipped this in React only, by design. M5 needs both.
    expect(paintSource).toContain('ONE_SURFACE_CLICK_TARGET');
    expect(paintSource).toContain('one-surface-caret');
  });

  test('zoom is reported to the engine rather than corrected in paint', () => {
    expect(paintSource).not.toContain('zoom');
  });
});
