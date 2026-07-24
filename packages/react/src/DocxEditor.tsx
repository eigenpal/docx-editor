import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/editor';
import { createEditor, measureInteractionHostMetrics } from '@docx-editor.dev/engine-editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { paintDisplay } from './paintDisplay';
import type { DocxEditorProps, DocxEditorRef } from './types';

/**
 * React host for the DOCX editor. It supplies an `EditorHost` (DOM handles,
 * frame scheduling, a display sink), constructs the `Editor` through
 * `createEditor`, and paints the positioned `DisplayPage[]` the engine emits.
 * All editing, querying, and geometry go through the `Editor` facade.
 */
export const DocxEditor = forwardRef<DocxEditorRef, DocxEditorProps>(
  function DocxEditor(props, ref) {
    const { document: doc, className } = props;

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const pagesRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const [pages, setPages] = useState<readonly DisplayPage[]>([]);

    // Latest props/callbacks, read inside effects without retriggering them.
    const propsRef = useRef(props);
    propsRef.current = props;

    const host = useMemo<EditorHost>(
      () => ({
        getBodyHostEl: () => bodyRef.current,
        getHfHostEl: () => null,
        getPagesContainer: () => pagesRef.current,
        getScrollContainer: () => scrollRef.current,
        getInteractionHostMetrics: () => {
          const scroll = scrollRef.current;
          if (!scroll) return null;
          return measureInteractionHostMetrics(scroll, propsRef.current.zoom ?? 1);
        },
        scheduleFrame: (cb) => {
          const id = requestAnimationFrame(cb);
          return () => cancelAnimationFrame(id);
        },
        onDisplay: (next) => setPages(next),
      }),
      []
    );

    // Create the editor once. `document`/`zoom`/`locale` seed the initial
    // config; later document changes flow through `load` below, not a
    // teardown, so undo/selection/scroll survive parent re-renders.
    useEffect(() => {
      const p = propsRef.current;
      const editor = createEditor({
        host,
        document: p.document,
        zoom: p.zoom,
        locale: p.locale,
        author: p.author,
        mode: p.mode,
      });
      editorRef.current = editor;
      propsRef.current.onReady?.(editor);
      const off = editor.on('change', (c) => propsRef.current.onChange?.(c));
      return () => {
        off();
        editor.destroy();
        editorRef.current = null;
      };
    }, [host]);

    // Reload on document-identity change (skip the initial mount, which already
    // loaded it via createEditor).
    const seededDoc = useRef(true);
    useEffect(() => {
      if (seededDoc.current) {
        seededDoc.current = false;
        return;
      }
      if (doc) editorRef.current?.load(doc);
    }, [doc]);

    useImperativeHandle(
      ref,
      () => ({
        load: (document) => editorRef.current!.load(document),
        save: () => editorRef.current!.save(),
        focus: (scope) => editorRef.current!.focus(scope),
        exec: (command, options) => editorRef.current!.exec(command, options),
        snapshot: (options) => editorRef.current!.snapshot(options),
        getDocumentHandle: () => editorRef.current!.getDocumentHandle(),
        getEditor: () => editorRef.current,
      }),
      []
    );

    // Zoom is applied on paint (the contract's DisplayPage boxes are pre-zoom); scale the pages
    // wrapper from its top-left so scrolling still works.
    const zoom = props.zoom ?? 1;
    useEffect(() => {
      editorRef.current?.relayout();
    }, [zoom]);
    return (
      <div ref={scrollRef} data-testid="docx-editor-scroll" className={className} style={{ overflow: 'auto' }}>
        <div ref={pagesRef} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          {paintDisplay(pages)}
        </div>
        <div ref={bodyRef} style={{ position: 'fixed', width: 0, height: 0, overflow: 'visible', pointerEvents: 'none' }} />
      </div>
    );
  }
);
