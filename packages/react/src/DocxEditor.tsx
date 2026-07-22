import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createEditor, type Editor, type EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { paintDisplay } from './paintDisplay';
import type { DocxEditorProps, DocxEditorRef } from './types';

/**
 * React host for the DOCX editor. It supplies an `EditorHost` (DOM handles,
 * frame scheduling, a display sink), constructs the `Editor` through
 * `createEditor`, and paints the positioned `DisplayPage[]` the engine emits.
 * All editing, querying, and geometry go through the `Editor` facade.
 */
export const DocxEditor = forwardRef<DocxEditorRef, DocxEditorProps>(function DocxEditor(
  props,
  ref
) {
  const { document: doc, zoom, locale, className, onReady, onChange } = props;

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [pages, setPages] = useState<readonly DisplayPage[]>([]);

  const host = useMemo<EditorHost>(
    () => ({
      getBodyHostEl: () => bodyRef.current,
      getHfHostEl: () => null,
      getPagesContainer: () => pagesRef.current,
      getScrollContainer: () => scrollRef.current,
      scheduleFrame: (cb) => {
        const id = requestAnimationFrame(cb);
        return () => cancelAnimationFrame(id);
      },
      onDisplay: (next) => setPages(next),
    }),
    []
  );

  useEffect(() => {
    const editor = createEditor({ host, document: doc, zoom, locale });
    editorRef.current = editor;
    onReady?.(editor);
    const off = onChange ? editor.on('change', onChange) : undefined;
    return () => {
      off?.();
      editor.destroy();
      editorRef.current = null;
    };
  }, [host, doc, zoom, locale, onReady, onChange]);

  useImperativeHandle(
    ref,
    () => ({
      exec: (command, options) => editorRef.current!.exec(command, options),
      snapshot: (options) => editorRef.current!.snapshot(options),
      save: () => editorRef.current!.save(),
      focus: (scope) => editorRef.current!.focus(scope),
      getEditor: () => editorRef.current,
    }),
    []
  );

  return (
    <div ref={scrollRef} className={className} style={{ overflow: 'auto' }}>
      <div ref={pagesRef}>{paintDisplay(pages)}</div>
      <div ref={bodyRef} style={{ position: 'absolute', left: -9999, top: 0 }} />
    </div>
  );
});
