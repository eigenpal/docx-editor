/* eslint-disable react-hooks/rules-of-hooks -- Vue composable fixture, not React */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { mock } from 'bun:test';
import { ref } from 'vue';
import { createEmptyDocument } from '@docx-editor.dev/core/utils';
import type { Document } from '@docx-editor.dev/core/types/document';

type PendingParse = {
  resolve: (doc: Document) => void;
  reject: (err: unknown) => void;
};

const pendingParses: PendingParse[] = [];

mock.module('@docx-editor.dev/core/docx/parser', () => ({
  parseDocx: (_buffer: ArrayBuffer | Uint8Array) =>
    new Promise<Document>((resolve, reject) => {
      pendingParses.push({ resolve, reject });
    }),
}));

GlobalRegistrator.register();

const { useDocxEditor } = await import('./useDocxEditor');

function useMountedEditor() {
  const hiddenContainer = ref<HTMLElement | null>(document.createElement('div'));
  const pagesContainer = ref<HTMLElement | null>(document.createElement('div'));
  document.body.appendChild(hiddenContainer.value!);
  document.body.appendChild(pagesContainer.value!);
  return useDocxEditor({ hiddenContainer, pagesContainer });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifyLoadDocumentInvalidation() {
  pendingParses.length = 0;
  const editor = useMountedEditor();
  const controlled = createEmptyDocument({ initialText: 'controlled-owned-doc' });
  controlled.warnings = ['controlled-marker'];
  const stale = createEmptyDocument({ initialText: 'stale-parse-doc' });
  stale.warnings = ['stale-marker'];

  const loadPromise = editor.loadBuffer(new ArrayBuffer(8));
  assert(pendingParses.length === 1, 'loadBuffer did not start one parse');
  editor.loadDocument(controlled);
  pendingParses[0]!.resolve(stale);
  await loadPromise;

  const current = editor.getDocument();
  assert(current !== stale, 'stale parse replaced the controlled document');
  assert(current?.warnings?.includes('controlled-marker'), 'controlled document was not retained');
  assert(!current?.warnings?.includes('stale-marker'), 'stale parse marker leaked into state');
  editor.destroy();
}

async function verifyDestroyInvalidation() {
  pendingParses.length = 0;
  const editor = useMountedEditor();
  const stale = createEmptyDocument({ initialText: 'stale-after-destroy' });

  const loadPromise = editor.loadBuffer(new ArrayBuffer(8));
  assert(pendingParses.length === 1, 'loadBuffer did not start one parse');
  editor.destroy();
  pendingParses[0]!.resolve(stale);
  await loadPromise;

  assert(editor.getDocument() === null, 'stale parse applied after destroy');
  assert(editor.isReady.value === false, 'destroyed editor became ready after stale parse');
}

try {
  await verifyLoadDocumentInvalidation();
  await verifyDestroyInvalidation();
} finally {
  GlobalRegistrator.unregister();
}
