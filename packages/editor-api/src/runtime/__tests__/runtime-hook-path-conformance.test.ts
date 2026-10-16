/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One document, two write paths, one saved result.
//
// A browser host can comment, reply and propose a replacement in two ways: through the editor
// methods the review hooks call (`useReview().comment`, `useReview().reply`, and
// `exec({ type: 'replaceMatch' })` in suggesting mode), or through this editing API
// (`Range.insertComment`, `Comment.reply`, `insertText(..., 'Replace')` under
// `TrackMineOnly`). Both must save the same markup. Ids and exact timestamps differ between
// any two writes and are normalized away; the date's presence and format are not.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { DocxEditorRuntime } from '../../runtime/runtime.ts';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { docx, p } from './support/docx.ts';

const AUTHOR = 'Reviewer';
const BODY = p('Payment is due in thirty days.') + p('Delivery is free of charge.');

interface Mounted {
  readonly editor: DocxEditorInstance;
  readonly runtime: DocxEditorRuntime;
  dispose(): void;
}

function mount(): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(BODY),
    author: AUTHOR,
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: AUTHOR });
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

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Every `w:date` in the parts, checked for format before the value is normalized away. */
function dateStamps(xml: string): string[] {
  return [...xml.matchAll(/\bw:date="([^"]*)"/g)].map((match) => match[1]!);
}

/** Replace identity and time values with fixed tokens, keeping attribute presence. */
function normalize(xml: string): string {
  return xml
    .replace(
      /\b(w:id|w14:paraId|w14:textId|w15:paraId|w15:paraIdParent|w16cid:durableId|w16cex:durableId|w:rsid\w*)="[^"]*"/g,
      '$1="#"'
    )
    .replace(/\bw:date="[^"]*"/g, 'w:date="#"')
    .replace(/\bw16cex:dateUtc="[^"]*"/g, 'w16cex:dateUtc="#"');
}

const PARTS = [
  'word/document.xml',
  'word/comments.xml',
  'word/commentsExtended.xml',
  'word/commentsIds.xml',
  'word/commentsExtensible.xml',
] as const;

async function savedParts(editor: DocxEditorInstance): Promise<Record<string, string | null>> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  const out: Record<string, string | null> = {};
  for (const part of PARTS) {
    const bytes = files[part];
    out[part] = bytes ? strFromU8(bytes) : null;
  }
  return out;
}

async function compare(hookPath: Mounted, apiPath: Mounted): Promise<Record<string, string>> {
  const hook = await savedParts(hookPath.editor);
  const api = await savedParts(apiPath.editor);
  const normalized: Record<string, string> = {};
  for (const part of PARTS) {
    expect({ part, present: api[part] !== null }).toEqual({ part, present: hook[part] !== null });
    if (hook[part] === null || api[part] === null) continue;
    const hookDates = dateStamps(hook[part]!);
    const apiDates = dateStamps(api[part]!);
    expect(apiDates.length).toBe(hookDates.length);
    for (const stamp of [...hookDates, ...apiDates]) expect(stamp).toMatch(DATE_FORMAT);
    expect(normalize(api[part]!)).toBe(normalize(hook[part]!));
    normalized[part] = normalize(hook[part]!);
  }
  return normalized;
}

function hookComment(editor: DocxEditorInstance, query: string, text: string): void {
  const match = editor.findMatches(query, { matchCase: true })[0];
  if (!match) throw new Error(`no match for ${query}`);
  expect(editor.selectMatch(match).ok).toBe(true);
  expect(editor.addComment(text).ok).toBe(true);
}

async function apiComment(runtime: DocxEditorRuntime, query: string, text: string): Promise<void> {
  await runtime.run(async (context) => {
    const found = context.document.body.search(query, { matchCase: true });
    found.load('items');
    await context.sync();
    found.items[0]!.insertComment(text);
    await context.sync();
  });
}

describe('the review hook path and the editing API path save the same markup', () => {
  test('a comment on found text', async () => {
    const hookPath = mount();
    const apiPath = mount();
    try {
      hookComment(hookPath.editor, 'thirty days', 'Make it forty-five.');
      await apiComment(apiPath.runtime, 'thirty days', 'Make it forty-five.');
      const parts = await compare(hookPath, apiPath);
      expect(parts['word/comments.xml']).toContain(`w:author="${AUTHOR}"`);
      expect(parts['word/document.xml']).toContain('w:commentRangeStart');
      expect(parts['word/document.xml']).toContain('w:commentReference');
    } finally {
      hookPath.dispose();
      apiPath.dispose();
    }
  });

  test('a reply to a comment', async () => {
    const hookPath = mount();
    const apiPath = mount();
    try {
      hookComment(hookPath.editor, 'thirty days', 'Make it forty-five.');
      const item = hookPath.editor.getReviewItems().find((entry) => entry.kind === 'comment');
      if (!item) throw new Error('no comment item');
      expect(hookPath.editor.replyToReviewItem(item.key, 'Agreed.').ok).toBe(true);

      await apiPath.runtime.run(async (context) => {
        const found = context.document.body.search('thirty days', { matchCase: true });
        found.load('items');
        await context.sync();
        const comment = found.items[0]!.insertComment('Make it forty-five.');
        await context.sync();
        comment.reply('Agreed.');
        await context.sync();
      });
      const parts = await compare(hookPath, apiPath);
      expect(parts['word/comments.xml']!.match(/<w:comment /g)).toHaveLength(2);
    } finally {
      hookPath.dispose();
      apiPath.dispose();
    }
  });

  test('a tracked replacement', async () => {
    const hookPath = mount();
    const apiPath = mount();
    try {
      expect(hookPath.editor.setEditingMode('suggesting').ok).toBe(true);
      const match = hookPath.editor.findMatches('free of charge', { matchCase: true })[0];
      if (!match) throw new Error('no match');
      expect(
        hookPath.editor.exec({ type: 'replaceMatch', match, text: 'charged at cost' }).ok
      ).toBe(true);

      await apiPath.runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const found = context.document.body.search('free of charge', { matchCase: true });
        found.load('items');
        await context.sync();
        found.items[0]!.insertText('charged at cost', 'Replace');
        await context.sync();
      });
      const parts = await compare(hookPath, apiPath);
      const document = parts['word/document.xml']!;
      expect(document).toContain(
        `<w:del w:author="${AUTHOR}" w:date="#" w:id="#"><w:r><w:delText>free of charge</w:delText>`
      );
      expect(document).toContain(
        `<w:ins w:author="${AUTHOR}" w:date="#" w:id="#"><w:r><w:t>charged at cost</w:t>`
      );
    } finally {
      hookPath.dispose();
      apiPath.dispose();
    }
  });
});
