/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { findPaintedRevisionElement } from '../react/review-balloon-anchor.ts';
import { reviewModule } from '../index.ts';
import {
  source,
  navigationSource,
  checkFormattingPageBalloons,
} from './formatting-page-balloon-harness.ts';

test('React: paragraph and empty-mark formatting opens page balloons without sidebar cards or pilcrows', async () => {
  let editor: DocxEditorInstance | undefined;
  const mounted = render(
    <DocxEditorRoot
      document={source}
      modules={[reviewModule()]}
      onReady={(instance) => {
        editor = instance as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  try {
    await checkFormattingPageBalloons(mounted.container, editor!, async (run) => {
      await act(async () => {
        run();
      });
    });
  } finally {
    mounted.unmount();
  }
});

test('React: Next and Previous Change open a rail-hidden format balloon', async () => {
  let editor: DocxEditorInstance | undefined;
  const mounted = render(
    <DocxEditorRoot
      document={navigationSource}
      modules={[reviewModule()]}
      onReady={(instance) => {
        editor = instance as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const formatItem = editor!
    .getReviewItems({ placement: false })
    .find((item) => item.kind === 'revision' && item.revisionKind === 'format')!;
  const probe = document.createElement('div');
  for (const kind of ['insert', 'format']) {
    const element = document.createElement('span');
    element.dataset.revisionId = '3';
    element.dataset.reviewAuthor = 'Ada Lovelace';
    element.dataset.revisionDate = '2026-01-02T03:04:05Z';
    element.dataset.revisionKind = kind;
    if (kind === 'format') element.dataset.formattingKind = 'rPrChange';
    probe.append(element);
  }
  expect(findPaintedRevisionElement(probe, formatItem)?.dataset.revisionKind).toBe('format');
  expect(mounted.getByTestId('review-rail').getAttribute('data-count')).toBe('1');
  await act(async () => {
    editor!.exec({ type: 'navigateReviewChange', direction: 'next' });
  });
  expect(mounted.getByTestId('review-balloon-card').dataset.kind).toBe('format');
  await act(async () => {
    editor!.exec({ type: 'navigateReviewChange', direction: 'next' });
  });
  expect(mounted.queryByTestId('review-balloon')).toBeNull();
  expect((mounted.getByTestId('review-card') as HTMLElement).dataset.kind).toBe('insert');
  await act(async () => {
    editor!.exec({ type: 'navigateReviewChange', direction: 'previous' });
  });
  expect(mounted.getByTestId('review-balloon-card').dataset.kind).toBe('format');
  mounted.container.querySelector('[data-revision-kind="format"]')?.remove();
  await act(async () => {
    editor!.exec({ type: 'navigateReviewChange', direction: 'next' });
  });
  await act(async () => {
    editor!.exec({ type: 'navigateReviewChange', direction: 'previous' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(mounted.queryByTestId('review-balloon')).toBeNull();
  mounted.unmount();
});
