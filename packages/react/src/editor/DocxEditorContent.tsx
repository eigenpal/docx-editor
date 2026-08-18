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

/** Props for `DocxEditor.Content`. @public */
export interface DocxEditorContentProps {
  /** Appended after the load-bearing `docx-paginated-surface` class. */
  className?: string;
  /** Vue parity — use `className` in React. */
  class?: string;
  children?: import('react').ReactNode;
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
      const hasImage = [...items.items].some(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );
      if (!hasImage) return;
      event.preventDefault();
      void imageInsert.insertFromDataTransfer(items);
    },
    [imageInsert]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (!imageInsert?.isEnabled) return;
      const hasImage = [...event.dataTransfer.items].some(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );
      if (!hasImage) return;
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
        onDrop={onDrop}
      />
      {editor ? <ImageSelectionOverlay containerRef={elementRef} portalRef={portalRef} /> : null}
    </div>
  );
}
