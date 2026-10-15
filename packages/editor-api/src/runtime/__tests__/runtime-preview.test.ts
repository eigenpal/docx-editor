/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `runtime.preview(callback)`: other wording painted in the page from a fork, never written to
// the live document until `commit()`, and then as one undo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../../index.ts';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { RequestContext } from '../../index.ts';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { docx, p } from './support/docx.ts';
import {
  registerRefreshComposition,
  setRefreshWriteGuard,
} from '../../../../core/src/editor/refresh-write-guard.ts';

const BODY = p('Notice is due within thirty (30) days of receipt.') + p('Delivery is free.');

function mount(options: { review?: boolean } = {}) {
  const host = document.createElement('div');
  const container = document.createElement('div');
  container.className = 'docx-paginated-surface';
  host.append(container);
  document.body.append(host);
  const editor = createDocxEditor({
    container,
    document: docx(BODY),
    author: 'Reviewer',
    ...(options.review === false ? {} : { modules: [reviewModule()] }),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Reviewer' });
  return {
    host,
    container,
    editor,
    runtime,
    previewPages: () => host.querySelector<HTMLElement>('[data-docx-preview] .docx-pages'),
    dispose() {
      runtime.dispose();
      editor.destroy();
      host.remove();
    },
  };
}

async function saved(editor: DocxEditorInstance): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

async function counterProposal(context: RequestContext): Promise<void> {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const range = context.document.body.search('thirty (30) days of receipt').getFirst();
  range.insertText('forty-five (45) days of receipt', 'Replace');
  await context.sync();
}

/** The painted text: what a reader sees. */
function painted(pages: HTMLElement | null): string {
  if (!pages) throw new Error('no painted pages');
  return pages.textContent ?? '';
}

/**
 * The painted pages' element structure, geometry, and styling, without the attributes that name
 * one session's nodes or one edit's revision id and date.
 */
function paintedStructure(pages: HTMLElement | null): string {
  if (!pages) throw new Error('no painted pages');
  const copy = pages.cloneNode(true) as HTMLElement;
  for (const element of [copy, ...copy.querySelectorAll('*')]) {
    for (const name of element.getAttributeNames()) {
      if (name !== 'class' && name !== 'style') element.removeAttribute(name);
    }
  }
  return copy.innerHTML;
}

describe('runtime.preview', () => {
  test('capabilities say which runtimes offer it, and a server runtime refuses it', async () => {
    const mounted = mount();
    try {
      expect(mounted.runtime.capabilities.preview).toBe(true);
      const server = await DocxEditor.createServer(docx(BODY), { author: 'Agent' });
      expect(server.capabilities.preview).toBe(false);
      await expect(server.preview(counterProposal)).rejects.toMatchObject({
        code: 'NotSupported',
        target: 'preview',
      });
      server.dispose();
    } finally {
      mounted.dispose();
    }
  });

  test('shows the counter-proposal in the page without changing the document', async () => {
    const mounted = mount();
    try {
      const { editor, runtime, container } = mounted;
      const before = await saved(editor);
      const revision = editor.getDocumentHandle().revision;
      const preview = await runtime.preview(counterProposal);
      expect(preview.status).toBe('active');
      expect(painted(mounted.previewPages())).toContain('forty-five (45) days of receipt');
      expect(container.style.visibility).toBe('hidden');
      // The holder is not a second editor surface: lookups for the surface find the live one.
      expect(mounted.host.querySelectorAll('.docx-paginated-surface')).toHaveLength(1);
      expect(preview.reveal()).toBe(true);
      expect(await saved(editor)).toBe(before);
      expect(editor.getDocumentHandle().revision).toBe(revision);
      expect(editor.snapshot().canUndo).toBe(false);
      expect(editor.snapshot().editable).toBe(false);
      preview.discard();
    } finally {
      mounted.dispose();
    }
  });

  test('reads inside the callback see the preview', async () => {
    const mounted = mount();
    try {
      let seen = '';
      const preview = await mounted.runtime.preview(async (context) => {
        const range = context.document.body.search('free').getFirst();
        range.insertText('charged at cost', 'Replace');
        await context.sync();
        const body = context.document.body;
        body.load('text');
        await context.sync();
        seen = body.text;
      });
      expect(seen).toContain('Delivery is charged at cost.');
      preview.discard();
    } finally {
      mounted.dispose();
    }
  });

  test('discard restores the paint exactly, with no document change and no undo entry', async () => {
    const mounted = mount();
    try {
      const { editor, runtime, container } = mounted;
      const paint = container.innerHTML;
      const before = await saved(editor);
      const statuses: string[] = [];
      const preview = await runtime.preview(counterProposal);
      preview.onStatusChanged((status) => statuses.push(status));
      preview.discard();
      preview.discard();
      expect(preview.status).toBe('ended');
      expect(statuses).toEqual(['ended']);
      expect(mounted.previewPages()).toBeNull();
      expect(container.style.visibility).toBe('');
      expect(container.innerHTML).toBe(paint);
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
      expect(editor.snapshot().editable).toBe(true);
      // The editor takes writes again.
      expect(editor.exec({ type: 'selectAll' }).ok).toBe(true);
    } finally {
      mounted.dispose();
    }
  });

  test('commit writes the preview as one undo step and paints what the preview showed', async () => {
    const mounted = mount();
    try {
      const { editor, runtime, container } = mounted;
      const before = await saved(editor);
      const preview = await runtime.preview(counterProposal);
      const shown = painted(mounted.previewPages());
      const shownStructure = paintedStructure(mounted.previewPages());
      await preview.commit();
      expect(preview.status).toBe('ended');
      expect(mounted.previewPages()).toBeNull();
      const after = await saved(editor);
      expect(after).toContain('forty-five (45) days of receipt');
      expect(after).toContain('w:author="Reviewer"');
      expect(painted(container.querySelector('.docx-pages'))).toBe(shown);
      expect(paintedStructure(container.querySelector('.docx-pages'))).toBe(shownStructure);

      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(after);
      await expect(preview.commit()).rejects.toMatchObject({ code: 'PreviewEnded' });
    } finally {
      mounted.dispose();
    }
  });

  test('commit replays reads, comments, and several syncs in order', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      const preview = await runtime.preview(async (context) => {
        const ranges = context.document.body.search('free', { matchCase: true });
        ranges.load('items');
        await context.sync();
        const replaced = ranges.items[0]!.insertText('charged at cost', 'Replace');
        await context.sync();
        replaced.insertComment('Counter-proposal for delivery.');
        await context.sync();
      });
      await preview.commit();
      const files = unzipSync(new Uint8Array(await editor.save()));
      expect(strFromU8(files['word/document.xml']!)).toContain('charged at cost');
      expect(strFromU8(files['word/comments.xml']!)).toContain('Counter-proposal for delivery.');
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toContain('Delivery is free.');
      expect(editor.snapshot().canUndo).toBe(false);
    } finally {
      mounted.dispose();
    }
  });

  test('an outside edit marks the preview stale; commit refuses and keeps it, rebase replays it', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      const preview = await runtime.preview(counterProposal);
      const statuses: string[] = [];
      preview.onStatusChanged((status) => statuses.push(status));
      // Another writer sharing the store, as a collaboration peer is: not behind the guard.
      const session = editor.surface!.session;
      const paragraphId = session.paragraphIds()[1]!;
      session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'Note: ' }]);
      expect(preview.status).toBe('stale');
      expect(statuses).toEqual(['stale']);
      const moved = await saved(editor);
      await expect(preview.commit()).rejects.toMatchObject({
        code: 'StaleDocument',
        target: 'preview',
      });
      expect(preview.status).toBe('stale');
      expect(mounted.previewPages()).not.toBeNull();
      expect(await saved(editor)).toBe(moved);
      // The edit was in another paragraph, so the preview replays on the current document.
      await preview.commit({ rebase: true });
      expect(preview.status).toBe('ended');
      const after = await saved(editor);
      expect(after).toContain('Note: ');
      expect(after).toContain('forty-five (45) days of receipt');
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(moved);
    } finally {
      mounted.dispose();
    }
  });

  test('rebase refuses, writing nothing, when the edit touched what the preview read', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      const preview = await runtime.preview(counterProposal);
      const session = editor.surface!.session;
      const paragraphId = session.paragraphIds()[0]!;
      session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'Urgent: ' }]);
      const moved = await saved(editor);
      await expect(preview.commit({ rebase: true })).rejects.toMatchObject({
        code: 'StaleDocument',
      });
      expect(preview.status).toBe('ended');
      expect(await saved(editor)).toBe(moved);
      expect(editor.snapshot().editable).toBe(true);
    } finally {
      mounted.dispose();
    }
  });

  test('the editor stays editable while the callback runs; a write then makes the preview stale', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      let editableDuring = false;
      const preview = await runtime.preview(async (context) => {
        editableDuring = editor.snapshot().editable;
        await runtime.run(async (live) => {
          live.document.body.insertParagraph('Typed meanwhile.', 'End');
          await live.sync();
        });
        await counterProposal(context);
      });
      expect(editableDuring).toBe(true);
      expect(preview.status).toBe('stale');
      expect(painted(mounted.previewPages())).not.toContain('Typed meanwhile.');
      await preview.commit({ rebase: true });
      const after = await saved(editor);
      expect(after).toContain('Typed meanwhile.');
      expect(after).toContain('forty-five (45) days of receipt');
    } finally {
      mounted.dispose();
    }
  });

  test('discard returns focus to the page that had it', async () => {
    const mounted = mount();
    try {
      const pages = mounted.container.querySelector<HTMLElement>('.docx-pages')!;
      pages.focus();
      expect(document.activeElement).toBe(pages);
      const preview = await mounted.runtime.preview(counterProposal);
      expect(document.activeElement).not.toBe(pages);
      preview.discard();
      expect(document.activeElement).toBe(pages);
    } finally {
      mounted.dispose();
    }
  });

  test('editor and runtime writes are refused while a preview is open', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      const other = DocxEditorBrowser.createBrowser(editor, { author: 'Other' });
      const preview = await runtime.preview(counterProposal);
      const before = await saved(editor);
      expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
        ok: false,
        reason: 'A preview is open. Commit or discard it before editing.',
      });
      expect(editor.can({ type: 'undo' }).ok).toBe(false);
      // The reader's view still works: it changes neither the document nor its history.
      expect(editor.exec({ type: 'toggleParagraphMarks' }).ok).toBe(true);
      expect(editor.exec({ type: 'toggleReviewPane' }).ok).toBe(true);
      expect(editor.exec({ type: 'selectAll' }).ok).toBe(true);
      await expect(
        runtime.run(async (context) => {
          context.document.body.insertParagraph('Late.', 'End');
          await context.sync();
        })
      ).rejects.toMatchObject({
        code: 'PreviewActive',
        debugInfo: { innerError: { code: 'edit.preview-active' } },
      });
      for (const writer of [runtime, other]) {
        await expect(
          writer.run(async (context) => {
            context.document.body.insertParagraph('Late.', 'End');
            await context.sync();
          })
        ).rejects.toMatchObject({ code: 'PreviewActive' });
      }
      // Reads from an ordinary run see the live document.
      const text = await runtime.run(async (context) => {
        const body = context.document.body;
        body.load('text');
        await context.sync();
        return body.text;
      });
      expect(text).toContain('thirty (30) days');
      await expect(runtime.preview(counterProposal)).rejects.toMatchObject({
        code: 'PreviewActive',
      });
      await expect(other.preview(counterProposal)).rejects.toMatchObject({
        code: 'PreviewActive',
      });
      expect(await saved(editor)).toBe(before);
      preview.discard();
      other.dispose();
    } finally {
      mounted.dispose();
    }
  });

  test('a write a preview cannot show is refused, and the preview never opens', async () => {
    const mounted = mount();
    try {
      const { editor, runtime, container } = mounted;
      const before = await saved(editor);
      await expect(
        runtime.preview(async (context) => {
          context.document.body.search('free').getFirst().insertBreak('Page', 'After');
          await context.sync();
        })
      ).rejects.toMatchObject({
        code: 'NotSupported',
        debugInfo: { innerError: { code: 'edit.preview-unsupported' } },
      });
      expect(mounted.previewPages()).toBeNull();
      expect(container.style.visibility).toBe('');
      expect(editor.snapshot().editable).toBe(true);
      expect(await saved(editor)).toBe(before);
    } finally {
      mounted.dispose();
    }
  });

  test('an error from the callback ends the preview and propagates unchanged', async () => {
    const mounted = mount();
    try {
      const failure = new Error('model refused');
      await expect(
        mounted.runtime.preview(async () => {
          throw failure;
        })
      ).rejects.toBe(failure);
      expect(mounted.previewPages()).toBeNull();
      expect(mounted.editor.snapshot().editable).toBe(true);
      const again = await mounted.runtime.preview(counterProposal);
      again.discard();
    } finally {
      mounted.dispose();
    }
  });

  test('viewing, a refresh, and a composition refuse a preview with a specific reason', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      await expect(runtime.preview(counterProposal)).rejects.toMatchObject({
        code: 'NotSupported',
        target: 'preview',
        debugInfo: { innerError: { code: 'edit.read-only' } },
      });
      editor.exec({ type: 'setEditingMode', mode: 'editing' });
      setRefreshWriteGuard(mounted.container, true);
      await expect(runtime.preview(counterProposal)).rejects.toMatchObject({
        debugInfo: { innerError: { code: 'edit.refresh-in-progress' } },
      });
      setRefreshWriteGuard(mounted.container, false);
      registerRefreshComposition(editor.surface!, () => true);
      await expect(runtime.preview(counterProposal)).rejects.toMatchObject({
        debugInfo: { innerError: { code: 'edit.preview-composing' } },
      });
      registerRefreshComposition(editor.surface!, () => false);
      expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    } finally {
      mounted.dispose();
    }
  });

  test('in suggesting mode the preview shows what the commit writes', async () => {
    const xml = async (mode: 'editing' | 'suggesting', withPreview: boolean) => {
      const mounted = mount();
      try {
        const { editor, runtime } = mounted;
        editor.exec({ type: 'setEditingMode', mode });
        const shown: string[] = [];
        const edit = async (context: RequestContext) => {
          // One tracked write by the runtime, one untracked write the editor attributes.
          await counterProposal(context);
          context.document.changeTrackingMode = 'Off';
          context.document.body.search('free').getFirst().insertText('charged', 'Replace');
          await context.sync();
        };
        if (withPreview) {
          const preview = await runtime.preview(edit);
          shown.push(painted(mounted.previewPages()));
          await preview.commit();
          shown.push(painted(mounted.container.querySelector('.docx-pages')));
        } else await runtime.run(edit);
        const body = (await saved(editor))
          .replace(/ w:(date|id)="[^"]*"/g, '')
          .replace(/ w14:(paraId|textId)="[^"]*"/g, '');
        return { body: body.slice(body.indexOf('<w:body>')), shown };
      } finally {
        mounted.dispose();
      }
    };
    const committed = await xml('suggesting', true);
    const ran = await xml('suggesting', false);
    expect(committed.body).toBe(ran.body);
    expect(committed.shown[0]).toBe(committed.shown[1]);
    // The untracked write became a suggestion by the editor's author.
    expect(committed.body).toContain('w:author="Reviewer"');
    expect(committed.body).toMatch(/<w:del\b[^>]*>(?:(?!<\/w:del>).)*free/s);
    expect((await xml('editing', true)).body).not.toBe(committed.body);
  });

  test('tracked writes need the review module in a preview as they do in the editor', async () => {
    const mounted = mount({ review: false });
    try {
      await expect(mounted.runtime.preview(counterProposal)).rejects.toMatchObject({
        code: 'NotSupported',
      });
      expect(mounted.previewPages()).toBeNull();
    } finally {
      mounted.dispose();
    }
  });

  test('disposing the runtime or destroying the editor ends the preview', async () => {
    const first = mount();
    try {
      const preview = await first.runtime.preview(counterProposal);
      first.runtime.dispose();
      expect(preview.status).toBe('ended');
      expect(first.previewPages()).toBeNull();
      expect(first.editor.snapshot().editable).toBe(true);
    } finally {
      first.dispose();
    }
    const second = mount();
    try {
      const preview = await second.runtime.preview(counterProposal);
      second.editor.destroy();
      expect(preview.status).toBe('ended');
      expect(second.previewPages()).toBeNull();
    } finally {
      second.dispose();
    }
  });

  test('loading another document or detaching ends the preview', async () => {
    const mounted = mount();
    try {
      const preview = await mounted.runtime.preview(counterProposal);
      mounted.editor.load(docx(p('Another document.')));
      expect(preview.status).toBe('ended');
      expect(mounted.previewPages()).toBeNull();
      expect(mounted.editor.snapshot().editable).toBe(true);
      const next = await mounted.runtime.preview(async (context) => {
        context.document.body.insertParagraph('Draft.', 'End');
        await context.sync();
      });
      mounted.editor.detach();
      expect(next.status).toBe('ended');
      expect(mounted.previewPages()).toBeNull();
      expect(mounted.container.style.visibility).toBe('');
    } finally {
      mounted.dispose();
    }
  });

  test('in a pop-out window the preview paints in that window, and moving the editor ends it', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const view = frame.contentWindow as (Window & typeof globalThis) | null;
    if (!view || view.document === document) throw new Error('no second window');
    const slot = view.document.createElement('div');
    slot.className = 'docx-paginated-surface';
    view.document.body.append(slot);
    const editor = createDocxEditor({ document: docx(BODY), author: 'Reviewer' });
    editor.attach(slot);
    const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Reviewer' });
    try {
      const preview = await runtime.preview(async (context) => {
        context.document.body.search('free').getFirst().insertText('charged', 'Replace');
        await context.sync();
      });
      const holder = view.document.querySelector('[data-docx-preview]');
      expect(holder?.ownerDocument).toBe(view.document);
      expect(holder?.textContent).toContain('charged');
      expect(document.querySelector('[data-docx-preview]')).toBeNull();
      const home = document.createElement('div');
      document.body.append(home);
      editor.attach(home);
      expect(preview.status).toBe('ended');
      expect(view.document.querySelector('[data-docx-preview]')).toBeNull();
      home.remove();
    } finally {
      runtime.dispose();
      editor.destroy();
      frame.remove();
    }
  });
});
