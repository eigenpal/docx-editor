/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `preview.commit({ rebase: true })`: a preview replays on a document another writer moved,
// with ranges following their text, and refuses rather than overwrite words it never showed.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { RequestContext } from '../../index.ts';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { docx, p } from './support/docx.ts';
import { WITH_FURNITURE } from '../../model/__tests__/support/documents.ts';

const BODY = p('Notice is due within thirty (30) days of receipt.') + p('Delivery is free.');

function mount(bytes: Uint8Array = docx(BODY)) {
  const host = document.createElement('div');
  const container = document.createElement('div');
  container.className = 'docx-paginated-surface';
  host.append(container);
  document.body.append(host);
  const editor = createDocxEditor({
    container,
    document: bytes,
    author: 'Reviewer',
    modules: [reviewModule()],
  });
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Reviewer' });
  return {
    editor,
    runtime,
    /** Another writer sharing the store, as a collaboration peer is: not behind the guard. */
    peer(paragraph: number, op: 'insert' | 'delete', at: number, value: string | number) {
      const session = editor.surface!.session;
      const paragraphId = session.paragraphIds()[paragraph]!;
      session.applyTreeOps([
        op === 'insert'
          ? { op: 'insertText', paragraphId, offset: at, text: String(value) }
          : { op: 'deleteText', paragraphId, start: at, end: Number(value) },
      ]);
    },
    dispose() {
      runtime.dispose();
      editor.destroy();
      host.remove();
    },
  };
}

async function body(editor: DocxEditorInstance): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

/** Struck text, in document order. */
const struck = (xml: string) =>
  [...xml.matchAll(/<w:delText[^>]*>([^<]*)<\/w:delText>/g)].map((match) => match[1]).join('|');

async function counterProposal(context: RequestContext): Promise<void> {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const range = context.document.body.search('thirty (30) days of receipt').getFirst();
  range.insertText('forty-five (45) days of receipt', 'Replace');
  await context.sync();
}

describe('preview.commit({ rebase: true })', () => {
  test('follows a deletion before the clause', async () => {
    const mounted = mount();
    try {
      const preview = await mounted.runtime.preview(counterProposal);
      mounted.peer(0, 'delete', 0, 7);
      await preview.commit({ rebase: true });
      const xml = await body(mounted.editor);
      expect(xml).not.toContain('Notice ');
      expect(struck(xml)).toBe('thirty (30) days of receipt');
      expect(xml).toContain('forty-five (45) days of receipt');
    } finally {
      mounted.dispose();
    }
  });

  test('follows an edit between two ranges of one paragraph read at different offsets', async () => {
    const mounted = mount();
    try {
      const preview = await mounted.runtime.preview(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        context.document.body.search('Notice').getFirst().insertText('NOTICE', 'Replace');
        await context.sync();
        context.document.body.search('receipt').getFirst().insertText('RECEIPT', 'Replace');
        await context.sync();
      });
      mounted.peer(0, 'insert', 10, 'PEER ');
      await preview.commit({ rebase: true });
      const xml = await body(mounted.editor);
      expect(struck(xml)).toBe('Notice|receipt');
      expect(xml).toContain('PEER ');
      expect(xml).toContain('NOTICE');
      expect(xml).toContain('RECEIPT');
    } finally {
      mounted.dispose();
    }
  });

  test('refuses, keeping the peer text, when a whole-paragraph write would strike it', async () => {
    const mounted = mount();
    try {
      const preview = await mounted.runtime.preview(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        context.document.body.paragraphs.getFirst().insertText('Replaced.', 'Replace');
        await context.sync();
      });
      mounted.peer(0, 'insert', 26, 'PEER ');
      const moved = await body(mounted.editor);
      await expect(preview.commit({ rebase: true })).rejects.toMatchObject({
        code: 'StaleDocument',
        debugInfo: { innerError: { code: 'edit.preview-diverged' } },
      });
      expect(await body(mounted.editor)).toBe(moved);
      expect(struck(moved)).toBe('');
    } finally {
      mounted.dispose();
    }
  });

  test('refuses when a peer edits inside a span the preview formats across paragraphs', async () => {
    const mounted = mount();
    try {
      const preview = await mounted.runtime.preview(async (context) => {
        context.document.body.getRange('Whole').font.bold = true;
        await context.sync();
      });
      mounted.peer(1, 'insert', 0, 'Fast ');
      const moved = await body(mounted.editor);
      await expect(preview.commit({ rebase: true })).rejects.toMatchObject({
        code: 'StaleDocument',
        debugInfo: { innerError: { code: 'edit.preview-diverged' } },
      });
      expect(await body(mounted.editor)).toBe(moved);
    } finally {
      mounted.dispose();
    }
  });

  test('replays a header edit after a peer edits the body', async () => {
    const mounted = mount(WITH_FURNITURE);
    try {
      const preview = await mounted.runtime.preview(async (context) => {
        context.document.sections.getFirst().getHeader('Primary').insertText(' extra', 'End');
        await context.sync();
      });
      mounted.peer(0, 'insert', 0, 'Peer: ');
      await preview.commit({ rebase: true });
      const files = unzipSync(new Uint8Array(await mounted.editor.save()));
      const all = Object.entries(files)
        .filter(([name]) => name.startsWith('word/'))
        .map(([, bytes]) => strFromU8(bytes))
        .join('');
      expect(all).toContain(' extra');
      expect(all).toContain('Peer: ');
    } finally {
      mounted.dispose();
    }
  });
});
