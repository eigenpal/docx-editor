/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { DocxEditor } from '../../browser.ts';
import type { DocxEditorRuntime } from '../public.ts';
import { commentedDocx } from './support/docx.ts';

const AUTHOR = 'Ada Lovelace';
function mount(
  options: {
    editorAuthor?: string;
    runtimeAuthor?: string;
    viewing?: boolean;
    review?: boolean;
  } = {}
) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: commentedDocx(),
    author: options.editorAuthor ?? AUTHOR,
    modules: options.review === false ? [] : [reviewModule()],
    ...(options.viewing ? { mode: 'view' as const } : {}),
  });
  const runtime = DocxEditor.createBrowser(editor, { author: options.runtimeAuthor ?? AUTHOR });
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

async function text(runtime: DocxEditorRuntime): Promise<string> {
  return runtime.run(async (context) => {
    const comment = context.document.comments.getFirst();
    comment.load('content');
    await context.sync();
    return comment.content;
  });
}

test('browser content setter uses the runtime author, not the editor toolbar author', async () => {
  const own = mount({ editorAuthor: 'Different toolbar author', runtimeAuthor: AUTHOR });
  try {
    await own.runtime.run(async (context) => {
      const comment = context.document.comments.getFirst();
      comment.content = 'Runtime author edit';
      comment.load('content');
      await context.sync();
      expect(comment.content).toBe('Runtime author edit');
    });
    expect(await text(own.runtime)).toBe('Runtime author edit');
  } finally {
    own.dispose();
  }
  const other = mount({ editorAuthor: AUTHOR, runtimeAuthor: 'Different runtime author' });
  try {
    await expect(
      other.runtime.run(async (context) => {
        context.document.comments.getFirst().content = 'Not mine';
        await context.sync();
      })
    ).rejects.toMatchObject({
      code: 'NotSupported',
      debugInfo: { innerError: { code: 'edit.comment-author-mismatch' } },
    });
    expect(await text(other.runtime)).toBe('Is this the right clause?');
  } finally {
    other.dispose();
  }
});

test('browser batches root and reply edits into one undo and redo step', async () => {
  const mounted = mount();
  const { editor, runtime } = mounted;
  try {
    await runtime.run(async (context) => {
      const root = context.document.comments.getFirst();
      const reply = root.reply('Original reply');
      await context.sync();
      root.content = 'Edited root';
      reply.content = 'Edited reply';
      root.load('content');
      reply.load('content');
      await context.sync();
      expect(root.content).toBe('Edited root');
      expect(reply.content).toBe('Edited reply');
    });
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(await text(runtime)).toBe('Is this the right clause?');
    await runtime.run(async (context) => {
      const reply = context.document.comments.getFirst().replies.getFirst();
      reply.load('content');
      await context.sync();
      expect(reply.content).toBe('Original reply');
    });
    expect(editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    expect(await text(runtime)).toBe('Edited root');
  } finally {
    mounted.dispose();
  }
});

for (const options of [{ viewing: true }, { review: false }]) {
  test(`browser refuses unavailable comment editing: ${JSON.stringify(options)}`, async () => {
    const mounted = mount(options);
    try {
      await expect(
        mounted.runtime.run(async (context) => {
          context.document.comments.getFirst().content = 'Refused';
          await context.sync();
        })
      ).rejects.toBeDefined();
      expect(await text(mounted.runtime)).toBe('Is this the right clause?');
    } finally {
      mounted.dispose();
    }
  });
}

test('browser detects a deleted comment after load and does not recreate it', async () => {
  const mounted = mount();
  try {
    await mounted.runtime.run(async (context) => {
      const comment = context.document.comments.getFirst();
      comment.load('content');
      await context.sync();
      await mounted.runtime.run(async (other) => {
        other.document.comments.getFirst().delete();
        await other.sync();
      });
      comment.content = 'Must not recreate';
      await expect(context.sync()).rejects.toMatchObject({ code: 'StaleDocument' });
    });
    await mounted.runtime.run(async (context) => {
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      expect(comments.items).toHaveLength(0);
    });
  } finally {
    mounted.dispose();
  }
});
