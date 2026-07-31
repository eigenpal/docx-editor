// Provider-first host for the docx editor facade.
//
// `DocxEditorRoot` renders no DOM of its own: it creates the facade WITHOUT a container
// (the instance stashes its document bytes and does no DOM work), publishes it through
// `DocxEditorContext`, and lets `DocxEditor.Content` attach a mount point wherever the
// host's tree puts one. Toolbars built from the hooks therefore work whether they render
// above, below, or nowhere near the painted pages.
//
// STRICTMODE CONTRACT. `destroy()` is terminal on the facade — a destroyed instance
// never remounts — so the mount effect creates a FRESH instance on every run and
// destroys it on cleanup. React StrictMode's double-invoked effect gets two instances;
// the first dies unused, the second is the one the tree sees. Identity of the published
// instance flows through `useState`, so consumers re-render when it lands.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DocumentChange,
  DocumentSource,
  Editor,
  EditorFontError,
  FontConfiguration,
} from '@docx-editor.dev/core-contract/contracts/editor';
import { createDocxEditor } from '@docx-editor.dev/core-contract/editor';
import type {
  DocxEditorInstance,
  FontConfigurationFragment,
} from '@docx-editor.dev/core-contract/editor';
import { DocxEditorContext } from './context';

/**
 * Props for `DocxEditor.Root`. Creation parameters (`document`, `fonts`, `author`,
 * `locale`, `mode`, and the initial `zoom`) are sampled when the instance is created;
 * only `document` and `fonts` identity remount it. A later `zoom` change flows through
 * `Editor.setZoom` so edits, the caret, and the undo history survive.
 *
 * @public
 */
export interface DocxEditorRootProps {
  /** A document to load: DOCX bytes or an existing handle. Identity change remounts. */
  document?: DocumentSource;
  /**
   * Font bytes for Word-accurate (HarfBuzz-shaped) wrap and pagination. Omitted, layout
   * uses a fixed-width estimate; fonts embedded in the document are wired automatically
   * either way. Pass `await loadDefaultFonts()` from `@docx-editor.dev/fonts` for
   * Word's default faces — a bare fragment is accepted — or compose several origins
   * with `composeFontConfiguration`. Sampled at mount; identity change remounts;
   * failures degrade to the fixed measurer and report through `onFontError`.
   */
  fonts?: FontConfiguration | FontConfigurationFragment;
  author?: string;
  locale?: string;
  /** `'edit'` (default) or `'view'` (read-only). Sampled at mount only. */
  mode?: 'edit' | 'view';
  zoom?: number;
  /** Fired once per instance, after it is published to the tree (and after any
   *  `DocxEditor.Content` in the same commit has attached its mount point). */
  onReady?: (editor: Editor) => void;
  /** Fired when the document changes (revision + identity deltas, not bytes). */
  onChange?: (change: DocumentChange) => void;
  /** Fired with the typed font failure when the shaped-font pipeline rejects. */
  onFontError?: (error: EditorFontError) => void;
  children?: ReactNode;
}

/**
 * Creates and owns a `DocxEditorInstance` and provides it to the subtree. Renders no
 * DOM — compose it with `DocxEditor.Viewport` + `DocxEditor.Content` for the painted
 * pages, and any hook-built chrome anywhere inside.
 *
 * @public
 */
export function DocxEditorRoot(props: DocxEditorRootProps) {
  const { document: doc, fonts, zoom, children } = props;

  // Latest props, read inside effects without retriggering them.
  const propsRef = useRef(props);
  propsRef.current = props;

  const [editor, setEditor] = useState<DocxEditorInstance | null>(null);

  // One instance per document/fonts identity, and per effect run: `destroy()` is
  // terminal, so a StrictMode re-run must build anew rather than resurrect.
  useEffect(() => {
    const p = propsRef.current;
    const instance = createDocxEditor({
      ...(p.document !== undefined ? { document: p.document } : {}),
      ...(p.fonts ? { fonts: p.fonts } : {}),
      ...(p.author !== undefined ? { author: p.author } : {}),
      ...(p.locale !== undefined ? { locale: p.locale } : {}),
      ...(p.mode !== undefined ? { mode: p.mode } : {}),
      ...(p.zoom !== undefined ? { zoom: p.zoom } : {}),
      onFontError: (error) => propsRef.current.onFontError?.(error),
    });
    const offChange = instance.on('change', (change) => propsRef.current.onChange?.(change));
    setEditor(instance);
    return () => {
      offChange();
      instance.destroy();
      // Functional update: a StrictMode re-run's second instance must not be clobbered.
      setEditor((current) => (current === instance ? null : current));
    };
  }, [doc, fonts]);

  // Fired AFTER the instance is published: this effect runs in the commit that rendered
  // the new editor, after child layout effects — so a `DocxEditor.Content` in the tree
  // has already attached and `onReady` observes a mounted document.
  useEffect(() => {
    if (editor) propsRef.current.onReady?.(editor);
  }, [editor]);

  // Zoom is a facade parameter, not a remount: tearing the editor down for a zoom
  // change would discard the user's edits and undo history.
  useEffect(() => {
    if (zoom !== undefined) editor?.setZoom(zoom);
  }, [editor, zoom]);

  return <DocxEditorContext.Provider value={editor}>{children}</DocxEditorContext.Provider>;
}
