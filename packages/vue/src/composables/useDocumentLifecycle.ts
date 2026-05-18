/**
 * Document-load lifecycle — bridges the `documentBuffer` / `document`
 * props to `useFileIO`'s `loadDocumentBuffer` / `loadDocument` helpers,
 * resetting `sidebarAutoOpenedRef` on every swap so a freshly-loaded
 * doc gets the auto-open treatment. Also handles first-mount load.
 */

import { watch, onMounted, nextTick, type Ref } from 'vue';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import type { DocxInput } from '@eigenpal/docx-editor-core/utils';

export interface UseDocumentLifecycleOptions {
  documentBuffer: () => DocxInput | null;
  document: () => Document | null;
  loadDocumentBuffer: (buffer: DocxInput) => Promise<void>;
  loadDocument: (doc: Document) => void;
  sidebarAutoOpenedRef: Ref<boolean>;
}

export function useDocumentLifecycle(opts: UseDocumentLifecycleOptions) {
  async function loadBufferReset(buf: DocxInput) {
    opts.sidebarAutoOpenedRef.value = false;
    await opts.loadDocumentBuffer(buf);
  }

  function loadDocReset(doc: Document) {
    opts.sidebarAutoOpenedRef.value = false;
    opts.loadDocument(doc);
  }

  watch(opts.documentBuffer, (buf) => {
    if (buf) void loadBufferReset(buf);
  });

  watch(opts.document, (doc) => {
    if (doc) loadDocReset(doc);
  });

  onMounted(async () => {
    await nextTick();
    const buffer = opts.documentBuffer();
    const doc = opts.document();
    if (buffer) await loadBufferReset(buffer);
    else if (doc) loadDocReset(doc);
  });
}
