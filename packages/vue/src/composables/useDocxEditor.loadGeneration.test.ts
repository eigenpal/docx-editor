import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ref } from 'vue';
import { createEmptyDocument } from '@eigenpal/docx-editor-core/utils';
import type { Document } from '@eigenpal/docx-editor-core/types/document';

/**
 * Proves Vue's loadGeneration gate invalidates in-flight `parseDocx` work across
 * ownership transitions: a late parse must not overwrite `loadDocument`, and must
 * not reassign state after `destroy`.
 */

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

type PendingParse = {
  resolve: (doc: Document) => void;
  reject: (err: unknown) => void;
};

const pendingParses: PendingParse[] = [];

mock.module('@eigenpal/docx-editor-core/docx/parser', () => ({
  parseDocx: (_buffer: ArrayBuffer | Uint8Array) =>
    new Promise<Document>((resolve, reject) => {
      pendingParses.push({ resolve, reject });
    }),
}));

const { useDocxEditor } = await import('./useDocxEditor');

function settleMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(() => resolve()));
}

function mountEditor() {
  const hiddenContainer = ref<HTMLElement | null>(document.createElement('div'));
  const pagesContainer = ref<HTMLElement | null>(document.createElement('div'));
  document.body.appendChild(hiddenContainer.value!);
  document.body.appendChild(pagesContainer.value!);
  return useDocxEditor({ hiddenContainer, pagesContainer });
}

describe('useDocxEditor loadGeneration ownership transitions', () => {
  beforeEach(() => {
    pendingParses.length = 0;
  });

  test('stale loadBuffer parse cannot overwrite a later loadDocument', async () => {
    const editor = mountEditor();
    const controlled = createEmptyDocument({ initialText: 'controlled-owned-doc' });
    controlled.warnings = ['controlled-marker'];
    const stale = createEmptyDocument({ initialText: 'stale-parse-doc' });
    stale.warnings = ['stale-marker'];

    const loadPromise = editor.loadBuffer(new ArrayBuffer(8));
    expect(pendingParses.length).toBe(1);

    editor.loadDocument(controlled);
    expect(editor.getDocument()?.warnings).toContain('controlled-marker');

    pendingParses[0]!.resolve(stale);
    await loadPromise;
    await settleMicrotasks();

    const current = editor.getDocument();
    expect(current).not.toBe(stale);
    expect(current?.warnings).toContain('controlled-marker');
    expect(current?.warnings).not.toContain('stale-marker');

    editor.destroy();
  });

  test('stale loadBuffer parse cannot apply after destroy', async () => {
    const editor = mountEditor();
    const stale = createEmptyDocument({ initialText: 'stale-after-destroy' });
    stale.warnings = ['stale-after-destroy'];

    const loadPromise = editor.loadBuffer(new ArrayBuffer(8));
    expect(pendingParses.length).toBe(1);

    editor.destroy();
    expect(editor.getDocument()).toBeNull();

    pendingParses[0]!.resolve(stale);
    await loadPromise;
    await settleMicrotasks();

    expect(editor.getDocument()).toBeNull();
    expect(editor.isReady.value).toBe(false);
  });
});
