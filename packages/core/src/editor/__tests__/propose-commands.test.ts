// Explicit tracked-change commands through the mounted browser editor.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '../docx-editor.ts';

function mounted(author?: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: 'blank', ...(author ? { author } : {}) });
  editor.exec({ type: 'insertText', text: 'abcd' });
  return {
    editor,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

function xmlOf(editor: ReturnType<typeof createDocxEditor>): string {
  return serializeOoxmlPart(editor.surface!.session.part());
}

describe('explicit tracked-change commands', () => {
  test('proposeInsertion resolves a DocLocation and attributes the inserted text', () => {
    const { editor, dispose } = mounted('Configured Author');
    try {
      const command = {
        type: 'proposeInsertion' as const,
        target: { container: { part: 'body' as const }, path: [0], offset: 2 },
        text: 'X',
        author: 'Agent',
      };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
      const xml = xmlOf(editor);
      expect(xml).toContain('<w:ins');
      expect(xml).toContain('w:author="Agent"');
      expect(xml).toContain('<w:t>X</w:t>');
    } finally {
      dispose();
    }
  });

  test('proposeDeletion uses the current selection and configured author', () => {
    const { editor, dispose } = mounted('Configured Author');
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 3 },
      });
      const command = { type: 'proposeDeletion' as const };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
      const xml = xmlOf(editor);
      expect(xml).toContain('<w:del');
      expect(xml).toContain('w:author="Configured Author"');
      expect(xml).toContain('<w:delText>bc</w:delText>');
    } finally {
      dispose();
    }
  });

  test('proposeReplacement authors one replacement decision', () => {
    const { editor, dispose } = mounted('Agent');
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 3 },
      });
      const command = { type: 'proposeReplacement' as const, replaceWith: 'XY' };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toEqual({ ok: true, changed: true });
      const xml = xmlOf(editor);
      const deletionId = /<w:del\b[^>]*w:id="([^"]+)"/.exec(xml)?.[1];
      const insertionId = /<w:ins\b[^>]*w:id="([^"]+)"/.exec(xml)?.[1];
      expect(deletionId).toBeDefined();
      expect(insertionId).toBe(deletionId);
      expect(xml).toContain('<w:delText>bc</w:delText>');
      expect(xml).toContain('<w:t>XY</w:t>');
    } finally {
      dispose();
    }
  });

  test('proposeReplacement retracts the same author’s insertion in edit mode', () => {
    const { editor, dispose } = mounted('Agent');
    try {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 2 },
        head: { paragraphId, offset: 2 },
      });
      expect(editor.exec({ type: 'proposeInsertion', text: 'X', author: 'Agent' })).toMatchObject({
        ok: true,
        changed: true,
      });
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 4 },
      });

      expect(
        editor.exec({ type: 'proposeReplacement', replaceWith: 'Y', author: 'Agent' })
      ).toMatchObject({ ok: true, changed: true });
      const xml = xmlOf(editor);
      expect(xml).not.toContain('<w:t>X</w:t>');
      expect(xml).toContain('<w:delText>bc</w:delText>');
      expect(xml).toContain('<w:t>Y</w:t>');
    } finally {
      dispose();
    }
  });

  test('can and exec agree on missing authors, collapsed deletion, and paragraph marks', () => {
    const noAuthor = mounted();
    try {
      const missing = { type: 'proposeInsertion' as const, text: 'X' };
      expect(noAuthor.editor.can(missing)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(noAuthor.editor.exec(missing)).toMatchObject({ ok: false, code: 'invalidArgs' });
    } finally {
      noAuthor.dispose();
    }

    const withAuthor = mounted('Agent');
    try {
      const collapsed = { type: 'proposeDeletion' as const };
      expect(withAuthor.editor.can(collapsed)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(withAuthor.editor.exec(collapsed)).toMatchObject({ ok: false, code: 'invalidArgs' });
      const multiline = { type: 'proposeInsertion' as const, text: 'one\ntwo' };
      expect(withAuthor.editor.can(multiline)).toMatchObject({ ok: false, code: 'invalidArgs' });
      expect(withAuthor.editor.exec(multiline)).toMatchObject({ ok: false, code: 'invalidArgs' });
    } finally {
      withAuthor.dispose();
    }
  });
});
