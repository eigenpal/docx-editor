import { useDocxEditor } from '@docx-editor.dev/vue';

/** Hand DOCX bytes to the browser as a download. */
export function downloadDocx(bytes: ArrayBuffer | Uint8Array, name: string): void {
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Save the document as a download named after the title. Call it under the Root. */
export function useSaveDocument(title: () => string): () => void {
  const editor = useDocxEditor();
  return () => {
    void editor.value?.save().then((buffer) => {
      if (!buffer) return;
      downloadDocx(buffer, `${title().trim() || 'document'}.docx`);
    });
  };
}
