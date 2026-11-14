/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Proofing annotations over a browser runtime paint as the editor's text highlights: one
// reserved set per color scheme, with the proofing meaning of the spelling and grammar schemes.
// Two runtimes paint their union, a decision removes a mark, and disposal removes the runtime's
// own marks. A preview refuses annotation members.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import {
  createDocxEditor,
  type DocxEditorInstance,
  type HighlightOptions,
  type HighlightRange,
} from '@docx-editor.dev/core/editor';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { CritiquePopupOptions, RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const popup = (...suggestions: string[]): CritiquePopupOptions => ({
  brandingTextResourceId: '',
  subtitleResourceId: '',
  titleResourceId: '',
  suggestions,
});

type Painted = Map<string, { ranges: readonly HighlightRange[]; options?: HighlightOptions }>;

function mount(body: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body), author: 'Checker' });
  if (!editor.surface) throw new Error('surface failed to mount');
  const painted: Painted = new Map();
  const setHighlights = editor.setHighlights.bind(editor);
  const clearHighlights = editor.clearHighlights.bind(editor);
  (editor as { setHighlights: DocxEditorInstance['setHighlights'] }).setHighlights = (
    name,
    ranges,
    options
  ) => {
    painted.set(name, { ranges, ...(options ? { options } : {}) });
    return setHighlights(name, ranges, options);
  };
  (editor as { clearHighlights: DocxEditorInstance['clearHighlights'] }).clearHighlights = (
    name
  ) => {
    if (name === undefined) painted.clear();
    else painted.delete(name);
    clearHighlights(name);
  };
  return {
    editor,
    painted,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

async function annotate(context: RequestContext): Promise<string[]> {
  const ids = context.document.body.paragraphs.getFirst().insertAnnotations({
    critiques: [
      { colorScheme: 'Red', start: 0, length: 3, popupOptions: popup('The') },
      { colorScheme: 'Blue', start: 8, length: 3 },
      { colorScheme: 'Berry', start: 4, length: 3 },
    ],
  });
  await context.sync();
  return ids.value;
}

test('annotations paint one set per color scheme, with the proofing kind', async () => {
  const mounted = mount(p('Teh cat sat down.'));
  const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
  try {
    const [red] = await runtime.run(annotate);
    const blockId = mounted.editor.getParagraphs()[0]!.blockId;
    expect(mounted.painted.get('docx-critique-red')).toEqual({
      ranges: [{ blockId, start: 0, length: 3 }],
      options: { color: 'var(--doc-critique-red-color)', priority: 5, kind: 'spelling' },
    });
    expect(mounted.painted.get('docx-critique-blue')?.options?.kind).toBe('grammar');
    expect(mounted.painted.get('docx-critique-blue')?.ranges).toEqual([
      { blockId, start: 8, length: 3 },
    ]);
    expect(mounted.painted.get('docx-critique-berry')?.options).toEqual({
      color: 'var(--doc-critique-berry-color)',
      priority: 5,
    });

    await runtime.run(async (context) => {
      context.document.getAnnotationById(red!).critiqueAnnotation.accept();
      await context.sync();
    });
    expect(mounted.painted.has('docx-critique-red')).toBe(false);
    expect(mounted.editor.getParagraphs()[0]!.text).toBe('The cat sat down.');
    // A single undo step reverts the fix.
    mounted.editor.exec({ type: 'undo' });
    expect(mounted.editor.getParagraphs()[0]!.text).toBe('Teh cat sat down.');
  } finally {
    runtime.dispose();
    mounted.dispose();
  }
  expect(mounted.painted.size).toBe(0);
});

test('two runtimes on one editor paint their union, and disposal removes only its own', async () => {
  const mounted = mount(p('Teh cat sat down.'));
  const first = DocxEditorBrowser.createBrowser(mounted.editor);
  const second = DocxEditorBrowser.createBrowser(mounted.editor);
  try {
    await first.run(async (context) => {
      context.document.body.paragraphs
        .getFirst()
        .insertAnnotations({ critiques: [{ colorScheme: 'Red', start: 0, length: 3 }] });
      await context.sync();
    });
    await second.run(async (context) => {
      context.document.body.paragraphs
        .getFirst()
        .insertAnnotations({ critiques: [{ colorScheme: 'Red', start: 8, length: 3 }] });
      await context.sync();
    });
    expect(mounted.painted.get('docx-critique-red')?.ranges.map((range) => range.start)).toEqual([
      0, 8,
    ]);
    first.dispose();
    expect(mounted.painted.get('docx-critique-red')?.ranges.map((range) => range.start)).toEqual([
      8,
    ]);
  } finally {
    first.dispose();
    second.dispose();
    mounted.dispose();
  }
});

test('an edit made in a run repaints the marks at their new offsets', async () => {
  const mounted = mount(p('Teh cat sat down.'));
  const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
  try {
    await runtime.run(async (context) => {
      await annotate(context);
      context.document.body.paragraphs.getFirst().insertText('So ', 'Start');
      await context.sync();
    });
    expect(mounted.painted.get('docx-critique-blue')?.ranges.map((range) => range.start)).toEqual([
      11,
    ]);
  } finally {
    runtime.dispose();
    mounted.dispose();
  }
});

test('a preview refuses annotation members', async () => {
  const mounted = mount(p('Teh cat sat down.'));
  const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
  try {
    const error = await runtime
      .preview(async (context) => {
        context.document.body.paragraphs
          .getFirst()
          .insertAnnotations({ critiques: [{ colorScheme: 'Red', start: 0, length: 3 }] });
        await context.sync();
      })
      .then(
        () => null,
        (caught: unknown) => caught
      );
    expect(error).toMatchObject({
      code: 'NotSupported',
      debugInfo: { innerError: { code: 'edit.preview-unsupported' } },
    });
    expect(mounted.painted.size).toBe(0);
  } finally {
    runtime.dispose();
    mounted.dispose();
  }
});
