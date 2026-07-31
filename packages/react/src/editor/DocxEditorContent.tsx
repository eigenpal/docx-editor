// The engine's mount point: where the pages actually paint.
//
// Renders the `docx-paginated-surface` element and hands it to the facade with
// `attach` in a layout effect — after the element is connected under the Viewport, so
// the engine's scroller discovery (`docx-editor__scroll-container` ancestor) finds the
// right element on the first paint. The facade owns everything inside this div.
//
// The editor arrives LATE by design: `DocxEditor.Root` publishes it from a mount
// effect, so the first render of this component sees `null`. The layout effect is
// keyed on the instance and attaches as soon as both the element and the editor exist.

import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useDocxEditor } from './context';

const SURFACE_STYLE: CSSProperties = { margin: '24px auto' };

/** Props for `DocxEditor.Content`. @public */
export interface DocxEditorContentProps {
  /** Appended after the load-bearing `docx-paginated-surface` class. */
  className?: string;
}

/**
 * The element the engine paints pages into. Must render inside a
 * `DocxEditor.Viewport`; the facade attaches here and detaches on unmount (stashing
 * the live document bytes, so remounting elsewhere restores the content).
 *
 * @public
 */
export function DocxEditorContent({ className }: DocxEditorContentProps) {
  const editor = useDocxEditor();
  const elementRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div
      ref={elementRef}
      className={`docx-paginated-surface${className ? ` ${className}` : ''}`}
      style={SURFACE_STYLE}
    />
  );
}
