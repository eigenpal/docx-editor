// The image-FILE paste lane, shared by the painted pages and the drawing selection overlay.
//
// A selected picture, shape or text box moves focus to its overlay, which sits beside the
// pages, so a paste there never reaches the pages' handler. Both elements run this one
// handler; core decides whether the file lane takes the paste and where the picture lands.

import { useCallback } from 'react';
import { imageFilePastePlan } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useImageInsertOptional } from './ImageInsert';

/** The selection overlay, which an insert beside its drawing ends. */
const OVERLAY_SELECTOR = '.docx-image-selection-overlay';

/**
 * Whether the keyboard should return to the text after a picture lands at a drawing: focus is
 * nowhere, on a removed element, or still on the drawing's selection overlay. Focus that the
 * reader moved somewhere else during the file read stays there.
 */
export function focusReturnsToText(ownerDocument: Document): boolean {
  const active = ownerDocument.activeElement;
  return (
    !active ||
    active === ownerDocument.body ||
    !active.isConnected ||
    active.closest(OVERLAY_SELECTOR) !== null
  );
}

/** Report an insert that threw instead of returning a refusal, so it is not an unhandled rejection. */
export function reportImageInsertFailure(error: unknown): void {
  console.error('[docx-editor] The image could not be inserted.', error);
}

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
      void imageInsert
        .insertFromDataTransfer(transfer, plan.at)
        .catch(reportImageInsertFailure)
        .then(() => {
          // An insert at a drawing ends its selection, and the focused overlay unmounts with
          // it. The text then takes the keyboard, as after a paste of a copied drawing.
          if (plan.at && ownerDocument && focusReturnsToText(ownerDocument)) editor.focus();
        });
    },
    [editor, imageInsert]
  );
}
