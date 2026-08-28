// The engine's mount point: where the pages actually paint.
//
// Renders the `docx-paginated-surface` element and hands it to the facade with
// `attach` in a layout effect — after the element is connected under the Viewport, so
// the engine's scroller discovery (`docx-editor__scroll-container` ancestor) finds the
// right element on the first paint. The facade owns everything inside this div.
//
// Paste and drop of supported raster formats route through the shared image-insert path.

import { useCallback, useLayoutEffect, useRef } from 'react';
import { useDocxEditor } from './context';
import { useImageInsertOptional } from './images/ImageInsert';
import { ImageSelectionOverlay } from './images/ImageSelectionOverlay.tsx';

import type { DocxEditorChildren } from '../docx-editor-children';

function hasImageFile(transfer: DataTransfer): boolean {
  return [...transfer.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

/** Whether an image clipboard is really text plus a preview image from a word processor. */
export function engineOwnsImagePaste(transfer: DataTransfer): boolean {
  if (typeof transfer.getData !== 'function') return false;
  const html = transfer.getData('text/html') ?? '';
  if (html.includes('data-docx-fragment') || html.includes('data:image')) return true;

  const plain = transfer.getData('text/plain') ?? '';
  if (plain.length === 0) return false;
  if (html.length === 0) return true;
  // Word for Mac puts a PNG preview beside normal textual clipboard flavours. The HTML
  // contains visible text; a browser's Copy Image payload is normally only an <img>
  // (possibly wrapped in a link), so its textContent stays empty and keeps the file lane.
  if (html.length > 4 * 1024 * 1024 || typeof DOMParser === 'undefined') return true;
  try {
    return new DOMParser().parseFromString(html, 'text/html').body?.textContent?.trim().length > 0;
  } catch {
    // Plain text is still an honest fallback; prefer one text paste over text plus a preview.
    return true;
  }
}

/** Props for `DocxEditor.Content`. @public */
export interface DocxEditorContentProps {
  /** Appended after the load-bearing `docx-paginated-surface` class. */
  className?: string;
  children?: DocxEditorChildren;
}

/**
 * The element the engine paints pages into. Must render inside a
 * `DocxEditor.Viewport`; the facade attaches here and detaches on unmount (stashing
 * the live document bytes, so remounting elsewhere restores the content).
 *
 * Its centring margin lives in the STYLESHEET, not in an inline style here, and behind
 * `:where()` so it carries no specificity: a host that places the page itself — inside its
 * own stage, beside its own art — overrides it with a plain class and no `!important`. An
 * inline style could not be beaten by a class at all, which is exactly the trap that makes
 * a library feel like something to fight.
 *
 * @public
 */
export function DocxEditorContent({ className }: DocxEditorContentProps) {
  const editor = useDocxEditor();
  const imageInsert = useImageInsertOptional();
  const elementRef = useRef<HTMLDivElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!editor || !el) return undefined;
    editor.attach(el);
    return () => {
      // No-op when the Root already destroyed the instance (unmount ordering runs this
      // first, but a document-identity remount can interleave).
      editor.detach();
    };
  }, [editor]);

  const onPaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (!imageInsert?.isEnabled) return;
      const items = event.clipboardData;
      if (!items) return;
      if (!hasImageFile(items)) return;
      // Word processors can add a rendered preview image beside the real text flavours.
      // The engine owns those payloads; the file lane remains for screenshots and Copy Image.
      // (`defaultPrevented` says nothing: the engine prevents even pastes it ignores.)
      if (engineOwnsImagePaste(items)) return;
      event.preventDefault();
      void imageInsert.insertFromDataTransfer(items);
    },
    [imageInsert]
  );

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!imageInsert?.isEnabled || !hasImageFile(event.dataTransfer)) return;
      event.preventDefault();
    },
    [imageInsert]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (!imageInsert?.isEnabled) return;
      if (!hasImageFile(event.dataTransfer)) return;
      event.preventDefault();
      void imageInsert.insertFromDataTransfer(event.dataTransfer);
    },
    [imageInsert]
  );

  return (
    <div ref={portalRef} className="docx-content-mount">
      <div
        ref={elementRef}
        className={`docx-paginated-surface${className ? ` ${className}` : ''}`}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDrop={onDrop}
      />
      {editor ? <ImageSelectionOverlay containerRef={elementRef} portalRef={portalRef} /> : null}
    </div>
  );
}
