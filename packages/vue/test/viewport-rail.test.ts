/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { defineComponent, h, onMounted, onUnmounted } from 'vue';
import { DocxEditorNavigation } from '../src/editor/navigation';
import { useReviewRailRegistry } from '../src/editor/context';
import { useNavigationLayoutStore } from '../src/editor/navigation/navigation-layout';
import { flush, mountEditorTree } from './helpers/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

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
    view.unmount();
  });

  test('sets data-review-pane and nav shift when a rail mounts', async () => {
    const view = mountEditorTree(() => [
      h(RailRegistrar),
      h(DocxEditorNavigation, { t: (key: string) => key }),
    ]);
    await flush();
    const scroller = view.container.querySelector(
      '[data-testid="docx-editor-scroll"]'
    ) as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.hasAttribute('data-review-pane')).toBe(true);
    const shift = scroller.style.getPropertyValue('--docx-nav-shift');
    expect(shift).not.toBe('');
    expect(Number.parseFloat(shift)).toBeGreaterThanOrEqual(0);
    view.unmount();
  });

  test('applies nav shift from the layout store outside render', async () => {
    const view = mountEditorTree(() => h(ShiftWriter));
    await flush();
    const scroller = view.container.querySelector(
      '[data-testid="docx-editor-scroll"]'
    ) as HTMLElement;
    expect(scroller.style.getPropertyValue('--docx-nav-shift')).toBe('128px');
    view.unmount();
  });
});
