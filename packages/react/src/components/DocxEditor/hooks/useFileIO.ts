/**
 * File in and out: save, download, open a `.docx`, and the hidden inputs behind them.
 *
 * PORTED from the legacy hook of the same name. The download plumbing (blob, object URL,
 * the deferred revoke Safari needs, the filename derived from the document name), the
 * input refs, and the handler names are legacy's, unchanged.
 *
 * What the engine replaces:
 *
 *  - SAVE. Legacy walked its `DocumentAgent`'s document, injected comment and
 *    tracked-change reply-range markers, and serialized that tree. The engine is
 *    byte-native: `save()` returns the canonical package as DOCX bytes, so there is no
 *    tree to walk and no markers to inject.
 *  - OPEN. Legacy read the file, parsed it, and pushed the result through its loader.
 *    `load()` takes the bytes.
 *  - PRINT. Legacy cloned the painted pages into a print window. That is painter
 *    territory (rule 4) and the greenfield painter owns its own output, so this falls
 *    back to `window.print()` rather than reaching into the page DOM to rebuild it.
 *  - INSERT IMAGE. `insertImage` takes bytes on the contract; the engine refuses it
 *    today, so the picker opens and the insert reports unsupported rather than silently
 *    dropping the file.
 */
import { useCallback, useRef } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';

export function useFileIO({
  editorRef,
  documentName,
  onDocumentNameChange,
  onOpen,
  onError,
  onPrint,
}: {
  editorRef: React.RefObject<Editor | null>;
  documentName?: string | undefined;
  onDocumentNameChange?: ((name: string) => void) | undefined;
  /** When supplied, the host owns opening and is handed the file. */
  onOpen?: ((file: File) => void | Promise<void>) | undefined;
  onError?: ((error: Error) => void) | undefined;
  onPrint?: (() => void) | undefined;
}) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const docxInputRef = useRef<HTMLInputElement | null>(null);

  const handleSave = useCallback(async (): Promise<ArrayBuffer | null> => {
    const editor = editorRef.current;
    if (!editor) return null;
    try {
      return await editor.save();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Failed to save document'));
      return null;
    }
  }, [editorRef, onError]);

  const handleDirectPrint = useCallback(() => {
    window.print();
    onPrint?.();
  }, [onPrint]);

  const handleDownloadDocument = useCallback(async () => {
    const buffer = await handleSave();
    if (!buffer) return;
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${(documentName?.trim() || 'document').replace(/\.docx$/i, '')}.docx`;
    a.click();
    // Defer revoke so Safari has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [handleSave, documentName]);

  const handleOpenDocument = useCallback(() => {
    docxInputRef.current?.click();
  }, []);

  const handleDocxFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;

      if (onOpen) {
        try {
          await onOpen(file);
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error('Failed to open document'));
        }
        return;
      }

      try {
        editorRef.current?.load(await file.arrayBuffer());
        onDocumentNameChange?.(file.name);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Failed to open document'));
      }
    },
    [editorRef, onDocumentNameChange, onError, onOpen]
  );

  const handleInsertImageClick = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file || !editorRef.current) return;
      const target = editorRef.current.query({ type: 'selection' });
      if (!target) return;
      editorRef.current.exec({
        type: 'insertImage',
        target,
        data: new Uint8Array(await file.arrayBuffer()),
      });
    },
    [editorRef]
  );

  return {
    imageInputRef,
    docxInputRef,
    handleSave,
    handleDirectPrint,
    handleDownloadDocument,
    handleOpenDocument,
    handleDocxFileChange,
    handleInsertImageClick,
    handleImageFileChange,
  };
}
