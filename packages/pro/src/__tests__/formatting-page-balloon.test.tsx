/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { test } from 'bun:test';
import { act, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';
import { source, checkFormattingPageBalloons } from './formatting-page-balloon-harness.ts';

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
