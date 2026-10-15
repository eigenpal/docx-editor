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
import { h } from 'vue';
import { TRACKED, flush, waitFor } from './review-vue-harness.ts';
import { DocxEditorReview } from '../vue/DocxEditorReview.tsx';
import { reviewModule } from '../index.ts';
import { mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import {
  stubCollaborationModule,
  stubCollaborationSession,
} from '../../../core/src/editor/__tests__/collaboration-test-module.ts';

afterEach(() => document.body.replaceChildren());

test('a refused accept names its cause on the card until the state changes', async () => {
  const session = stubCollaborationSession({
    gateOperations: () => 'collaboration-session-not-ready',
  });
  const mounted = mountEditorTree(
    () => [],
    TRACKED,
    () => [h(DocxEditorReview)],
    [reviewModule(), stubCollaborationModule(session)],
    { author: 'Grace Hopper' }
  );
  try {
    await flush();
    await waitFor(() => mounted.container.querySelector('[data-testid="review-accept"]') !== null);
    expect(mounted.container.querySelector('[data-testid="review-refusal"]')).toBeNull();

    (mounted.container.querySelector('[data-testid="review-accept"]') as HTMLElement).click();
    await flush();
    await waitFor(() => mounted.container.querySelector('[data-testid="review-refusal"]') !== null);
    const notice = mounted.container.querySelector('[data-testid="review-refusal"]') as HTMLElement;
    expect(notice.textContent).toBe('Waiting for the shared session. Try again in a moment.');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.dataset.refusalCode).toBe('edit.collaboration-not-ready');
    expect(mounted.container.querySelectorAll('[data-testid="review-card"]')).toHaveLength(1);

    mounted.editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    await flush();
    await waitFor(() => mounted.container.querySelector('[data-testid="review-refusal"]') === null);
  } finally {
    mounted.unmount();
  }
});
