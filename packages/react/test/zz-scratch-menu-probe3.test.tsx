import './dom-setup.ts';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, test } from 'bun:test';
import { act, render, fireEvent } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';

describe('probe3', () => {
  test('corrupt bytes: save behaviour + row enabled state', async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot document={new Uint8Array([1, 2, 3, 4, 5])} onReady={(e) => (instance = e as DocxEditorInstance)}>
        <DocxEditorMenu />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await act(async () => { await Promise.resolve(); });
    const t = [...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger')].find((b) => b.textContent === 'toolbar.file')!;
    act(() => { fireEvent.click(t); });
    const save = view.container.querySelector<HTMLButtonElement>('[data-slot="file.save"]')!;
    console.log('save row disabled after a corrupt load:', save.disabled);
    let outcome = 'resolved';
    try {
      await instance!.save();
    } catch (error) {
      outcome = 'rejected: ' + ((error as Error).message ?? String(error));
    }
    console.log('save() after corrupt load:', outcome);
  });
});
