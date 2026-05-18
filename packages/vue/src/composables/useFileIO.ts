/**
 * File I/O composable for DocxEditorVue — owns the hidden file-picker
 * ref, the document-name change emit path, the `.docx` download flow,
 * and the load/save bridge over `useDocxEditor`'s `loadBuffer` /
 * `loadParsedDocument` / `saveBlob`. Re-emits `ready` after a tick so
 * host listeners that read comments/tracked-changes on the event see the
 * freshly-extracted arrays, not stale data.
 */

import { ref } from 'vue';
import { readDocxFileFromInput } from '@eigenpal/docx-editor-core/utils';
import type { Document } from '@eigenpal/docx-editor-core/types/document';

export interface UseFileIOOptions {
  /** From useDocxEditor — loads a .docx buffer into the editor. */
  loadBuffer: (buffer: ArrayBuffer | Uint8Array | Blob | File) => Promise<void>;
  /** From useDocxEditor — loads an already-parsed Document model. */
  loadParsedDocument: (doc: Document) => void;
  /** From useDocxEditor — returns the current Document, or null. */
  getDocument: () => Document | null;
  /** From useDocxEditor — serializes the current state to a .docx Blob. */
  saveBlob: () => Promise<Blob | null>;
  /** Fired after load+extract so the next tick sees comments/tracked-changes. */
  extractCommentsAndChanges: () => void;
  /** SFC's emit function — re-emits ready / rename / update:document / error. */
  emit: (event: string, ...args: unknown[]) => void;
  /** Accessor — read freshly inside the handler so prop updates are honored. */
  documentName: () => string | undefined;
  onDocumentNameChange?: (name: string) => void;
  /** Vue's `nextTick` — passed in so the composable doesn't require its own import wiring. */
  nextTick: () => Promise<void>;
}

export function useFileIO(opts: UseFileIOOptions) {
  const docxInputRef = ref<HTMLInputElement | null>(null);

  async function emitReadyAfterSidebarStateRefresh() {
    // Extract comments BEFORE emitting `ready` so host listeners that read
    // comments / tracked changes on the event see the new doc, not stale arrays.
    await opts.nextTick();
    opts.extractCommentsAndChanges();
    opts.emit('ready');
  }

  async function handleDocxFileChange(event: Event) {
    try {
      const result = await readDocxFileFromInput(event);
      if (!result) return;
      await opts.loadBuffer(result.buffer);
      opts.emit('update:document', opts.getDocument());
      opts.emit('rename', result.name);
      await emitReadyAfterSidebarStateRefresh();
    } catch (err) {
      opts.emit('error', err instanceof Error ? err : new Error('Failed to open document'));
    }
  }

  function handleDocumentNameChange(name: string) {
    opts.onDocumentNameChange?.(name);
    opts.emit('rename', name);
  }

  /**
   * File > Save in the menu bar should produce a downloadable .docx, not
   * just stash the Blob and forget. Falls back to "document.docx" when
   * the host doesn't supply a `documentName` prop.
   */
  async function downloadCurrentDocument() {
    const blob = await opts.saveBlob();
    if (!blob) return;
    const baseName = (opts.documentName() ?? '').trim() || 'document';
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${baseName.replace(/\.docx$/i, '')}.docx`;
    // The anchor never enters the DOM tree — `.click()` works without
    // appending in modern browsers, and skipping the append/remove dance
    // avoids a layout flash on tall pages.
    a.click();
    // Defer revoke so Safari has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadDocumentBuffer(buffer: Parameters<typeof opts.loadBuffer>[0]) {
    await opts.loadBuffer(buffer);
    await emitReadyAfterSidebarStateRefresh();
  }

  function loadDocument(doc: Document) {
    opts.loadParsedDocument(doc);
    opts.emit('update:document', doc);
    void emitReadyAfterSidebarStateRefresh();
  }

  async function save(): Promise<ArrayBuffer | null> {
    const blob = await opts.saveBlob();
    return blob ? blob.arrayBuffer() : null;
  }

  return {
    docxInputRef,
    handleDocxFileChange,
    handleDocumentNameChange,
    downloadCurrentDocument,
    emitReadyAfterSidebarStateRefresh,
    loadDocumentBuffer,
    loadDocument,
    save,
  };
}
