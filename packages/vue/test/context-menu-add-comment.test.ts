// The Vue twin of `packages/react/test/context-menu-add-comment.test.tsx`.

import './dom-setup.ts';
import { afterEach, expect, mock, test } from 'bun:test';
import { defineComponent, h, onBeforeUnmount, type VNode } from 'vue';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { useReviewRailRegistry } from '../src/editor/context';
import { flush, mountEditorTree, type MountedEditor } from './helpers/mount';

const t = (key: string) => key;
const mounted: MountedEditor[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

const FakeRail = defineComponent({
  setup() {
    const rail = useReviewRailRegistry();
    const unregister = rail.value.register();
    const release = rail.value.registerCommentDraft(() => {});
    onBeforeUnmount(() => {
      unregister();
      release();
    });
    return () => null;
  },
});

const review = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'proposed', 'original'],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  },
} as EditorModule;

async function open(children: () => VNode[] = () => [], withRail = true) {
  const view = mountEditorTree(
    () => [],
    undefined,
    () => [
      ...(withRail ? [h(FakeRail)] : []),
      h(DocxEditorContextMenu, { t }, { default: children }),
    ],
    [review]
  );
  mounted.push(view);
  await flush();
  (view.editor() as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement =
    () => ({ anchorY: 10 });
  const surface = view.container.querySelector('.docx-paginated-surface')!;
  surface.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 })
  );
  await flush();
  return view;
}

const row = (view: MountedEditor, slot: string) =>
  view.container.querySelector<HTMLElement>(`[role="menu"] [data-slot="${slot}"]`);

async function capturingWarnings<T>(run: () => Promise<T>) {
  const warn = mock(() => {});
  const original = console.warn;
  console.warn = warn;
  try {
    const result = await run();
    return { result, messages: warn.mock.calls.map((call) => String((call as unknown[])[0])) };
  } finally {
    console.warn = original;
  }
}

test('the row shows only while a review rail is mounted', async () => {
  expect(row(await open(), 'review.addComment')).not.toBeNull();
  expect(row(await open(() => [], false), 'review.addComment')).toBeNull();
});

test('slotId names a row, the old slot prop still does, with a warning', async () => {
  const { result, messages } = await capturingWarnings(() =>
    open(() => [
      h(DocxEditorContextMenu.Slot, { slotId: 'edit.cut', hidden: true }),
      h(DocxEditorContextMenu.Slot, { slot: 'edit.selectAll', hidden: true }),
    ])
  );
  expect(row(result, 'edit.cut')).toBeNull();
  expect(row(result, 'edit.selectAll')).toBeNull();
  expect(messages.some((text) => text.includes('slot="edit.selectAll"'))).toBe(true);
});

test('a hidden override that names no row warns that it removes nothing', async () => {
  const { messages } = await capturingWarnings(() =>
    open(() => [h(DocxEditorContextMenu.Slot, { slotId: 'script.super', hidden: true })])
  );
  expect(messages.some((text) => text.includes('"script.super"'))).toBe(true);
});

test('in viewing mode the row explains itself with the translated viewing hint', async () => {
  const view = await open();
  view.editor().exec({ type: 'setEditingMode', mode: 'viewing' });
  await flush();
  const addComment = row(view, 'review.addComment');
  expect(addComment?.getAttribute('title')).toBe('editingMode.viewingHint');
});

test('a slot override with no slotId warns that it renders nothing', async () => {
  const { messages } = await capturingWarnings(() =>
    open(() => [h(DocxEditorContextMenu.Slot, { labelKey: 'nothing' } as never)])
  );
  expect(messages.some((text) => text.includes('has no slotId'))).toBe(true);
});
