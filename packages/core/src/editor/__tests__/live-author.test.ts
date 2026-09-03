import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

function mounted(author: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: 'blank', author });
  editor.exec({ type: 'insertText', text: 'abcd' });
  return {
    editor,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

function select(editor: DocxEditorInstance, start: number, end: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function xmlOf(editor: DocxEditorInstance): string {
  return serializeOoxmlPart(editor.surface!.session.part());
}

describe('live author state', () => {
  test('commits buffered text under the author active when it was typed', () => {
    const { editor, dispose } = mounted('Author A');
    try {
      editor.surface!.setEditingMode('suggest');
      editor.surface!.enqueueType('X');

      editor.setAuthor('Author B');
      editor.surface!.enqueueType('Y');
      editor.surface!.flushPendingInput();

      const xml = xmlOf(editor);
      expect(xml).toMatch(/<w:ins\b[^>]*w:author="Author A"[^>]*>.*?<w:t>X<\/w:t>.*?<\/w:ins>/);
      expect(xml).toMatch(/<w:ins\b[^>]*w:author="Author B"[^>]*>.*?<w:t>Y<\/w:t>.*?<\/w:ins>/);
    } finally {
      dispose();
    }
  });

  test('attributes later replacements without rewriting an existing revision', () => {
    const { editor, dispose } = mounted('Author A');
    try {
      select(editor, 0, 1);
      expect(editor.exec({ type: 'proposeReplacement', replaceWith: 'X' })).toMatchObject({
        ok: true,
        changed: true,
      });

      editor.setAuthor('  Author B  ');
      expect(editor.getConfiguredAuthor()).toBe('Author B');
      select(editor, 1, 2);
      expect(editor.exec({ type: 'proposeReplacement', replaceWith: 'Y' })).toMatchObject({
        ok: true,
        changed: true,
      });

      const xml = xmlOf(editor);
      expect(xml.match(/w:author="Author A"/g)).toHaveLength(2);
      expect(xml.match(/w:author="Author B"/g)).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  test('publishes author changes, clears whitespace, and keeps the value across reloads', () => {
    const { editor, dispose } = mounted('Author A');
    try {
      let selectionChanges = 0;
      const off = editor.on('selectionChange', () => {
        selectionChanges += 1;
      });

      editor.setAuthor('Author B');
      expect(selectionChanges).toBe(1);
      editor.setAuthor(' Author B ');
      expect(selectionChanges).toBe(1);

      editor.load('blank');
      expect(editor.getConfiguredAuthor()).toBe('Author B');
      editor.exec({ type: 'insertText', text: 'ab' });
      select(editor, 0, 1);
      expect(editor.exec({ type: 'proposeReplacement', replaceWith: 'X' })).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(xmlOf(editor)).toContain('w:author="Author B"');

      editor.setAuthor('  ');
      expect(editor.getConfiguredAuthor()).toBeNull();
      editor.surface!.setEditingMode('suggest');
      editor.surface!.insertPlainText('z');
      expect(editor.surface!.state().lastRejection).toBe(
        'suggesting needs an author before it can propose a change'
      );
      expect(editor.exec({ type: 'proposeInsertion', text: 'z' })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
        reason: 'tracked changes need a non-empty author',
      });
      off();
    } finally {
      dispose();
    }
  });
});
