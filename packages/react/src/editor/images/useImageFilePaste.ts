// The image-FILE paste lane, shared by the painted pages and the drawing selection overlay.
//
// A selected picture, shape or text box moves focus to its overlay, which sits beside the
// pages, so a paste there never reaches the pages' handler. Both elements run this one
// handler; core decides whether the file lane takes the paste, where the picture lands, and
// where focus goes after it (`runImageFilePaste`).

import { useCallback } from 'react';
import { runImageFilePaste } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useImageInsertOptional } from './ImageInsert';

/** Returns the paste handler that inserts a pasted image file. */
export function useImageFilePaste(): (event: ClipboardEvent) => void {
  const editor = useDocxEditor();
  const imageInsert = useImageInsertOptional();
  return useCallback(
    (event: ClipboardEvent) => {
      if (!editor || !imageInsert) return;
      void runImageFilePaste(
        editor,
        event,
        imageInsert.insertFromDataTransfer,
        imageInsert.showRefusal
      );
    },
    [editor, imageInsert]
  );
}
