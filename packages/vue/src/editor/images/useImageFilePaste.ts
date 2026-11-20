// The image-FILE paste lane, shared by the painted pages and the drawing selection overlay.
//
// A selected picture, shape or text box moves focus to its overlay, which sits beside the
// pages, so a paste there never reaches the pages' handler. Both elements run this one
// handler; core decides whether the file lane takes the paste, where the picture lands, and
// where focus goes after it (`runImageFilePaste`). Mirrors the React adapter.

import { runImageFilePaste } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useImageInsertOptional } from './ImageInsert';

/** The paste handler `useImageFilePaste` returns. */
export interface UseImageFilePasteReturn {
  (event: ClipboardEvent): void;
}

/** Returns the paste handler that inserts a pasted image file. Call it during `setup`. */
export function useImageFilePaste(): UseImageFilePasteReturn {
  const editorRef = useDocxEditor();
  const imageInsert = useImageInsertOptional();
  return (event: ClipboardEvent) => {
    const editor = editorRef.value;
    if (!editor || !imageInsert) return;
    void runImageFilePaste(
      editor,
      event,
      imageInsert.insertFromDataTransfer,
      imageInsert.showRefusal
    );
  };
}
