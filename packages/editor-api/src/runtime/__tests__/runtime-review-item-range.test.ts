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
  getReviewItemRevisions,
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

  test('getReviewItemRevisions holds only the card changes, not a nested one', async () => {
    const mounted = mount();
    const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
    try {
      const items = mounted.editor.getReviewItems({ placement: false });
      const outer = items.find(
        (item) => item.kind === 'revision' && item.revisionKind === 'insert' && item.text === 'both'
      )!;
      const pair = items.find((item) => item.key.startsWith('revision-replace:'))!;
      await runtime.run(async (context) => {
        const range = getReviewItemRange(context, outer.key).revisions;
        const own = getReviewItemRevisions(context, outer.key);
        const halves = getReviewItemRevisions(context, pair.key);
        for (const collection of [range, own, halves]) collection.load('items');
        await context.sync();
        for (const revision of [...range.items, ...own.items, ...halves.items])
          revision.load('type,author');
        await context.sync();
        const described = (list: typeof own) =>
          list.items.map((revision) => `${revision.type}:${revision.author}`);
        expect(described(range)).toEqual(['Insert:Ada', 'Delete:Grace']);
        expect(described(own)).toEqual(['Insert:Ada']);
        expect(described(halves)).toEqual(['Delete:Ada', 'Insert:Ada']);
        // A nested pair is one inseparable decision: the card change alone refuses whole.
        own.acceptAll();
        expect(await context.sync().catch((caught: unknown) => caught)).toMatchObject({
          code: 'NotImplemented',
        });
        halves.acceptAll();
        await context.sync();
      });
      const after = mounted.editor.getReviewItems({ placement: false });
      expect(after.map((item) => item.key)).not.toContain(pair.key);
      expect(after.map((item) => item.key)).toContain(outer.key);
      await runtime.run(async (context) => {
        const stale = getReviewItemRevisions(context, pair.key);
        stale.load('items');
        await context.sync();
        expect(stale.items).toEqual([]);
        getReviewItemRevisions(context, pair.key).acceptAll();
        expect(await context.sync().catch((caught: unknown) => caught)).toMatchObject({
          code: 'InvalidObjectPath',
        });
      });
    } finally {
      runtime.dispose();
      mounted.dispose();
    }
  });

  test('a forged pair key whose halves do not touch names nothing', async () => {
    const mounted = mount();
    const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
    try {
      const unpaired = mounted.editor.getReviewItems({ placement: false, pairReplacements: false });
      const deletion = unpaired.find((item) => item.kind === 'revision' && item.text === 'gone')!;
      const insertion = unpaired.find(
        (item) => item.kind === 'revision' && item.text === 'inserted'
      )!;
      const forged = `revision-replace:${deletion.id}+${insertion.id}`;
      await runtime.run(async (context) => {
        const range = getReviewItemRangeOrNullObject(context, forged);
        const revisions = getReviewItemRevisions(context, forged);
        range.load('text');
        revisions.load('items');
        await context.sync();
        expect(range.isNullObject).toBe(true);
        expect(revisions.items).toEqual([]);
      });
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
