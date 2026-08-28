// The engine's mount point: where the pages actually paint.
//
// Renders the `docx-paginated-surface` element and hands it to the facade with
// `attach` in a layout effect — after the element is connected under the Viewport, so
// the engine's scroller discovery (`docx-editor__scroll-container` ancestor) finds the
// right element on the first paint. The facade owns everything inside this div.
//
// Paste and drop of supported raster formats route through the shared image-insert path.

import { useCallback, useLayoutEffect, useRef } from 'react';
import { clipboardDropLandsText, clipboardPasteLandsContent } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useImageInsertOptional } from './images/ImageInsert';
import { ImageSelectionOverlay } from './images/ImageSelectionOverlay.tsx';

import type { DocxEditorChildren } from '../docx-editor-children';

function hasImageFile(transfer: DataTransfer): boolean {
  return [...transfer.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
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
      // STAND DOWN whenever the ENGINE will land content from the payload — see the
      // predicate's contract in core. Word on macOS pastes a rendered PNG of copied TEXT
      // beside the HTML; taking this file lane for it inserted that rendering on top of
      // the text. (`defaultPrevented` says nothing — the engine prevents every paste,
      // even ones it ignores.)
      if (clipboardPasteLandsContent(items)) return;
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
      // Same stand-down as paste, for the drop lane's plain-text-only reality: when the
      // payload carries visible HTML text, NOT preventing the default lets the browser
      // fire `insertFromDrop`, which is the engine's only drop path. Word on macOS drags
      // carry a rendered PNG beside the text; taking the file lane swallowed that event
      // and turned dropped text into a picture of it.
      if (clipboardDropLandsText(event.dataTransfer)) {
        // Only an EDITABLE target fires `insertFromDrop`. Anywhere else (page furniture,
        // an inactive header band), the browser's default action for a file-carrying
        // transfer is to NAVIGATE to the file — which destroys the session — so the drop
        // is swallowed instead of released.
        const target = event.target as HTMLElement | null;
        if (target?.isContentEditable) return;
        event.preventDefault();
        return;
      }
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
