/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { defineComponent, h, nextTick, onMounted, onUnmounted } from 'vue';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { DocxEditorNavigation } from '../src/editor/navigation';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading';
import { DocxEditorHorizontalRuler } from '../src/editor/DocxEditorRulers';
import { useReviewRailRegistry } from '../src/editor/context';
import { useNavigationLayoutStore } from '../src/editor/navigation/navigation-layout';
import { LARGE_SOURCE, SOURCE } from './helpers/fixtures';
import { flush, mountEditorTree } from './helpers/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

const REVIEW_MODULE: EditorModule = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'proposed', 'original'],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  },
};

const RailRegistrar = defineComponent({
  setup() {
    const rail = useReviewRailRegistry();
    let unregister: (() => void) | undefined;
    onMounted(() => {
      unregister = rail.value.register();
    });
    onUnmounted(() => {
      unregister?.();
    });
    return () => null;
  },
});

let railUnregister: (() => void) | undefined;

const DynamicRail = defineComponent({
  setup() {
    const rail = useReviewRailRegistry();
    onMounted(() => {
      railUnregister = rail.value.register();
    });
    return () => null;
  },
});

const ShiftWriter = defineComponent({
  setup() {
    const store = useNavigationLayoutStore();
    onMounted(() => {
      store?.setShift(128);
    });
    return () => null;
  },
});

describe('DocxEditorViewport review rail', () => {
  test('omits data-review-pane when no rail is mounted', async () => {
    const view = mountEditorTree(() => []);
    await flush();
    const scroller = view.container.querySelector('[data-testid="docx-editor-scroll"]');
    expect(scroller).not.toBeNull();
    expect(scroller!.hasAttribute('data-review-pane')).toBe(false);
    expect((scroller as HTMLElement).style.getPropertyValue('--docx-review-gutter')).toBe('');
    expect((scroller as HTMLElement).style.getPropertyValue('--docx-review-gutter-start')).toBe('');
    view.unmount();
  });

  test('sets data-review-pane and nav shift when a rail mounts', async () => {
    const view = mountEditorTree(
      () => [
        h(RailRegistrar),
        h(DocxEditorNavigation, { t: (key: string) => key }),
        h(DocxEditorLoading, { when: true, overlay: true }),
      ],
      SOURCE,
      () => [],
      [REVIEW_MODULE]
    );
    await flush();
    view.editor().exec({ type: 'toggleReviewPane' });
    await flush();
    const scroller = view.container.querySelector(
      '[data-testid="docx-editor-scroll"]'
    ) as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.hasAttribute('data-review-pane')).toBe(true);
    const shift = scroller.style.getPropertyValue('--docx-nav-shift');
    expect(shift).not.toBe('');
    expect(Number.parseFloat(shift)).toBeGreaterThanOrEqual(0);
    expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('316px');
    expect(scroller.style.getPropertyValue('--docx-review-gutter-start')).toBe('0px');
    const loading = view.container.querySelector('.docx-editor__loading') as HTMLElement;
    expect(loading.style.getPropertyValue('--docx-loading-inline-start')).toBe('0px');
    expect(loading.style.getPropertyValue('--docx-loading-right')).toBe('0px');
    view.unmount();
  });

  test('clears data-review-pane when a rail unregisters while Viewport stays mounted', async () => {
    const view = mountEditorTree(() => h(DynamicRail));
    await flush();
    const scroller = view.container.querySelector(
      '[data-testid="docx-editor-scroll"]'
    ) as HTMLElement;
    expect(scroller.hasAttribute('data-review-pane')).toBe(true);
    railUnregister?.();
    await flush();
    expect(scroller.hasAttribute('data-review-pane')).toBe(false);
    view.unmount();
  });

  test('applies nav shift to the viewport but keeps the loading page centred', async () => {
    const view = mountEditorTree(() => [
      h(ShiftWriter),
      h(DocxEditorLoading, { when: true, overlay: true }),
    ]);
    await flush();
    const scroller = view.container.querySelector(
      '[data-testid="docx-editor-scroll"]'
    ) as HTMLElement;
    expect(scroller.style.getPropertyValue('--docx-nav-shift')).toBe('128px');
    const loading = view.container.querySelector('.docx-editor__loading') as HTMLElement;
    expect(loading.style.getPropertyValue('--docx-loading-inline-start')).toBe('0px');
    expect(loading.style.getPropertyValue('--docx-loading-right')).toBe('0px');
    view.unmount();
  });

  test('snaps the ruler reservation while a replacement document opens', async () => {
    const view = mountEditorTree(() => [
      h(DocxEditorHorizontalRuler),
      h(DocxEditorLoading, { overlay: true }),
    ]);
    await flush();

    view.editor().load(LARGE_SOURCE);
    expect(view.editor().snapshot().isOpening).toBe(true);
    await nextTick();
    await nextTick();

    expect(view.container.querySelector('.docx-ruler-frame--opening')).not.toBeNull();
    await flush();
    expect(view.container.querySelector('.docx-ruler-frame--opening')).toBeNull();
    view.unmount();
  });
});
