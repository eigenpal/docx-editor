/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { fireEvent, getByLabelText, getByRole } from '@testing-library/react';
import { createDocxEditor, type ResolvedRevisionMarkup } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../index.ts';

test('a host restores preferences, changes them in the dialog, and saves the same resolved object', () => {
  const container = document.createElement('div');
  document.body.append(container);
  let saved: ResolvedRevisionMarkup | undefined;
  const editor = createDocxEditor({
    container,
    document: 'blank',
    modules: [reviewModule({})],
    revisionMarkup: {
      insertions: { mark: 'doubleUnderline', color: 'blue' },
      deletions: { mark: 'hidden' },
    },
  });
  try {
    editor.on('revisionMarkupChange', (value) => {
      saved = value;
    });
    expect(editor.exec({ type: 'openRevisionMarkupDialog' }).ok).toBe(true);
    const dialog = getByRole(container, 'dialog');
    expect((getByLabelText(dialog, 'Insertions') as HTMLSelectElement).value).toBe(
      'doubleUnderline'
    );
    editor.setRevisionMarkup({ insertions: { color: 'green' }, trackFormatting: false });
    expect((getByLabelText(dialog, 'Track formatting') as HTMLInputElement).checked).toBe(false);
    fireEvent.change(getByLabelText(dialog, 'Deletions'), { target: { value: 'caret' } });
    fireEvent.click(getByRole(dialog, 'button', { name: 'OK' }));
    expect(saved!).toBe(editor.snapshot().revisionMarkup);
    expect(saved!.insertions).toEqual({ mark: 'doubleUnderline', color: 'green' });
    expect(saved!.deletions.mark).toBe('caret');
    const restored = createDocxEditor({ revisionMarkup: JSON.parse(JSON.stringify(saved)) });
    expect(restored.snapshot().revisionMarkup).toEqual(saved!);
    restored.destroy();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test.each(['detach', 'destroy', 'load'] as const)(
  'custom dialog session closes on facade %s',
  (operation) => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: 'blank', modules: [reviewModule({})] });
    let session: import('@docx-editor.dev/core/editor').RevisionMarkupDialogSession | undefined;
    const dispose = editor.setRevisionMarkupChrome({
      onRequest: (value) => {
        session = value;
      },
    });
    try {
      expect(editor.exec({ type: 'openRevisionMarkupDialog' }).ok).toBe(true);
      expect(session).toBeDefined();
      session!.set({ trackMoves: false });
      expect(editor.snapshot().revisionMarkup.trackMoves).toBe(true);
      if (operation === 'load') editor.load('blank');
      else editor[operation]();
      expect(session!.signal.aborted).toBe(true);
      expect(session!.apply()).toBe(false);
      if (operation === 'detach') {
        editor.attach(container);
        expect(editor.snapshot().revisionMarkup.trackMoves).toBe(true);
        editor.exec({ type: 'openRevisionMarkupDialog' });
        expect(session!.canApply()).toBe(true);
        dispose();
        expect(session!.signal.aborted).toBe(true);
        editor.exec({ type: 'openRevisionMarkupDialog' });
        expect(getByRole(container, 'dialog')).toBeDefined();
      }
    } finally {
      dispose();
      editor.destroy();
      container.remove();
    }
  }
);
