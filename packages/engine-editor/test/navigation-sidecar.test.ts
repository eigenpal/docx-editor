// Navigation sidecar immutability and lifecycle tests (task 5.5 review).

import { describe, expect, test } from 'bun:test';
import { NavigationSidecarStore } from '../src/navigation-sidecar-store.ts';
import { freezeNavigationGeometry } from '../src/navigation-geometry.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import { publishFrameBundle } from './interaction-test-helpers.ts';

const sample = () =>
  freezeNavigationGeometry({
    visualLines: [],
    traversalByBlockId: { 'p-1': { previousEditableBlockId: null, nextEditableBlockId: null } },
    shapingSupported: true,
    semanticHorizontalBoundariesByBlockId: {},
    paintFragmentConflicts: [],
  });

describe('navigation sidecar store (task 5.5 review)', () => {
  test('published geometry is deeply frozen and record-backed', () => {
    const store = new NavigationSidecarStore();
    const id = { value: 1 };
    store.publish(id, sample());
    const geo = store.get(id);
    expect(Object.isFrozen(geo)).toBe(true);
    expect(Object.isFrozen(geo.traversalByBlockId)).toBe(true);
    expect(() => {
      (geo.traversalByBlockId as Record<string, unknown>)['x'] = {};
    }).toThrow();
  });

  test('selection rebase shares frozen geometry across frame ids', () => {
    const store = new NavigationSidecarStore();
    const layoutId = { value: 1 };
    const selId = { value: 2 };
    store.publish(layoutId, sample());
    store.rebase(layoutId, selId);
    expect(store.get(selId)).toBe(store.get(layoutId));
  });

  test('clear removes retained geometry', () => {
    const store = new NavigationSidecarStore();
    store.publish({ value: 3 }, sample());
    store.clear();
    expect(store.get({ value: 3 }).visualLines).toEqual([]);
  });

  test('prunes retained geometry to max two frame ids', () => {
    const store = new NavigationSidecarStore();
    for (let i = 1; i <= 4; i += 1) store.publish({ value: i }, sample());
    expect(store.get({ value: 1 }).visualLines).toEqual([]);
    expect(store.get({ value: 2 }).visualLines).toEqual([]);
    expect(store.get({ value: 3 }).visualLines).toEqual([]);
    expect(store.get({ value: 4 }).shapingSupported).toBe(true);
  });

  test('InteractionFrameStore seeds sidecar on layout and clears on destroy', () => {
    const { frame, navigation, store } = publishFrameBundle();
    expect(navigation.visualLines.length).toBeGreaterThan(0);
    const layoutId = frame.id;
    const selFrame = store.publishSelection({
      layoutRevision: frame.revisions.layoutRevision,
      modelRevision: frame.revisions.modelRevision,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: frame.focus,
      composition: frame.composition,
      currentPage: frame.currentPage,
    });
    expect(store.getNavigationGeometry(selFrame.id)).toBe(navigation);
    store.clearNavigationSidecar();
    expect(store.getNavigationGeometry(layoutId).visualLines).toEqual([]);
    expect(store.getNavigationGeometry(selFrame.id).visualLines).toEqual([]);
  });
});
