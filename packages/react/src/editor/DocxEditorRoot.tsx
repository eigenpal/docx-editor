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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DocumentChange,
  DocumentSource,
  Editor,
  EditorFontError,
  FontConfiguration,
} from '@docx-editor.dev/core-contract/contracts/editor';
import { createDocxEditor, defaultTableLabel } from '@docx-editor.dev/core-contract/editor';
import type {
  DocxEditorInstance,
  FontConfigurationFragment,
  ImageDecodePort,
} from '@docx-editor.dev/core-contract/editor';
import { useTranslation, type TranslationKey } from '../i18n';
import { DocxEditorContext, ReviewRailContext, type ReviewRailRegistry } from './context';
import { HyperlinkPopupContext, useHyperlinkPopupInstance } from './useHyperlinkPopup';
import { ContentControlContext, useContentControlInstance } from './useContentControl';
import { ImageInsertProvider } from './images/ImageInsert';
import {
  NavigationLayoutContext,
  createNavigationLayoutStore,
} from './navigation/navigation-layout';

/**
 * Props for `DocxEditor.Root`. Creation parameters (`document`, `fonts`, `author`,
 * `locale`, and the initial `mode`/`zoom`) are sampled when the instance is created;
 * only `document` and `fonts` identity remount it. Later `mode` and `zoom` changes flow through
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
  /** Drawing refusal labels for painted placeholders; defaults to the active locale catalogue. */
  translate?: (key: string, params?: Record<string, string | number>) => string;
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
  /**
   * Localized labels for table insertion furniture. When omitted, core falls back to
   * bundled English through {@link defaultTableLabel}.
   */
  tableInteractionLabel?: (key: 'table.insertRowBelow' | 'table.insertColumnRight') => string;
  /** Optional decode port for embedded image insertion and paint in tests or custom hosts. */
  imageDecodePort?: ImageDecodePort;
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
  const { document: doc, fonts, zoom, tableInteractionLabel, imageDecodePort, children } = props;
  const { t: catalogT } = useTranslation();
  const defaultTranslate = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      catalogT(key as TranslationKey, params),
    [catalogT]
  );

  // Latest props, read inside effects without retriggering them.
  const propsRef = useRef(props);
  propsRef.current = props;

  const [editor, setEditor] = useState<DocxEditorInstance | null>(null);

  // One instance per document/fonts identity, and per effect run: `destroy()` is
  // terminal, so a StrictMode re-run must build anew rather than resurrect.
  useEffect(() => {
    const p = propsRef.current;
    const translate = p.translate ?? defaultTranslate;
    const instance = createDocxEditor({
      ...(p.document !== undefined ? { document: p.document } : {}),
      ...(p.fonts ? { fonts: p.fonts } : {}),
      ...(p.author !== undefined ? { author: p.author } : {}),
      ...(p.locale !== undefined ? { locale: p.locale } : {}),
      translate,
      ...(p.mode !== undefined ? { mode: p.mode } : {}),
      ...(p.zoom !== undefined ? { zoom: p.zoom } : {}),
      ...(p.tableInteractionLabel ? { tableInteractionLabel: p.tableInteractionLabel } : {}),
      ...(p.imageDecodePort ? { imageDecodePort: p.imageDecodePort } : {}),
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
  }, [doc, fonts, defaultTranslate, imageDecodePort]);

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

  // Table furniture labels follow the live locale resolver without remounting the editor.
  useEffect(() => {
    if (!editor) return;
    editor.setTableInteractionLabel(tableInteractionLabel ?? defaultTableLabel);
  }, [editor, tableInteractionLabel]);

  // A rail registers itself here so the viewport only reserves a gutter when one is
  // actually composed in. See `ReviewRailContext`.
  const [rails, setRails] = useState(0);
  const railRegistry = useMemo<ReviewRailRegistry>(
    () => ({
      mounted: rails,
      register: () => {
        setRails((count) => count + 1);
        return () => setRails((count) => Math.max(0, count - 1));
      },
    }),
    [rails]
  );

  // The channel between an open navigation pane and the chrome it displaces. A store
  // rather than state: the shift is recomputed on every viewport resize, and state here
  // would re-render the whole editor subtree at resize frequency. Created once per Root —
  // its identity must not change, or the two consumers resubscribe on every render.
  const navigationLayout = useMemo(createNavigationLayoutStore, []);

  return (
    <ReviewRailContext.Provider value={railRegistry}>
      <DocxEditorContext.Provider value={editor}>
        <NavigationLayoutContext.Provider value={navigationLayout}>
          {/* ONE link-popover state per editor, published here so a TOOLBAR button and the
              popover panel — which are siblings, not ancestor and descendant — see the same
              open/closed state and only one of them registers with the engine's gestures. */}
          <HyperlinkPopupProvider>
            <ContentControlProvider>
              <ImageInsertProvider>{children}</ImageInsertProvider>
            </ContentControlProvider>
          </HyperlinkPopupProvider>
        </NavigationLayoutContext.Provider>
      </DocxEditorContext.Provider>
    </ReviewRailContext.Provider>
  );
}

/**
 * Publishes the popover state. A child of the editor context rather than part of `Root`
 * itself, because it consumes that context and a component cannot read its own provider.
 */
function HyperlinkPopupProvider({ children }: { children?: ReactNode }) {
  const popup = useHyperlinkPopupInstance(true);
  return <HyperlinkPopupContext.Provider value={popup}>{children}</HyperlinkPopupContext.Provider>;
}

/** One content-control chrome state per editor — inspector open + mode toggles. */
function ContentControlProvider({ children }: { children?: ReactNode }) {
  const chrome = useContentControlInstance();
  return <ContentControlContext.Provider value={chrome}>{children}</ContentControlContext.Provider>;
}
