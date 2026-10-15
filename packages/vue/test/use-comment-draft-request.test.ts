// The Vue twin of `packages/react/test/use-comment-draft-request.test.tsx`.

import './dom-setup.ts';
import { afterEach, expect, mock, test } from 'bun:test';
import { defineComponent, h, onBeforeUnmount } from 'vue';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { en } from '@docx-editor.dev/i18n';
import { useReviewRailRegistry } from '../src/editor/context';
import { useEditorCommand } from '../src/editor/useEditorCommand';
import { useCommentDraftRequest } from '../src/editor/useCommentDraftRequest';
import { flush, mountEditorTree, type MountedEditor } from './helpers/mount';

const mounted: MountedEditor[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

const review = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'proposed', 'original'],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  },
} as EditorModule;

/** A host's own Add comment button over the slot. */
const HostButton = defineComponent({
  setup() {
    const addComment = useEditorCommand('review.addComment');
    return () =>
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'host-add-comment',
          disabled: !addComment.isEnabled.value,
          title: addComment.disabledReason.value ?? '',
          onClick: () => addComment.execute(),
        },
        'Add comment'
      );
  },
});

function hostDraft(onDraft: () => void) {
  return defineComponent({
    setup() {
      useCommentDraftRequest(onDraft);
      return () => null;
    },
  });
}

function fakeRail(onDraft: () => void) {
  return defineComponent({
    setup() {
      const rail = useReviewRailRegistry();
      const unregister = rail.value.register();
      const release = rail.value.registerCommentDraft(onDraft);
      onBeforeUnmount(() => {
        unregister();
        release();
      });
      return () => null;
    },
  });
}

async function mount(server: ReturnType<typeof defineComponent>) {
  const view = mountEditorTree(
    () => [h(HostButton)],
    undefined,
    () => [h(server)],
    [review]
  );
  mounted.push(view);
  await flush();
  // happy-dom lays nothing out, so the selection has no place on the page by itself.
  (view.editor() as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement =
    () => ({ anchorY: 10 });
  const button = () =>
    view.container.querySelector<HTMLButtonElement>('[data-testid="host-add-comment"]')!;
  // Remount the server, so its registration is asked about with the stub in place.
  view.viewportVisible.value = false;
  await flush();
  return { view, button };
}

test('useCommentDraftRequest enables the button, serves the press, and unmounting disables it', async () => {
  const onDraft = mock(() => {});
  const { view, button } = await mount(hostDraft(onDraft));
  expect(button().disabled).toBe(true);
  expect(button().title).toBe(en.disabledReason.noCommentDraftView);
  view.viewportVisible.value = true;
  await flush();
  expect(button().disabled).toBe(false);
  button().click();
  expect(onDraft).toHaveBeenCalledTimes(1);
  view.viewportVisible.value = false;
  await flush();
  expect(button().disabled).toBe(true);
  expect(button().title).toBe(en.disabledReason.noCommentDraftView);
});

test('a review rail registered through the registry still serves the press', async () => {
  const onDraft = mock(() => {});
  const { view, button } = await mount(fakeRail(onDraft));
  expect(button().disabled).toBe(true);
  view.viewportVisible.value = true;
  await flush();
  expect(button().disabled).toBe(false);
  button().click();
  expect(onDraft).toHaveBeenCalledTimes(1);
  view.viewportVisible.value = false;
  await flush();
  expect(button().disabled).toBe(true);
});
