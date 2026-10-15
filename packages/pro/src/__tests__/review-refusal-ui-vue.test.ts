/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of `review-refusal-ui.test.tsx`: the packaged card names why an action did not
// land, and the notice goes away once the state that caused it changes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { defineComponent, h } from 'vue';
import { TRACKED, flush, waitFor } from './review-vue-harness.ts';
import { DocxEditorReview } from '../vue/DocxEditorReview.tsx';
import { useReview } from '../vue/useReview.ts';
import { reviewModule } from '../index.ts';
import { mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import {
  stubCollaborationModule,
  stubCollaborationSession,
} from '../../../core/src/editor/__tests__/collaboration-test-module.ts';

afterEach(() => document.body.replaceChildren());

const WAITING = 'Waiting for the shared session. Try again in a moment.';

/** A custom component with its OWN `useReview()`, beside the packaged rail. */
const CustomProbe = defineComponent({
  setup() {
    const review = useReview();
    return () =>
      h('output', { 'data-testid': 'custom-probe' }, review.lastRefusal.value?.code ?? '');
  },
});

function mount() {
  const session = stubCollaborationSession({
    gateOperations: () => 'collaboration-session-not-ready',
  });
  return mountEditorTree(
    () => [h(CustomProbe)],
    TRACKED,
    () => [h(DocxEditorReview)],
    [reviewModule(), stubCollaborationModule(session)],
    { author: 'Grace Hopper' }
  );
}

const query = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

test('a refused accept names its cause on the card until the state changes', async () => {
  const mounted = mount();
  try {
    await flush();
    await waitFor(() => query(mounted.container, 'review-accept') !== null);
    expect(query(mounted.container, 'review-refusal')).toBeNull();

    query(mounted.container, 'review-accept')!.click();
    await flush();
    await waitFor(() => query(mounted.container, 'review-refusal') !== null);
    const notice = query(mounted.container, 'review-refusal')!;
    expect(notice.textContent).toBe(WAITING);
    expect(notice.dataset.refusalCode).toBe('edit.collaboration-not-ready');
    expect(notice.getAttribute('role')).toBeNull();
    expect(query(mounted.container, 'review-refusal-live')!.textContent).toBe(WAITING);
    expect(query(mounted.container, 'custom-probe')!.textContent).toBe(
      'edit.collaboration-not-ready'
    );
    expect(mounted.container.querySelectorAll('[data-testid="review-card"]')).toHaveLength(1);

    // A caret move is not a change of cause.
    mounted.editor().surface!.selectAll();
    await flush();
    expect(query(mounted.container, 'review-refusal')?.textContent).toBe(WAITING);

    mounted.editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    await flush();
    await waitFor(() => query(mounted.container, 'review-refusal') === null);
    expect(query(mounted.container, 'review-refusal-live')!.textContent).toBe('');
    expect(query(mounted.container, 'custom-probe')!.textContent).toBe('');
  } finally {
    mounted.unmount();
  }
});

test('a refused reply names its cause in the reply line', async () => {
  const mounted = mount();
  try {
    await flush();
    const revision = mounted
      .editor()
      .getReviewItems({ pairReplacements: false })
      .find((item) => item.kind === 'revision')!;
    mounted.editor().setActiveReviewItem(revision.key);
    await flush();
    await waitFor(() => query(mounted.container, 'review-reply-input') !== null);
    const input = query(mounted.container, 'review-reply-input') as HTMLInputElement;
    input.value = 'Looks right';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    query(mounted.container, 'review-reply-submit')!.click();
    await flush();
    await waitFor(() => query(mounted.container, 'review-reply-refused') !== null);
    expect(query(mounted.container, 'review-reply-refused')!.textContent).toBe(WAITING);
    expect(query(mounted.container, 'review-refusal')).toBeNull();
    // Recorded in the editor's store like any other refused write, and announced by the rail.
    expect(query(mounted.container, 'custom-probe')!.textContent).toBe(
      'edit.collaboration-not-ready'
    );
    expect(query(mounted.container, 'review-refusal-live')!.textContent).toBe(WAITING);
  } finally {
    mounted.unmount();
  }
});
