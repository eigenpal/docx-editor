// Affinity normalization at the publish chokepoint (round-4 High #1).
//
// This guard did not exist. A round-5 evidence audit reverted the fix in
// `publishSelectionOverlay` and ran the entire repository suite: 1869 pass / 6 fail,
// failure set BYTE-IDENTICAL to unreverted. The highest-severity finding of round 4
// had zero permanent coverage, which is the exact failure mode this change has been
// bitten by three separate times.
//
// What the fix does: the edit surface captures a selection as
// (paragraph semId, offset, affinity) with affinity hardcoded, because it projects
// ProseMirror state and has no line geometry to derive it from. That maps to
// 'downstream' for every offset, while `caretAffinity` makes 'upstream' canonical for
// every interior offset, and the caret-rect lookup needs a stop that exists. Without
// normalization the caret is unpainted and Home/End/PageUp/PageDown/ArrowUp/ArrowDown
// are all refused — reachable from a plain click on ASCII text in both adapters.
//
// Normalization lives in `publishSelectionOverlay` rather than at each producer,
// because an earlier attempt normalized two call sites and missed the rest.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor, createEditorDriver } from '../src/index.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import { IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';
import { caretAffinity } from '../src/semantic-index.ts';

function mountEditor() {
  const body = document.createElement('div');
  const scroll = document.createElement('div');
  scroll.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, toJSON: () => ({}) }) as DOMRect;
  document.body.append(scroll);
  scroll.append(body);
  const host: EditorHost = {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => scroll,
    getInteractionHostMetrics: () => IDENTITY_HOST_METRICS,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
  const editor = createEditor({ host, document: createEditableParagraphFixture() });
  return { editor, driver: createEditorDriver(editor), body, scroll };
}

/** Every text endpoint a published frame carries must use the index's canonical affinity. */
function endpointsAreCanonical(editor: ReturnType<typeof mountEditor>['editor']): {
  checked: number;
  offenders: string[];
} {
  const frame = editor.getInteractionFrame();
  const selection = frame.selection;
  const offenders: string[] = [];
  let checked = 0;
  if (!selection) return { checked, offenders };
  for (const [name, endpoint] of [
    ['anchor', selection.anchor],
    ['head', selection.head],
  ] as const) {
    if (endpoint.kind !== 'text') continue;
    let graphemeCount: number | undefined;
    for (const story of frame.semanticIndex.stories) {
      const block = story.blocks.find((b) => b.identity.blockId === endpoint.identity.blockId);
      if (block) graphemeCount = block.graphemeCount;
    }
    if (graphemeCount === undefined) continue;
    checked += 1;
    const expected = caretAffinity(endpoint.graphemeOffset, graphemeCount);
    if (endpoint.affinity !== expected) {
      offenders.push(`${name}@${endpoint.graphemeOffset} is ${endpoint.affinity}, canonical is ${expected}`);
    }
  }
  return { checked, offenders };
}

describe('published selections carry canonical affinity', () => {
  test('a producer-supplied non-canonical affinity is normalized before publish', () => {
    // THE test for the chokepoint, and the one the first version of this file got
    // wrong. Reverting `publishSelectionOverlay`'s normalization left the suite
    // byte-identical, because `reconcileSelectionOverlayAfterLayout` normalizes at its
    // own site as well — so any path going through IT stays canonical either way.
    //
    // What only the chokepoint protects is a selection supplied by a PRODUCER:
    // whitespace hit targets, drag endpoints, and the executor's own publish callback
    // all hardcode `downstream`. Round-5 review reached this from a plain click in the
    // space between two words. Feeding a non-canonical endpoint straight through
    // `dispatchInteraction` reproduces it without needing a browser.
    const { editor, driver, scroll } = mountEditor();
    expect(driver.authorizeCaret(0, 1).ok).toBe(true);

    const frame = editor.getInteractionFrame();
    const head = frame.selection!.head;
    expect(head.kind).toBe('text');
    if (head.kind !== 'text') throw new Error('expected a text head');

    // Offset 3 is interior, so canonical affinity is 'upstream'. Claim 'downstream',
    // which is exactly what every producer hardcodes.
    const nonCanonical = { ...head, graphemeOffset: 3, affinity: 'downstream' as const };
    const result = editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: frame.id,
      selection: { frameId: frame.id, scope: frame.selection!.scope, anchor: nonCanonical, head: nonCanonical },
    } as never);
    expect(result.outcome.ok).toBe(true);

    const published = editor.getInteractionFrame().selection!.head;
    if (published.kind !== 'text') throw new Error('expected a text head');
    expect(published.graphemeOffset).toBe(3);
    // Normalized on the way in, regardless of what the caller claimed.
    expect(published.affinity).toBe('upstream');
    // And therefore paintable.
    expect(editor.getInteractionFrame().caret).not.toBeNull();

    editor.destroy();
    scroll.remove();
  });

  test('an interior caret from a commit publishes the canonical affinity and paints', () => {
    const { editor, driver, body, scroll } = mountEditor();
    const text = driver.accessibilityObservation().entries.filter((e) => e.role === 'editableParagraph')[0]!.text;
    expect(text.length).toBeGreaterThan(4);

    // Offset 2 is interior, where the surface's hardcoded affinity is WRONG.
    expect(driver.authorizeCaret(0, 2).ok).toBe(true);
    const editable = body.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertText', data: 'z', bubbles: true, cancelable: true }),
    );

    const { checked, offenders } = endpointsAreCanonical(editor);
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
    // And the consequence the normalization exists to prevent.
    expect(editor.getInteractionFrame().caret).not.toBeNull();
    expect(driver.caretClientRect()).not.toBeNull();

    editor.destroy();
    scroll.remove();
  });

  test('every published endpoint stays canonical across a range of offsets', () => {
    const { editor, driver, scroll } = mountEditor();
    const text = driver.accessibilityObservation().entries.filter((e) => e.role === 'editableParagraph')[0]!.text;
    let totalChecked = 0;
    for (let offset = 0; offset <= text.length; offset += 1) {
      if (!driver.authorizeCaret(0, offset).ok) continue;
      const { checked, offenders } = endpointsAreCanonical(editor);
      expect(offenders, `offset ${offset}`).toEqual([]);
      totalChecked += checked;
    }
    // Guard the guard: if authorizeCaret never succeeded this test would pass vacuously.
    expect(totalChecked).toBeGreaterThan(4);

    editor.destroy();
    scroll.remove();
  });

  test('a relayout republishes canonical endpoints rather than the surface constant', () => {
    const { editor, driver, scroll } = mountEditor();
    expect(driver.authorizeCaret(0, 3).ok).toBe(true);
    editor.relayout({ sync: true });

    const { checked, offenders } = endpointsAreCanonical(editor);
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
    expect(editor.getInteractionFrame().caret).not.toBeNull();

    editor.destroy();
    scroll.remove();
  });
});
