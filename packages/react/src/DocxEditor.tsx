import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { InteractionIntent } from '@docx-editor.dev/core-contract/interaction';
import {
  attachAdapterEventBridge,
  createEditor,
  firstEditableGlyphTarget,
  measureInteractionHostMetrics,
  overlaysForFrame,
  type FrameOverlays,
  type GlyphClickTarget,
} from '@docx-editor.dev/engine-editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { paintDisplay } from './paintDisplay';
import type { DocxEditorProps, DocxEditorRef } from './types';

/**
 * React host for the DOCX editor. It supplies an `EditorHost` (DOM handles,
 * frame scheduling, a display sink), constructs the `Editor` through
 * `createEditor`, and paints the positioned `DisplayPage[]` the engine emits.
 * All editing, querying, and geometry go through the `Editor` facade.
 *
 * Direct editing (interactive-paginated-editing 6.2): real pointer and keyboard
 * events on the painted pages are forwarded to the shared interaction
 * controller by `attachAdapterEventBridge`. The adapter normalizes nothing and
 * measures nothing — it reports scroll and zoom through
 * `measureInteractionHostMetrics`, hands raw client coordinates to the engine,
 * and paints back the caret and selection geometry the engine returns.
 */
export const DocxEditor = forwardRef<DocxEditorRef, DocxEditorProps>(
  function DocxEditor(props, ref) {
    const { document: doc, className } = props;

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const pagesRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const [pages, setPages] = useState<readonly DisplayPage[]>([]);
    const [overlays, setOverlays] = useState<FrameOverlays>({ caret: null, selection: [] });
    const [clickTarget, setClickTarget] = useState<GlyphClickTarget | null>(null);

    // Latest props/callbacks, read inside effects without retriggering them.
    const propsRef = useRef(props);
    propsRef.current = props;

    // Re-read the published frame and repaint the overlay layer. Runs after
    // every display and selection change so the caret cannot lag the model.
    const syncFromFrame = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const frame = editor.getInteractionFrame();
      setOverlays(overlaysForFrame(frame));
      setClickTarget(firstEditableGlyphTarget(frame));
    }, []);

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
      const offChange = editor.on('change', (c) => {
        propsRef.current.onChange?.(c);
        syncFromFrame();
      });
      const offSelection = editor.on('selectionChange', () => syncFromFrame());
      const offDisplay = editor.on('display', () => syncFromFrame());
      syncFromFrame();
      return () => {
        offChange();
        offSelection();
        offDisplay();
        editor.destroy();
        editorRef.current = null;
      };
    }, [host, syncFromFrame]);

    // Forward real pointer, keyboard, and focus events on the painted pages to
    // the shared controller. The bridge owns normalization for both adapters;
    // its disposer must run on unmount or listeners outlive the editor.
    useEffect(() => {
      const surface = scrollRef.current;
      if (!surface) return undefined;
      const detach = attachAdapterEventBridge(surface, {
        getInteractionFrameId: () => editorRef.current?.getInteractionFrame().id ?? null,
        dispatchInteraction: (intent: InteractionIntent) => {
          const result = editorRef.current!.dispatchInteraction(intent);
          syncFromFrame();
          return result;
        },
      });
      return detach;
    }, [syncFromFrame]);

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

    // Zoom scales the whole page stack from its top-left. The same factor is
    // reported to the engine through host metrics, so client-to-content mapping
    // stays a plain divide and paint and hit testing agree.
    const zoomFactor = props.zoom ?? 1;
    useEffect(() => {
      editorRef.current?.relayout();
    }, [zoomFactor]);

    return (
      <div
        ref={scrollRef}
        data-testid="docx-editor-scroll"
        className={`ep-one-surface ep-one-surface__viewport${className ? ` ${className}` : ''}`}
      >
        <div
          ref={pagesRef}
          className="ep-one-surface__pages"
          style={{ transform: `scale(${zoomFactor})`, transformOrigin: 'top left' }}
        >
          {paintDisplay(pages, overlays, clickTarget)}
        </div>
        <div
          ref={bodyRef}
          className="ep-one-surface__input-host"
          style={{ position: 'fixed', width: 0, height: 0, overflow: 'visible', pointerEvents: 'none' }}
        />
      </div>
    );
  }
);
