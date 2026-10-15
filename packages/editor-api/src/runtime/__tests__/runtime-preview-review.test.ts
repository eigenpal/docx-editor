/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Review decisions inside a preview: `Range.revisions`, review-queue keys, and their ranges
// read and decide against the preview, and commit writes what `run()` would.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../../../../pro/src/index.ts';
import {
  DocxEditor as DocxEditorBrowser,
  getReviewItemRange,
  getReviewItemRevisions,
} from '../../browser.ts';
import type { RequestContext } from '../../index.ts';
import { REVIEW_DOCUMENT } from '../../model/__tests__/support/review-documents.ts';

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: REVIEW_DOCUMENT,
    author: 'Reviewer',
    modules: [reviewModule()],
  });
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Reviewer' });
  return {
    editor,
    runtime,
    dispose() {
      runtime.dispose();
      editor.destroy();
      container.remove();
    },
  };
}

async function saved(editor: DocxEditorInstance): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!).replace(
    / w14:(paraId|textId)="[^"]*"/g,
    ''
  );
}

/** Commit through a preview, and write the same edit with `run()` on a fresh editor. */
async function previewMatchesRun(
  edit: (context: RequestContext, key: string) => Promise<string>
): Promise<{ previewed: string; committed: string; ran: string; read: string }> {
  const a = mount();
  const b = mount();
  try {
    const key = a.editor
      .getReviewItems({ placement: false })
      .find((item) => item.kind === 'revision')!.key;
    const preview = await a.runtime.preview((context) => edit(context, key));
    const previewed = preview.result;
    await preview.commit();
    await b.runtime.run((context) => edit(context, key));
    return { previewed, committed: await saved(a.editor), ran: await saved(b.editor), read: key };
  } finally {
    b.dispose();
    a.dispose();
  }
}

describe('review decisions in a preview', () => {
  test('a key resolves its range and changes in the preview, and commits like run()', async () => {
    const outcome = await previewMatchesRun(async (context, key) => {
      const range = getReviewItemRange(context, key);
      range.load('text');
      await context.sync();
      getReviewItemRevisions(context, key).rejectAll();
      await context.sync();
      return range.text;
    });
    expect(outcome.previewed.length).toBeGreaterThan(0);
    expect(outcome.committed).toBe(outcome.ran);
  });

  test('Range.revisions reads and accepts in the preview, and commits like run()', async () => {
    const outcome = await previewMatchesRun(async (context) => {
      const body = context.document.body.getRange('Whole');
      const revisions = body.revisions;
      revisions.load('items');
      await context.sync();
      const count = revisions.items.length;
      revisions.acceptAll();
      await context.sync();
      return String(count);
    });
    expect(Number(outcome.previewed)).toBeGreaterThan(0);
    expect(outcome.committed).toBe(outcome.ran);
    expect(outcome.committed).not.toContain('<w:ins ');
  });

  test('a rebase refuses a key decision when a peer edited inside the item', async () => {
    const mounted = mount();
    try {
      const key = mounted.editor
        .getReviewItems({ placement: false })
        .find((item) => item.kind === 'revision' && item.text === 'inserted')!.key;
      const preview = await mounted.runtime.preview(async (context) => {
        getReviewItemRevisions(context, key).rejectAll();
        await context.sync();
      });
      // Another writer adds text inside "inserted", the change the key names.
      const session = mounted.editor.surface!.session;
      const paragraphId = session.paragraphIds()[1]!;
      session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 10, text: 'PEER' }]);
      const moved = await saved(mounted.editor);
      await expect(preview.commit({ rebase: true })).rejects.toMatchObject({
        code: 'StaleDocument',
        debugInfo: { innerError: { code: 'edit.preview-diverged' } },
      });
      expect(await saved(mounted.editor)).toBe(moved);
    } finally {
      mounted.dispose();
    }
  });
});
