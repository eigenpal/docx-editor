/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The bridge from a review-queue key to the object model, over a live editor and a server.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
// Source rather than the package name, so the test does not need a built `pro`.
import { reviewModule } from '../../../../pro/src/index.ts';
import {
  DocxEditor as DocxEditorBrowser,
  getReviewItemRange,
  getReviewItemRangeOrNullObject,
} from '../../browser.ts';
import { DocxEditor } from '../../index.ts';
import { REVIEW_DOCUMENT } from '../../model/__tests__/support/review-documents.ts';

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: REVIEW_DOCUMENT,
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return {
    editor,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

describe('getReviewItemRange over a live editor', () => {
  test('every revision and comment key resolves to the text its card shows', async () => {
    const mounted = mount();
    const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
    try {
      const items = mounted.editor.getReviewItems({ placement: false });
      const replace = items.find((item) => item.key.startsWith('revision-replace:'));
      expect(replace).toBeDefined();
      expect(items.some((item) => item.kind === 'comment')).toBe(true);
      await runtime.run(async (context) => {
        const ranges = items.map((item) => {
          const range = getReviewItemRange(context, item.key);
          range.load('text');
          return range;
        });
        await context.sync();
        items.forEach((item, index) => {
          const text = ranges[index]!.text;
          if (item.kind === 'comment') expect(text).toBe('keep goneadded tail\rsecond inserted');
          else if (item.kind === 'revision' && item.revisionKind === 'replace')
            expect(text).toBe(`${item.replacedText ?? ''}${item.text}`);
          else expect(text).toBe(item.text);
        });
      });
    } finally {
      runtime.dispose();
      mounted.dispose();
    }
  });

  test('a paired key lists both halves and accepting through it resolves that card only', async () => {
    const mounted = mount();
    const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
    try {
      const before = mounted.editor.getReviewItems({ placement: false });
      const pair = before.find((item) => item.key.startsWith('revision-replace:'))!;
      await runtime.run(async (context) => {
        const revisions = getReviewItemRange(context, pair.key).revisions;
        revisions.load('items');
        await context.sync();
        for (const revision of revisions.items) revision.load('type');
        await context.sync();
        expect(revisions.items.map((revision) => revision.type)).toEqual(['Delete', 'Insert']);
        revisions.acceptAll();
        await context.sync();
      });
      const after = mounted.editor.getReviewItems({ placement: false });
      expect(after.map((item) => item.key)).not.toContain(pair.key);
      expect(after.filter((item) => item.kind === 'revision')).toHaveLength(
        before.filter((item) => item.kind === 'revision').length - 1
      );

      await runtime.run(async (context) => {
        const stale = getReviewItemRangeOrNullObject(context, pair.key);
        stale.load('text');
        await context.sync();
        expect(stale.isNullObject).toBe(true);

        getReviewItemRange(context, pair.key).load('text');
        expect(await context.sync().catch((caught: unknown) => caught)).toMatchObject({
          code: 'ItemNotFound',
        });
      });
    } finally {
      runtime.dispose();
      mounted.dispose();
    }
  });

  test('a single revision key reaches the revision the body lists', async () => {
    const mounted = mount();
    const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
    try {
      const target = mounted.editor
        .getReviewItems({ placement: false })
        .find((item) => item.kind === 'revision' && item.text === 'headins')!;
      await runtime.run(async (context) => {
        const revisions = getReviewItemRange(context, target.key).revisions;
        revisions.load('items');
        await context.sync();
        expect(revisions.items).toHaveLength(1);
        revisions.items[0]!.load('author');
        await context.sync();
        expect(revisions.items[0]!.author).toBe('Linus');
        revisions.items[0]!.reject();
        await context.sync();
      });
      const keys = mounted.editor.getReviewItems({ placement: false }).map((item) => item.key);
      expect(keys).not.toContain(target.key);
    } finally {
      runtime.dispose();
      mounted.dispose();
    }
  });
});

describe('getReviewItemRange arguments', () => {
  test('refuses invalid and custom keys at the call, and reports unknown keys at sync', async () => {
    const runtime = await DocxEditor.createServer(REVIEW_DOCUMENT);
    try {
      await runtime.run(async (context) => {
        expect(() => getReviewItemRange(context, '')).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
        expect(() => getReviewItemRange(context, 42 as unknown as string)).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
        expect(() =>
          getReviewItemRange(undefined as unknown as typeof context, 'comment-9')
        ).toThrow(expect.objectContaining({ code: 'InvalidArgument' }));
        expect(() => getReviewItemRange(context, 'custom-1')).toThrow(
          expect.objectContaining({ code: 'NotSupported' })
        );
        for (const key of ['revision-nothing', 'comment-404', 'unknown']) {
          const missing = getReviewItemRangeOrNullObject(context, key);
          missing.load('text');
          await context.sync();
          expect(missing.isNullObject).toBe(true);
        }
        const comment = getReviewItemRange(context, 'comment-9');
        comment.load('text');
        await context.sync();
        expect(comment.text).toBe('keep goneadded tail\rsecond inserted');
      });
    } finally {
      runtime.dispose();
    }
  });
});
