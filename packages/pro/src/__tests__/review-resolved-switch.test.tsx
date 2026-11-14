/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Opening a second resolved card closes the first, and the first card's close must not undo
// the second card's open. The Vue twin is review-resolved-switch-vue.test.ts.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';
import { openSecondWhileFirstOpen, TWO_RESOLVED_COMMENTS } from './review-resolved-pair-fixture.ts';

afterEach(() => {
  cleanup();
});

test('opening a second resolved card from the keyboard keeps it open', async () => {
  const view = render(
    <DocxEditorRoot document={TWO_RESOLVED_COMMENTS} modules={[reviewModule()]}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const cards = () => view.getAllByTestId('review-card') as HTMLDetailsElement[];
  expect(cards()).toHaveLength(2);
  act(() => fireEvent.click(cards()[0]!.querySelector('.docx-review__resolved-toggle')!));
  expect(cards()[0]!.open).toBe(true);

  await openSecondWhileFirstOpen(cards, () => act(async () => {}));

  expect(cards()[0]!.open).toBe(false);
  expect(cards()[1]!.open).toBe(true);
  expect(cards()[1]!.hasAttribute('data-active')).toBe(true);
});
