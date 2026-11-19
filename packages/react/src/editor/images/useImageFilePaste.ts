// The image-FILE paste lane, shared by the painted pages and the drawing selection overlay.
//
// A selected picture, shape or text box moves focus to its overlay, which sits beside the
// pages, so a paste there never reaches the pages' handler. Both elements run this one
// handler; core decides whether the file lane takes the paste and where the picture lands.

import { useCallback } from 'react';
import { imageFilePastePlan } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useImageInsertOptional } from './ImageInsert';

/** Returns the paste handler that inserts a pasted image file. */
export function useImageFilePaste(): (event: ClipboardEvent) => void {
  const editor = useDocxEditor();
  const imageInsert = useImageInsertOptional();
  return useCallback(
    (event: ClipboardEvent) => {
      const transfer = event.clipboardData;
      if (!editor || !imageInsert || !transfer) return;
      const plan = imageFilePastePlan(editor, transfer);
      if (!plan) return;
      event.preventDefault();
      const ownerDocument = (event.target as Node | null)?.ownerDocument ?? null;
      // The file is read before the first await, while the clipboard is still readable.
      void imageInsert.insertFromDataTransfer(transfer, plan.at).then(() => {
        // An insert at a drawing ends its selection, and the focused overlay unmounts with it.
        // The text then takes the keyboard, as after a paste of a copied drawing. Focus that
        // moved somewhere else during the file read stays there.
        const active = ownerDocument?.activeElement;
        if (plan.at && ownerDocument && (!active || active === ownerDocument.body)) editor.focus();
      });
    },
    [editor, imageInsert]
  );
}
